"use client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { type Match, METER_SCALE, greenWindow, releaseGrade } from "@/game/sim/match";
import type { AgentIntent } from "@/game/sim/state";
import type { InputManager, DeviceId } from "@/game/input";
import { frameToIntent } from "@/game/controls";
import { commentFor, speak } from "@/game/commentary";
import { audio } from "@/audio/engine";
import { useSettings, type CameraMode } from "@/state/settings";
import { useHud, type HudSnapshot } from "@/state/matchStore";
import { Arena, type ArenaKind } from "./Arena";
import { pickVariant, variant, type VenueVariant } from "./arena/variants";
import { replayPose } from "./cameraPose";
import { Hoop } from "./Hoop";
import { BallMesh } from "./Ball";
import { Players } from "./Players";
import { Officials } from "./Officials";
import { CameraRig, type CameraState } from "./CameraRig";
import type { UniformStyle } from "./character/uniformTexture";
import { rimPos } from "@/game/court";
import { liveView, REPLAY_CAMS, type ReplayDirector, type ViewFrame } from "./replay";
import { ordinal } from "@/game/commentary";
import type { Park } from "@/game/park/parks";
import { ContestRacks, PARK_VENUE, ParkLights, ParkScene, parkSky } from "./park/ParkScene";
import type { PlayersProps } from "./Players";

export const SIM_STEP = 1 / 60;

export interface GameSceneProps {
  match: Match;
  input: InputManager;
  /** Device id for each human controller index. */
  devices: DeviceId[];
  uniforms: [UniformStyle, UniformStyle];
  arena: ArenaKind;
  /** Play in the Park: the outdoor court to build (with arena "park"). */
  park?: Park;
  /** Park games: street clothes per player. */
  street?: PlayersProps["street"];
  paused: boolean;
  cameraMode: CameraMode;
  onPauseRequest: () => void;
  onCameraCycle: () => void;
  onTimeoutRequest: (team: 0 | 1) => void;
  timeScale?: number;
  replay: ReplayDirector;
  /** Called once the arena, players and textures have loaded. */
  onReady?: () => void;
  /** False while a menu or splash covers the game (hides in-world overlays like name tags). */
  overlaysVisible?: boolean;
}

function Environment({ intensity = 0.55 }: { intensity?: number }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = intensity;
    return () => {
      env.dispose();
      pm.dispose();
      scene.environment = null;
    };
  }, [gl, scene, intensity]);
  return null;
}

function Lights({ venue, shadows }: { venue: VenueVariant; shadows: boolean }) {
  const key = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const l = key.current;
    if (!l) return;
    l.shadow.mapSize.set(2048, 2048);
    const cam = l.shadow.camera as THREE.OrthographicCamera;
    cam.left = -18;
    cam.right = 18;
    cam.top = 12;
    cam.bottom = -12;
    cam.near = 1;
    cam.far = 60;
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 0.02;
    l.target.position.set(0, 0, 0);
    l.target.updateMatrixWorld();
  }, []);
  const gym = venue.kind === "gym";
  const ly = venue.lightY;
  return (
    <>
      <hemisphereLight args={[gym ? "#fff6e5" : "#cfd9ff", gym ? "#6b5844" : "#1a1410", gym ? 0.9 : 0.55]} />
      <directionalLight ref={key} position={[3, 26, 6]} intensity={gym ? 1.6 : 2.4} castShadow={shadows} color={gym ? "#fff3dc" : "#ffffff"} />
      {/* rows of arena lights over the floor */}
      {[-10, 0, 10].map((x) => (
        <pointLight key={x} position={[x, ly, 0]} intensity={gym ? 90 : 260} distance={gym ? 30 : 46} decay={2} color={gym ? "#ffefd2" : "#ffffff"} />
      ))}
    </>
  );
}

/** Floor ring under each controlled player, colored by controller. Glides when control switches. */
function ControlMarkers({ match, replayFrame }: { match: Match; replayFrame: React.RefObject<ViewFrame | null> }) {
  const colors = ["#ffb627", "#4cc3ff", "#7dff8a", "#ff6bd6"];
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const smooth = useRef(colors.map(() => ({ x: 0, z: 0, o: 0, id: "" })));
  const geo = useMemo(() => new THREE.RingGeometry(0.42, 0.52, 48), []);
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const s = match.state;
    for (let h = 0; h < 4; h++) {
      const m = refs.current[h];
      if (!m) continue;
      const sm = smooth.current[h];
      const ag = s.agents.find((a) => a.human === h);
      const show =
        !!ag &&
        !replayFrame.current &&
        (s.phase === "live" || s.phase === "inbound" || s.phase === "deadball" || s.phase === "freethrows" || s.phase === "jumpball");
      if (ag) {
        // first sight snaps; a switch to another player glides across quickly
        if (!sm.id) {
          sm.x = ag.pos.x;
          sm.z = ag.pos.z;
        }
        sm.id = ag.player.id;
        const k = 1 - Math.exp(-28 * dt);
        sm.x += (ag.pos.x - sm.x) * k;
        sm.z += (ag.pos.z - sm.z) * k;
      }
      sm.o = THREE.MathUtils.damp(sm.o, show ? 0.85 : 0, 12, dt);
      m.visible = sm.o > 0.02;
      m.position.set(sm.x, 0.015, sm.z);
      (m.material as THREE.MeshBasicMaterial).opacity = sm.o;
    }
  });
  return (
    <>
      {colors.map((c, i) => (
        <mesh
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          rotation={[-Math.PI / 2, 0, 0]}
          geometry={geo}
          renderOrder={2}
        >
          {/* drawn on top of the floor and its painted lines without z-fighting */}
          <meshBasicMaterial
            color={c}
            transparent
            opacity={0}
            toneMapped={false}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-4}
            polygonOffsetUnits={-4}
          />
        </mesh>
      ))}
    </>
  );
}

function SimDriver(
  props: GameSceneProps & {
    camState: React.RefObject<CameraState>;
    exciteRef: React.RefObject<number>;
    clockRefs: [React.RefObject<{ shot: number; game: number }>, React.RefObject<{ shot: number; game: number }>];
    rimShake: React.RefObject<number[]>;
    ballPos: React.RefObject<THREE.Vector3 | null>;
    scoreRef: React.RefObject<{ h: number; a: number; period: string; clock: string }>;
    benchExcite: React.RefObject<[number, number]>;
    /** How hard the home [0] and visiting [1] fans are reacting right now (0..1, decays). */
    crowdReactRef: React.RefObject<[number, number]>;
  },
) {
  const { match, input, devices } = props;
  const crowdReact = (fans: 0 | 1, amount: number) => {
    const r = props.crowdReactRef.current!;
    r[fans] = Math.max(r[fans], amount);
  };
  const acc = useRef(0);
  const settings = useSettings();
  const setHud = useHud((s) => s.set);
  const pushFeed = useHud((s) => s.pushFeed);
  const showBanner = useHud((s) => s.showBanner);
  const showOverlay = useHud((s) => s.showOverlay);
  const heatShown = useRef(new Map<string, number>());
  const lastHud = useRef(0);
  const lastDribblePhase = useRef(0);
  const prevOwner = useRef<number | null>(null);
  const callFor = useRef<number | null>(null);
  /** Each player's velocity a beat ago, to hear hard plants and cuts. */
  const cutRef = useRef<{ vx: number; vz: number; t: number }[]>([]);

  useFrame((_, dtRaw) => {
    const s = match.state;
    const dt = Math.min(dtRaw, 0.1);
    // global buttons from every controller
    const frames = devices.map((d) => input.read(d));
    const rp = props.replay;
    if (rp.playback) {
      // replay controls (any controller)
      for (const f of frames) {
        const any = (...a: Parameters<typeof f.pressed.has>[0][]) => a.some((x) => f.pressed.has(x));
        if (rp.playback.auto ? any("shoot", "pass", "pause", "replay", "switchPlayer") : any("pause", "replay")) {
          rp.stop();
          break;
        }
        if (any("shoot")) rp.setPlaying(!rp.playback.playing);
        if (any("camera", "pass")) rp.cycleCam(1);
        if (any("dribbleLeft")) rp.scrub(-1);
        if (any("dribbleRight")) rp.scrub(1);
        if (any("dribbleSpin")) rp.setSpeed(Math.min(1, rp.playback.speed * 2));
        if (any("dribbleBack")) rp.setSpeed(Math.max(0.125, rp.playback.speed / 2));
      }
      return;
    }
    frames.forEach((f, i) => {
      if (f.pressed.has("pause")) props.onPauseRequest();
      if (f.pressed.has("camera")) props.onCameraCycle();
      if (f.pressed.has("replay") && !props.paused) {
        const c = rp.recentClip();
        if (c) rp.play(c);
      }
      if (f.pressed.has("timeout")) {
        const ag = s.agents.find((a) => a.human === i);
        if (ag) props.onTimeoutRequest(ag.team);
      }
    });
    if (props.paused) return;

    // human intents
    const intents: (AgentIntent | null)[] = [];
    frames.forEach((f, i) => {
      const ag = s.agents.find((a) => a.human === i);
      if (!ag) {
        intents[i] = null;
        return;
      }
      const cs = props.camState.current!;
      const { intent, meta } = frameToIntent(match, ag, f, { camForwardX: cs.forward.x, camForwardZ: cs.forward.y });
      intents[i] = intent;
      if (meta.switchPlayer) match.switchPlayer(i);
      if (meta.callForBall) callFor.current = ag.idx;
    });
    (s as typeof s & { callFor?: number | null }).callFor = callFor.current;

    acc.current += dt * (props.timeScale ?? 1);
    const events: typeof s.frameEvents = [];
    let steps = 0;
    while (acc.current >= SIM_STEP && steps < 8) {
      match.step(SIM_STEP, intents);
      events.push(...s.frameEvents);
      rp.observe(s.frameEvents);
      rp.record();
      // actions are edge-triggered: only deliver them on the first sub-step
      for (const it of intents) if (it) it.act = undefined;
      acc.current -= SIM_STEP;
      steps++;
    }
    callFor.current = (s as typeof s & { callFor?: number | null }).callFor ?? null;
    if (rp.autoCandidate) {
      const mode = settings.presentation.autoReplays;
      if (mode !== "off" && (mode === "all" || rp.autoCandidate.scoring) && !s.cfg.practice && s.phase !== "final") rp.play(rp.autoCandidate, { auto: true });
      else rp.autoCandidate = null;
    }

    // ---- big-play banners
    if (settings.presentation.playBanners && !s.cfg.practice) {
      const teamCol = (ti: number) => s.teams[ti].team.colors;
      const nm = (i: number) => `${s.agents[i]?.player.firstName[0]}. ${s.agents[i]?.player.lastName}`;
      const banner = (title: string, ti: number | null, sub?: string) => {
        const c = ti !== null ? teamCol(ti) : { primary: "#0d1b2e", accent: "#ffb627" };
        showBanner({ title, sub, color: c.primary, accent: c.accent === c.primary ? "#ffffff" : c.accent });
      };
      for (const e of events) {
        if (e.t === "make") {
          const sh = s.agents[e.shooter];
          if (!sh) continue;
          if (s.clock <= 0.05 && e.kind !== "freeThrow") banner("BUZZER BEATER", sh.team, nm(e.shooter));
          else if (e.andOne) banner("AND ONE", sh.team, nm(e.shooter));
          else if (s.run.team === sh.team && [8, 12, 16, 20].some((t) => s.run.pts - e.points < t && s.run.pts >= t))
            banner(`${s.run.pts}-0 RUN`, sh.team, s.teams[sh.team].team.name);
          else if (sh.heat > 0.7 && s.time - (heatShown.current.get(sh.player.id) ?? -999) > 90) {
            heatShown.current.set(sh.player.id, s.time);
            banner(sh.heat > 0.9 ? "ON FIRE" : "HEATING UP", sh.team, nm(e.shooter));
          }
        } else if (e.t === "block") banner("REJECTED", s.agents[e.blocker]?.team ?? null, nm(e.blocker));
        else if (e.t === "dribbleMove" && e.broke !== null) banner("ANKLES!", s.agents[e.player]?.team ?? null, nm(e.player));
        else if (e.t === "injury") banner("INJURY", s.agents[e.player]?.team ?? null, `${nm(e.player)}: ${e.name}`);
        else if (e.t === "foulOut") banner("FOULED OUT", s.agents[e.player]?.team ?? null, nm(e.player));
        else if (e.t === "periodStart" && e.period > 1) {
          const per = s.cfg.rules.periods;
          banner(
            e.period > per
              ? e.period - per > 1
                ? `OVERTIME ${e.period - per}`
                : "OVERTIME"
              : per === 2
                ? "SECOND HALF"
                : ordinal(e.period).replace(" quarter", "").toUpperCase() + " QUARTER",
            null,
          );
        }
      }
    }

    // ---- lower-third stat cards
    if (settings.presentation.statOverlays && !s.cfg.practice) {
      const card = (idx: number, lines: string[]) => {
        const ag = s.agents[idx];
        if (!ag) return;
        const t = s.teams[ag.team].team;
        showOverlay({
          jersey: ag.player.jersey,
          name: `${ag.player.firstName[0]}. ${ag.player.lastName}`,
          team: t.abbrev,
          color: t.colors.primary,
          accent: t.colors.accent === t.colors.primary ? "#ffffff" : t.colors.accent,
          lines,
        });
      };
      for (const e of events) {
        if (e.t === "make" && e.kind !== "freeThrow") {
          const ag = s.agents[e.shooter];
          const b = ag && s.box[ag.player.id];
          if (b && [10, 15, 20, 25, 30, 35, 40, 50].some((m) => b.pts >= m && b.pts - e.points < m)) {
            card(e.shooter, [
              `${b.pts} PTS · ${b.fgm}/${b.fga} FG${b.tpa ? ` · ${b.tpm}/${b.tpa} 3PT` : ""}`,
              `${b.oreb + b.dreb} REB · ${b.ast} AST${b.stl ? ` · ${b.stl} STL` : ""}`,
            ]);
          }
        } else if (e.t === "foul" && e.fts > 0) {
          const ag = s.agents[e.on];
          const b = ag && s.box[ag.player.id];
          if (b) card(e.on, [`Tonight ${b.ftm}/${b.fta} from the line`, `Free throw rating ${ag.player.ratings.freeThrow}`]);
        }
      }
    }

    // ---- presentation side effects
    const pan = (x: number) => THREE.MathUtils.clamp(x / s.cfg.court.halfL, -1, 1) * 0.8;
    for (const e of events) {
      switch (e.t) {
        case "rimHit":
          audio.rim(e.speed, pan(s.ball.phys.pos.x));
          props.rimShake.current![s.ball.phys.pos.x > 0 ? 0 : 1] = Math.min(1, e.speed / 4);
          break;
        case "boardHit":
          audio.board(e.speed, pan(s.ball.phys.pos.x));
          break;
        case "floorBounce":
          if (s.ball.mode !== "dribble") audio.dribble(pan(s.ball.phys.pos.x), Math.min(1, e.speed / 5));
          break;
        case "swish":
          audio.swish();
          break;
        case "make": {
          audio.netRustle();
          const big = e.kind === "dunk" || e.points === 3;
          const homeTeam = s.agents[e.shooter]?.team === 0;
          const clutch = s.period >= s.cfg.rules.periods && s.clock < 60;
          // the home crowd erupts; a road basket gets a groan, or a reluctant "ooh" for a big dunk
          if (homeTeam) audio.react(e.kind === "dunk" || e.andOne || clutch ? "roar" : big ? "roar" : "cheer", e.kind === "dunk" ? 1 : big ? 0.85 : 0.55);
          else if (e.kind === "dunk") audio.react("ooh", 0.75);
          else if (big || clutch) audio.react("aww", 0.45);
          else audio.react("applause", 0.12);
          if (e.kind === "dunk" && settings.camera.shake) props.camState.current!.shake = 0.8;
          props.exciteRef.current = homeTeam ? (big ? 1 : 0.7) : big ? 0.55 : 0.35;
          crowdReact(homeTeam ? 0 : 1, big || e.andOne ? 1 : 0.6);
          if (big || e.andOne) props.benchExcite.current![s.agents[e.shooter].team] = 2.6;
          const sh = s.agents[e.shooter];
          if (sh.human !== null && settings.gameplay.vibration) input.rumble(devices[sh.human], 0.4, 0.6, 180);
          break;
        }
        case "block": {
          audio.board(3);
          const homeTeam = s.agents[e.blocker]?.team === 0;
          audio.react(homeTeam ? "roar" : "ooh", homeTeam ? 0.85 : 0.6);
          props.exciteRef.current = homeTeam ? 0.9 : 0.5;
          crowdReact(homeTeam ? 0 : 1, 0.9);
          props.benchExcite.current![s.agents[e.blocker].team] = 2.2;
          break;
        }
        case "foul":
        case "violation": {
          audio.whistle();
          // a call against the home team draws boos; one on the visitors gets a cheer
          const by = e.t === "foul" ? s.agents[e.player]?.team : e.team;
          if (by === 0) audio.react("boo", e.t === "foul" && e.kind === "charge" ? 0.75 : 0.5);
          else if (by === 1) audio.react("applause", 0.35);
          break;
        }
        case "freeThrow": {
          const homeTeam = s.agents[e.shooter]?.team === 0;
          if (homeTeam) audio.react(e.made ? "applause" : "aww", e.made ? 0.5 : 0.35);
          else if (!e.made) audio.react("cheer", 0.35);
          break;
        }
        case "dribbleMove":
          if (e.broke !== null) {
            const homeTeam = s.agents[e.player]?.team === 0;
            audio.react(homeTeam ? "roar" : "ooh", 0.8);
            crowdReact(homeTeam ? 0 : 1, 0.8);
            props.exciteRef.current = Math.max(props.exciteRef.current ?? 0, homeTeam ? 0.85 : 0.5);
          }
          break;
        case "buzzer":
          audio.buzzer();
          break;
        case "timeout":
        case "periodEnd":
          audio.react("applause", 0.4);
          break;
        case "final":
          audio.react(e.winner === 0 ? "roar" : "aww", 1);
          if (e.winner === 0) crowdReact(0, 1);
          break;
        case "steal": {
          audio.catchBall();
          const homeTeam = s.agents[e.player]?.team === 0;
          audio.react(homeTeam ? "cheer" : "aww", homeTeam ? 0.6 : 0.3);
          if (homeTeam) crowdReact(0, 0.6);
          break;
        }
        case "pass":
          break;
        case "crowd":
          props.exciteRef.current = Math.max(props.exciteRef.current ?? 0, e.level);
          break;
        case "miss": {
          // a home miss off the rim draws an "aww"; the visitors missing gets a cheer
          const homeTeam = s.agents[e.shooter]?.team === 0;
          const late = s.period >= s.cfg.rules.periods && s.clock < 120;
          if (homeTeam && (s.ball.phys.touchedRim || late || e.points === 3)) audio.react("aww", late ? 0.7 : 0.4);
          else if (!homeTeam && late) audio.react("cheer", 0.4);
          break;
        }
        default:
          break;
      }
      // no announcer at the park
      if (settings.presentation.commentary && !match.state.cfg.park && !match.drill) {
        const line = commentFor(match, e);
        if (line) {
          pushFeed(line, "team" in e && typeof e.team === "number" ? e.team : null);
          if (settings.audio.voiceCommentary) speak(line, settings.audio.commentary * settings.audio.master);
        }
      }
    }
    // dribble sounds on each bounce
    if (s.ball.mode === "dribble") {
      const ph = s.ball.dribblePhase;
      // the ball meets the floor at phase 0.5 (it's back in the hand at 0 and 1)
      if (lastDribblePhase.current < 0.5 && ph >= 0.5) audio.dribble(pan(s.ball.phys.pos.x), 0.7);
      lastDribblePhase.current = ph;
    }
    if (prevOwner.current !== s.ball.owner && s.ball.owner !== null) audio.catchBall(pan(s.ball.phys.pos.x));
    prevOwner.current = s.ball.owner;
    // sneaker squeaks only when a player really plants: a hard stop or a sharp cut at speed
    const cuts = cutRef.current;
    for (const a of s.agents) {
      const c = (cuts[a.idx] ??= { vx: a.vel.x, vz: a.vel.z, t: 0 });
      c.t += dt;
      if (c.t < 0.12) continue;
      const was = Math.hypot(c.vx, c.vz),
        now = Math.hypot(a.vel.x, a.vel.z);
      const turn = was > 0.5 && now > 0.5 ? Math.acos(THREE.MathUtils.clamp((c.vx * a.vel.x + c.vz * a.vel.z) / (was * now), -1, 1)) : 0;
      const stop = was - now;
      if (a.y < 0.02 && a.stun === 0 && was > 3.2 && (stop > 2.4 || turn > 0.85)) audio.squeak(pan(a.pos.x), Math.min(1, Math.max(stop / 5, turn / 2)));
      c.vx = a.vel.x;
      c.vz = a.vel.z;
      c.t = 0;
    }
    // crowd energy: decays toward a baseline that rises late in close games; the home crowd
    // hushes for its own free throws and gets loud to rattle the visitors' shooter
    const close = Math.abs(s.teams[0].score - s.teams[1].score) <= 6;
    const late = s.period >= s.cfg.rules.periods && s.clock < 120;
    const ftHome = s.phase === "freethrows" && s.offense === 0;
    const base = 0.25 + (close && late ? 0.35 : 0) + (s.phase === "freethrows" ? (ftHome ? -0.15 : 0.3) : 0);
    props.exciteRef.current = THREE.MathUtils.damp(props.exciteRef.current ?? base, base, 0.6, dt);
    audio.crowdLevel(props.exciteRef.current);
    // "DE-FENSE!" when the visitors have it in a tight finish
    const tight = s.period >= s.cfg.rules.periods && s.clock < 180 && Math.abs(s.teams[0].score - s.teams[1].score) <= 8;
    audio.chant(!s.cfg.practice && tight && s.offense === 1 && (s.phase === "live" || s.phase === "inbound"));
    const cr = props.crowdReactRef.current!;
    cr[0] = Math.max(0, cr[0] - dt * 0.45);
    cr[1] = Math.max(0, cr[1] - dt * 0.45);

    // shared refs for scene props
    for (const ref of props.clockRefs)
      if (ref.current) {
        ref.current.shot = s.shotClock;
        ref.current.game = s.clock;
      }
    props.ballPos.current =
      s.ball.mode === "shot" || s.ball.mode === "loose" || s.ball.mode === "dead" || s.ball.mode === "ft"
        ? new THREE.Vector3(s.ball.phys.pos.x, s.ball.phys.pos.y, s.ball.phys.pos.z)
        : null;
    const per = s.cfg.rules.periods;
    const periodLabel = s.period > per ? `OT${s.period - per > 1 ? s.period - per : ""}` : per === 2 ? `H${s.period}` : `Q${s.period}`;
    props.scoreRef.current = { h: s.teams[0].score, a: s.teams[1].score, period: periodLabel, clock: fmtClock(s.clock) };

    // HUD at ~20 Hz
    const now = performance.now();
    const shooter = s.agents.find(
      (a) =>
        a.human !== null &&
        (["jumper", "fadeaway", "floater", "hook", "layup"].includes(a.action.kind) || (a.action.kind === "freeThrow" && a.action.data.started)),
    );
    const metering = !!shooter && settings.gameplay.shotMeter && Number(shooter.action.data.releasedAt ?? -1) < 0;
    // every frame while the meter fills, so what you see is what you time
    if (metering || now - lastHud.current > 50) {
      lastHud.current = now;
      const ctrl = s.agents.find((a) => a.human === 0) ?? null;
      let meter: HudSnapshot["meter"] = null;
      if (shooter && settings.gameplay.shotMeter) {
        const d = shooter.action.data;
        const ideal = Number(d.ideal ?? 0.5);
        const relAt = Number(d.releasedAt ?? -1);
        const t = relAt >= 0 ? relAt : shooter.action.t;
        const greenW = Number(d.greenW ?? greenWindow(50));
        meter = {
          active: relAt < 0,
          fill: Math.min(1, t / (ideal * 1.35)),
          ideal: 1 / 1.35,
          green: (greenW * METER_SCALE) / (ideal * 1.35),
          result: relAt < 0 ? null : releaseGrade((t - ideal) / METER_SCALE, greenW),
          side: shooter.team,
        };
      }
      setHud({
        homeScore: s.teams[0].score,
        awayScore: s.teams[1].score,
        period: s.period,
        periods: per,
        clock: s.clock,
        shotClock: s.cfg.rules.shotClock ? s.shotClock : null,
        phase: s.phase,
        homeFouls: s.teams[0].fouls,
        awayFouls: s.teams[1].fouls,
        homeTimeouts: s.teams[0].timeouts,
        awayTimeouts: s.teams[1].timeouts,
        possession: s.offense,
        bonus: [match.inBonus(1), match.inBonus(0)],
        meter,
        controlled: ctrl
          ? { name: `${ctrl.player.firstName[0]}. ${ctrl.player.lastName}`, number: ctrl.player.jersey, stamina: ctrl.stamina, team: ctrl.team }
          : null,
      });
    }
  });
  return null;
}

/** Mounted inside Suspense, so it fires once every loader above it has resolved. */
function ReadySignal({ onReady }: { onReady?: () => void }) {
  const frames = useRef(0);
  const done = useRef(false);
  useFrame(() => {
    // wait a couple of frames so shaders are compiled and the first image is on screen
    if (done.current || ++frames.current < 3) return;
    done.current = true;
    onReady?.();
  });
  return null;
}

/** Jersey number and name floating over each player (DOM, positioned from the 3D scene). */
function NameTags({ match, replayFrame, visible }: { match: Match; replayFrame: React.RefObject<ViewFrame | null>; visible: boolean }) {
  const { camera, gl } = useThree();
  const canvas = gl.domElement;
  const enabled = useSettings((s) => s.gameplay.showPlayerNames);
  const els = useRef<HTMLDivElement[]>([]);
  const ids = useRef<string[]>([]);
  const v3 = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    Object.assign(host.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "15", overflow: "hidden" });
    // inside the game view (not <body>) so HUD panels and menus layer above the tags
    (canvas.parentElement?.parentElement ?? document.body).appendChild(host);
    els.current = Array.from({ length: 10 }, () => {
      const d = document.createElement("div");
      d.className = "bl-tag";
      host.appendChild(d);
      return d;
    });
    return () => host.remove();
  }, [canvas]);
  useFrame(() => {
    const s = match.state;
    const v = replayFrame.current ?? liveView(match);
    const show =
      enabled && visible && !replayFrame.current && s.phase !== "final" && s.phase !== "timeout" && s.phase !== "halftime" && s.phase !== "periodEnd";
    const rect = gl.domElement.getBoundingClientRect();
    // the camera rig moved the camera this frame; refresh its matrices so tags don't trail
    camera.updateMatrixWorld();
    els.current.forEach((el, i) => {
      const ag = v.agents[i];
      if (!show || !ag) {
        el.style.display = "none";
        return;
      }
      if (ids.current[i] !== ag.player.id) {
        ids.current[i] = ag.player.id;
        const col = s.teams[ag.team].team.colors;
        el.replaceChildren();
        const num = document.createElement("b");
        num.textContent = String(ag.player.jersey);
        num.style.background = col.primary;
        num.style.color = col.accent === col.primary ? "#fff" : col.accent;
        el.append(num, document.createTextNode(ag.player.lastName));
      }
      v3.set(ag.pos.x, ag.y + ag.player.heightIn * 0.0254 + 0.3, ag.pos.z).project(camera);
      if (v3.z > 1 || Math.abs(v3.x) > 1.1 || Math.abs(v3.y) > 1.1) {
        el.style.display = "none";
        return;
      }
      const x = rect.left + (v3.x * 0.5 + 0.5) * rect.width;
      const y = rect.top + (-v3.y * 0.5 + 0.5) * rect.height;
      el.style.display = "flex";
      // the controlled player and the ball handler get full tags; everyone else stays small and faint
      const key = ag.human !== null || v.ball.owner === ag.idx;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${key ? 1 : 0.8})`;
      el.style.opacity = key ? "1" : "0.38";
      el.style.zIndex = key ? "2" : "1";
    });
  });
  return null;
}

/** Advances replay playback and points the camera for the chosen replay angle. */
function ReplayDriver({
  match,
  replay,
  frameRef,
  camState,
  ballPos,
}: {
  match: Match;
  replay: ReplayDirector;
  frameRef: React.RefObject<ViewFrame | null>;
  camState: React.RefObject<CameraState>;
  ballPos: React.RefObject<THREE.Vector3 | null>;
}) {
  const orbit = useRef(0);
  const lastClip = useRef<number | null>(null);
  const lastCam = useRef(-1);
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const cs = camState.current!;
    const pb = replay.playback;
    const f = pb ? replay.advance(dt) : null;
    const pbNow = replay.playback;
    if (!f || !pbNow) {
      if (frameRef.current) {
        cs.override = null;
        cs.cut = true;
      }
      frameRef.current = null;
      lastClip.current = null;
      return;
    }
    frameRef.current = f;
    const b = f.ball;
    ballPos.current = b.mode === "shot" || b.mode === "loose" || b.mode === "dead" || b.mode === "ft" ? new THREE.Vector3(b.pos.x, b.pos.y, b.pos.z) : null;
    // camera: frame the key player (tracked by id across substitutions), else the ball
    const clip = pbNow.clip;
    const keyAg = clip.focus !== null ? clip.frames[clip.keyIndex].agents[clip.focus] : null;
    const ag = keyAg ? (f.agents.find((a) => a.player.id === keyAg.player.id) ?? null) : null;
    const c = match.state.cfg.court;
    const t = ag ? { x: ag.pos.x, z: ag.pos.z, y: ag.y } : { x: b.pos.x, z: b.pos.z, y: 0 };
    const team = ag ? ag.team : f.offense;
    orbit.current += dt * 0.35 * pbNow.speed;
    const { pos, look, fov } = replayPose(REPLAY_CAMS[pbNow.cam].id, c, t, b.pos, f.rimX[team], orbit.current);
    cs.override = { pos, look, fov };
    if (lastClip.current !== clip.id || lastCam.current !== pbNow.cam) cs.cut = true;
    lastClip.current = clip.id;
    lastCam.current = pbNow.cam;
  });
  return null;
}

/** Drives a "demand" frameloop at a fixed rate (frame rate cap). */
function FrameCap({ fps }: { fps: number }) {
  const { invalidate } = useThree();
  useEffect(() => {
    let raf = 0,
      last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last >= 1000 / fps - 1) {
        last = t;
        invalidate();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [fps, invalidate]);
  return null;
}

/** Tiny frame-rate readout rendered into a fixed DOM element. */
function FpsCounter() {
  const el = useRef<HTMLDivElement | null>(null);
  const frames = useRef({ n: 0, t: 0 });
  useEffect(() => {
    frames.current.t = performance.now();
    const d = document.createElement("div");
    d.setAttribute("aria-hidden", "true");
    Object.assign(d.style, {
      position: "fixed",
      top: "8px",
      left: "8px",
      zIndex: "60",
      font: "600 12px var(--font-body)",
      color: "#ffb627",
      background: "rgba(13,27,46,.8)",
      padding: "2px 6px",
      borderRadius: "4px",
      pointerEvents: "none",
    });
    document.body.appendChild(d);
    el.current = d;
    return () => d.remove();
  }, []);
  useFrame(() => {
    const f = frames.current;
    f.n++;
    const now = performance.now();
    if (now - f.t > 500) {
      if (el.current) el.current.textContent = `${Math.round((f.n * 1000) / (now - f.t))} fps`;
      f.n = 0;
      f.t = now;
    }
  });
  return null;
}

export function fmtClock(sec: number) {
  if (sec < 60) return Math.max(0, sec).toFixed(1);
  const m = Math.floor(sec / 60),
    s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function GameScene(props: GameSceneProps) {
  const g = useSettings((s) => s.graphics);
  const cam = useSettings((s) => s.camera);
  const camState = useRef<CameraState>({ forward: new THREE.Vector2(0, -1), shake: 0, override: null, cut: false });
  const replayFrame = useRef<ViewFrame | null>(null);
  const benchExcite = useRef<[number, number]>([0, 0]);
  const crowdReact = useRef<[number, number]>([0, 0]);
  const park = props.park;
  const benchSize = props.match.state.cfg.practice || park ? 0 : g.preset === "low" ? 0 : g.preset === "medium" ? 4 : 9;
  const excite = useRef(0.3);
  const clockA = useRef({ shot: 24, game: 720 });
  const clockB = useRef({ shot: 24, game: 720 });
  const rimShake = useRef([0, 0]);
  const ballPos = useRef<THREE.Vector3 | null>(null);
  const scoreRef = useRef({ h: 0, a: 0, period: "Q1", clock: "12:00" });
  const ballMesh = useRef<THREE.Mesh>(null);
  const s = props.match.state;
  const court = s.cfg.court;
  const home = s.teams[0].team,
    away = s.teams[1].team;
  const quality = g.preset;
  const venue = useMemo(() => (park ? PARK_VENUE : variant(pickVariant(props.arena, home))), [park, props.arena, home]);
  const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 1, 2) * g.resolutionScale;

  useEffect(() => {
    audio.setVenue(venue.kind === "park" ? "park" : venue.kind === "gym" ? "gym" : venue.id.startsWith("college") ? "college" : "pro");
    audio.startCrowd();
    return () => audio.stopCrowd();
  }, [venue]);

  return (
    <Canvas
      shadows={g.shadows ? { type: THREE.PCFShadowMap } : false}
      dpr={dpr}
      gl={{ antialias: !g.antialias ? false : false, powerPreference: "high-performance", stencil: false }}
      camera={{ fov: 30, near: 0.5, far: 400, position: [0, 9, 26] }}
      onCreated={({ gl, scene, camera }) => {
        if (process.env.NODE_ENV !== "production")
          (window as unknown as { __bl: unknown }).__bl = { scene, camera, gl, match: props.match, THREE, camState, audio };
        gl.toneMapping = THREE.NoToneMapping;
        gl.outputColorSpace = THREE.SRGBColorSpace;
      }}
      frameloop={g.fpsCap > 0 && g.fpsCap < 120 ? "demand" : "always"}
    >
      {g.fpsCap > 0 && g.fpsCap < 120 && <FrameCap fps={g.fpsCap} />}
      {g.showFps && <FpsCounter />}
      <color attach="background" args={[park ? parkSky(park).horizon : props.arena === "gym" ? "#bdb4a3" : "#05070a"]} />
      <fog attach="fog" args={park ? [parkSky(park).horizon, 70, 300] : [props.arena === "gym" ? "#bdb4a3" : "#05070a", 45, 140]} />
      <ReplayDriver match={props.match} replay={props.replay} frameRef={replayFrame} camState={camState} ballPos={ballPos} />
      <Environment intensity={park?.time === "night" ? 0.12 : park?.time === "sunset" ? 0.4 : 0.55} />
      {park ? <ParkLights park={park} shadows={g.shadows} court={court} /> : <Lights venue={venue} shadows={g.shadows} />}
      <Suspense fallback={null}>
        {park ? (
          <>
            <ParkScene park={park} court={court} quality={quality} />
            <ContestRacks match={props.match} ballRadius={court.ballRadius} />
          </>
        ) : (
          <Arena
            court={court}
            home={home}
            away={away}
            venue={venue}
            quality={quality}
            crowdDensity={g.crowdDensity}
            exciteRef={excite}
            reactRef={crowdReact}
            scoreRef={scoreRef}
          />
        )}
        {([1, -1] as const).map((side, i) => (
          <Hoop
            key={side}
            court={court}
            side={side}
            team={home}
            ceilingHung={venue.kind === "gym"}
            mountY={venue.girderY}
            outdoor={park?.hoop}
            ballRef={ballPos}
            clockRef={i === 0 ? clockA : clockB}
            rimShake={rimShake}
          />
        ))}
        <BallMesh ref={ballMesh} radius={court.ballRadius} />
        <Players
          match={props.match}
          uniforms={props.uniforms}
          ballMesh={ballMesh}
          replayFrame={replayFrame}
          benchSize={benchSize}
          benchExcite={benchExcite}
          onFootstep={(x, sp) => audio.footstep(THREE.MathUtils.clamp(x / court.halfL, -1, 1) * 0.8, sp)}
          street={props.street}
        />
        <Officials match={props.match} replayFrame={replayFrame} crewSize={g.preset === "low" || park ? 0 : 4} />
        <ControlMarkers match={props.match} replayFrame={replayFrame} />
        <NameTags match={props.match} replayFrame={replayFrame} visible={props.overlaysVisible ?? true} />
        <ReadySignal onReady={props.onReady} />
      </Suspense>
      <CameraRig
        match={props.match}
        mode={props.cameraMode}
        zoom={cam.zoom}
        heightMul={cam.height}
        venue={venue}
        stateRef={camState}
        focusAgent={() => s.agents.find((a) => a.human === 0)?.idx ?? s.ball.owner}
      />
      <SimDriver
        {...props}
        camState={camState}
        exciteRef={excite}
        clockRefs={[clockA, clockB]}
        rimShake={rimShake}
        ballPos={ballPos}
        scoreRef={scoreRef}
        benchExcite={benchExcite}
        crowdReactRef={crowdReact}
      />
      <EffectComposer multisampling={0} enableNormalPass={false}>
        {g.ambientOcclusion ? <N8AO aoRadius={1.2} intensity={2.2} distanceFalloff={0.6} halfRes /> : <></>}
        {g.bloom ? <Bloom intensity={0.55} luminanceThreshold={0.85} luminanceSmoothing={0.2} mipmapBlur /> : <></>}
        <ToneMapping mode={ToneMappingMode.AGX} />
        <Vignette offset={0.35} darkness={0.45} />
        {g.antialias ? <SMAA /> : <></>}
      </EffectComposer>
    </Canvas>
  );
}

export { rimPos };
