"use client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Match } from "@/game/sim/match";
import type { AgentIntent } from "@/game/sim/state";
import type { InputManager, DeviceId } from "@/game/input";
import { frameToIntent } from "@/game/controls";
import { commentFor, speak } from "@/game/commentary";
import { audio } from "@/audio/engine";
import { useSettings, type CameraMode } from "@/state/settings";
import { useHud, type HudSnapshot } from "@/state/matchStore";
import { Arena, type ArenaKind } from "./Arena";
import { Hoop } from "./Hoop";
import { BallMesh } from "./Ball";
import { Players } from "./Players";
import { CameraRig, type CameraState } from "./CameraRig";
import type { UniformStyle } from "./character/uniformTexture";
import { rimPos } from "@/game/court";
import { liveView, REPLAY_CAMS, type ReplayDirector, type ViewFrame } from "./replay";
import { ordinal } from "@/game/commentary";

export const SIM_STEP = 1 / 60;

export interface GameSceneProps {
  match: Match;
  input: InputManager;
  /** Device id for each human controller index. */
  devices: DeviceId[];
  uniforms: [UniformStyle, UniformStyle];
  arena: ArenaKind;
  paused: boolean;
  cameraMode: CameraMode;
  onPauseRequest: () => void;
  onCameraCycle: () => void;
  onTimeoutRequest: (team: 0 | 1) => void;
  timeScale?: number;
  replay: ReplayDirector;
}

function Environment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.55;
    return () => { env.dispose(); pm.dispose(); scene.environment = null; };
  }, [gl, scene]);
  return null;
}

function Lights({ kind, shadows }: { kind: ArenaKind; shadows: boolean }) {
  const key = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const l = key.current;
    if (!l) return;
    l.shadow.mapSize.set(2048, 2048);
    const cam = l.shadow.camera as THREE.OrthographicCamera;
    cam.left = -18; cam.right = 18; cam.top = 12; cam.bottom = -12; cam.near = 1; cam.far = 60;
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 0.02;
    l.target.position.set(0, 0, 0);
    l.target.updateMatrixWorld();
  }, []);
  const gym = kind === "gym";
  return (
    <>
      <hemisphereLight args={[gym ? "#fff6e5" : "#cfd9ff", gym ? "#6b5844" : "#1a1410", gym ? 0.9 : 0.55]} />
      <directionalLight ref={key} position={[3, 26, 6]} intensity={gym ? 1.6 : 2.4} castShadow={shadows} color={gym ? "#fff3dc" : "#ffffff"} />
      {/* rows of arena lights over the floor */}
      {[-10, 0, 10].map((x) => (
        <pointLight key={x} position={[x, gym ? 9 : 18, 0]} intensity={gym ? 90 : 260} distance={gym ? 30 : 46} decay={2} color={gym ? "#ffefd2" : "#ffffff"} />
      ))}
    </>
  );
}

/** Floor ring under each controlled player, colored by controller. */
function ControlMarkers({ match, replayFrame }: { match: Match; replayFrame: React.RefObject<ViewFrame | null> }) {
  const colors = ["#ffb627", "#4cc3ff", "#7dff8a", "#ff6bd6"];
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const geo = useMemo(() => new THREE.RingGeometry(0.42, 0.52, 40), []);
  useFrame(() => {
    const s = match.state;
    for (let h = 0; h < 4; h++) {
      const m = refs.current[h];
      if (!m) continue;
      const ag = s.agents.find((a) => a.human === h);
      m.visible = !!ag && s.phase !== "final" && !replayFrame.current;
      if (ag) m.position.set(ag.pos.x, 0.012, ag.pos.z);
    }
  });
  return (
    <>
      {colors.map((c, i) => (
        <mesh key={i} ref={(el) => { refs.current[i] = el; }} rotation={[-Math.PI / 2, 0, 0]} geometry={geo}>
          <meshBasicMaterial color={c} transparent opacity={0.85} toneMapped={false} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}

function SimDriver(props: GameSceneProps & { camState: React.RefObject<CameraState>; exciteRef: React.RefObject<number>; clockRefs: [React.RefObject<{ shot: number; game: number }>, React.RefObject<{ shot: number; game: number }>]; rimShake: React.RefObject<number[]>; ballPos: React.RefObject<THREE.Vector3 | null>; scoreRef: React.RefObject<{ h: number; a: number; period: string; clock: string }>; benchExcite: React.RefObject<[number, number]> }) {
  const { match, input, devices } = props;
  const acc = useRef(0);
  const settings = useSettings();
  const setHud = useHud((s) => s.set);
  const pushFeed = useHud((s) => s.pushFeed);
  const showBanner = useHud((s) => s.showBanner);
  const heatShown = useRef(new Map<string, number>());
  const lastHud = useRef(0);
  const lastDribblePhase = useRef(0);
  const prevOwner = useRef<number | null>(null);
  const callFor = useRef<number | null>(null);

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
        if (rp.playback.auto ? any("shoot", "pass", "pause", "replay", "switchPlayer") : any("pause", "replay")) { rp.stop(); break; }
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
      if (f.pressed.has("replay") && !props.paused) { const c = rp.recentClip(); if (c) rp.play(c); }
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
      if (!ag) { intents[i] = null; return; }
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
      if (settings.presentation.replays && !s.cfg.practice && s.phase !== "final") rp.play(rp.autoCandidate, { auto: true });
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
          if (s.clock <= 0.05 && (e.kind !== "freeThrow")) banner("BUZZER BEATER", sh.team, nm(e.shooter));
          else if (e.andOne) banner("AND ONE", sh.team, nm(e.shooter));
          else if (s.run.team === sh.team && [8, 12, 16, 20].some((t) => s.run.pts - e.points < t && s.run.pts >= t)) banner(`${s.run.pts}-0 RUN`, sh.team, s.teams[sh.team].team.name);
          else if (sh.heat > 0.7 && s.time - (heatShown.current.get(sh.player.id) ?? -999) > 90) { heatShown.current.set(sh.player.id, s.time); banner(sh.heat > 0.9 ? "ON FIRE" : "HEATING UP", sh.team, nm(e.shooter)); }
        } else if (e.t === "block") banner("REJECTED", s.agents[e.blocker]?.team ?? null, nm(e.blocker));
        else if (e.t === "dribbleMove" && e.broke !== null) banner("ANKLES!", s.agents[e.player]?.team ?? null, nm(e.player));
        else if (e.t === "injury") banner("INJURY", s.agents[e.player]?.team ?? null, `${nm(e.player)}: ${e.name}`);
        else if (e.t === "foulOut") banner("FOULED OUT", s.agents[e.player]?.team ?? null, nm(e.player));
        else if (e.t === "periodStart" && e.period > 1) {
          const per = s.cfg.rules.periods;
          banner(e.period > per ? (e.period - per > 1 ? `OVERTIME ${e.period - per}` : "OVERTIME") : per === 2 ? "SECOND HALF" : ordinal(e.period).replace(" quarter", "").toUpperCase() + " QUARTER", null);
        }
      }
    }

    // ---- presentation side effects
    const pan = (x: number) => THREE.MathUtils.clamp(x / s.cfg.court.halfL, -1, 1) * 0.8;
    for (const e of events) {
      switch (e.t) {
        case "rimHit": audio.rim(e.speed, pan(s.ball.phys.pos.x)); props.rimShake.current![s.ball.phys.pos.x > 0 ? 0 : 1] = Math.min(1, e.speed / 4); break;
        case "boardHit": audio.board(e.speed, pan(s.ball.phys.pos.x)); break;
        case "floorBounce": if (s.ball.mode !== "dribble") audio.dribble(pan(s.ball.phys.pos.x), Math.min(1, e.speed / 5)); break;
        case "swish": audio.swish(); break;
        case "make": {
          audio.netRustle();
          const big = e.kind === "dunk" || e.points === 3;
          audio.cheer(big ? 0.9 : 0.5);
          if (e.kind === "dunk" && settings.camera.shake) props.camState.current!.shake = 0.8;
          props.exciteRef.current = big ? 1 : 0.7;
          if (big || e.andOne) props.benchExcite.current![s.agents[e.shooter].team] = 2.6;
          const sh = s.agents[e.shooter];
          if (sh.human !== null && settings.gameplay.vibration) input.rumble(devices[sh.human], 0.4, 0.6, 180);
          break;
        }
        case "block": audio.board(3); audio.cheer(0.7); props.exciteRef.current = 0.9; props.benchExcite.current![s.agents[e.blocker].team] = 2.2; break;
        case "foul": case "violation": audio.whistle(); break;
        case "buzzer": audio.buzzer(); break;
        case "steal": audio.catchBall(); audio.cheer(0.5); break;
        case "pass": break;
        case "crowd": props.exciteRef.current = Math.max(props.exciteRef.current ?? 0, e.level); break;
        case "miss": audio.groan(); break;
        default: break;
      }
      if (settings.presentation.commentary) {
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
      if (ph < lastDribblePhase.current - 0.5 || (lastDribblePhase.current < 0.5 && ph >= 0.5)) audio.dribble(pan(s.ball.phys.pos.x), 0.7);
      lastDribblePhase.current = ph;
    }
    if (prevOwner.current !== s.ball.owner && s.ball.owner !== null) audio.catchBall(pan(s.ball.phys.pos.x));
    prevOwner.current = s.ball.owner;
    // sneaker squeaks on hard cuts
    for (const a of s.agents) {
      const sp = Math.hypot(a.vel.x, a.vel.z);
      if (sp > 4 && a.stun === 0 && Math.random() < dt * 0.6 && a.action.kind !== "idle") audio.squeak(pan(a.pos.x));
    }
    // crowd energy: decays toward a baseline that rises late in close games
    const close = Math.abs(s.teams[0].score - s.teams[1].score) <= 6;
    const late = s.period >= s.cfg.rules.periods && s.clock < 120;
    const base = 0.25 + (close && late ? 0.35 : 0) + (s.phase === "freethrows" ? -0.15 : 0);
    props.exciteRef.current = THREE.MathUtils.damp(props.exciteRef.current ?? base, base, 0.6, dt);
    audio.crowdLevel(props.exciteRef.current);

    // shared refs for scene props
    for (const ref of props.clockRefs) if (ref.current) { ref.current.shot = s.shotClock; ref.current.game = s.clock; }
    props.ballPos.current = s.ball.mode === "shot" || s.ball.mode === "loose" || s.ball.mode === "dead" || s.ball.mode === "ft" ? new THREE.Vector3(s.ball.phys.pos.x, s.ball.phys.pos.y, s.ball.phys.pos.z) : null;
    const per = s.cfg.rules.periods;
    const periodLabel = s.period > per ? `OT${s.period - per > 1 ? s.period - per : ""}` : per === 2 ? `H${s.period}` : `Q${s.period}`;
    props.scoreRef.current = { h: s.teams[0].score, a: s.teams[1].score, period: periodLabel, clock: fmtClock(s.clock) };

    // HUD at ~20 Hz
    const now = performance.now();
    if (now - lastHud.current > 50) {
      lastHud.current = now;
      const ctrl = s.agents.find((a) => a.human === 0) ?? null;
      const shooter = s.agents.find((a) => a.human !== null && (["jumper", "fadeaway", "floater", "hook", "layup"].includes(a.action.kind) || (a.action.kind === "freeThrow" && a.action.data.started)));
      let meter: HudSnapshot["meter"] = null;
      if (shooter && settings.gameplay.shotMeter) {
        const d = shooter.action.data;
        const ideal = Number(d.ideal ?? 0.5);
        const relAt = Number(d.releasedAt ?? -1);
        const t = relAt >= 0 ? relAt : shooter.action.t;
        const q = Math.abs((t - ideal) / 0.22);
        meter = {
          active: relAt < 0, fill: Math.min(1, t / (ideal * 1.35)), ideal: 1 / 1.35,
          result: relAt < 0 ? null : q < 0.08 ? "green" : q < 0.22 ? "good" : t < ideal ? "early" : "late",
          side: shooter.team,
        };
      }
      setHud({
        homeScore: s.teams[0].score, awayScore: s.teams[1].score, period: s.period, periods: per,
        clock: s.clock, shotClock: s.cfg.rules.shotClock ? s.shotClock : null, phase: s.phase,
        homeFouls: s.teams[0].fouls, awayFouls: s.teams[1].fouls, homeTimeouts: s.teams[0].timeouts, awayTimeouts: s.teams[1].timeouts,
        possession: s.offense, bonus: [match.inBonus(1), match.inBonus(0)], meter,
        controlled: ctrl ? { name: `${ctrl.player.firstName[0]}. ${ctrl.player.lastName}`, number: ctrl.player.jersey, stamina: ctrl.stamina, team: ctrl.team } : null,
      });
    }
  });
  return null;
}

/** Jersey number and name floating over each player (DOM, positioned from the 3D scene). */
function NameTags({ match, replayFrame }: { match: Match; replayFrame: React.RefObject<ViewFrame | null> }) {
  const { camera, gl } = useThree();
  const enabled = useSettings((s) => s.gameplay.showPlayerNames);
  const els = useRef<HTMLDivElement[]>([]);
  const ids = useRef<string[]>([]);
  const v3 = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    Object.assign(host.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "15", overflow: "hidden" });
    document.body.appendChild(host);
    els.current = Array.from({ length: 10 }, () => {
      const d = document.createElement("div");
      d.className = "bl-tag";
      host.appendChild(d);
      return d;
    });
    return () => host.remove();
  }, []);
  useFrame(() => {
    const s = match.state;
    const v = replayFrame.current ?? liveView(match);
    const show = enabled && !replayFrame.current && s.phase !== "final" && s.phase !== "timeout" && s.phase !== "halftime" && s.phase !== "periodEnd";
    const rect = gl.domElement.getBoundingClientRect();
    els.current.forEach((el, i) => {
      const ag = v.agents[i];
      if (!show || !ag) { el.style.display = "none"; return; }
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
      if (v3.z > 1 || Math.abs(v3.x) > 1.1 || Math.abs(v3.y) > 1.1) { el.style.display = "none"; return; }
      const x = rect.left + (v3.x * 0.5 + 0.5) * rect.width;
      const y = rect.top + (-v3.y * 0.5 + 0.5) * rect.height;
      el.style.display = "flex";
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      const key = ag.human !== null || v.ball.owner === ag.idx;
      el.style.opacity = key ? "1" : "0.6";
    });
  });
  return null;
}

/** Advances replay playback and points the camera for the chosen replay angle. */
function ReplayDriver({ match, replay, frameRef, camState, ballPos }: {
  match: Match; replay: ReplayDirector; frameRef: React.RefObject<ViewFrame | null>;
  camState: React.RefObject<CameraState>; ballPos: React.RefObject<THREE.Vector3 | null>;
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
      if (frameRef.current) { cs.override = null; cs.cut = true; }
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
    const ag = keyAg ? f.agents.find((a) => a.player.id === keyAg.player.id) ?? null : null;
    const c = match.state.cfg.court;
    const tx = ag ? ag.pos.x : b.pos.x, tz = ag ? ag.pos.z : b.pos.z;
    const team = ag ? ag.team : f.offense;
    const rimX = f.rimX[team];
    const sign = Math.sign(rimX) || 1;
    const look = new THREE.Vector3(tx * 0.6 + b.pos.x * 0.4, 1.3 + (ag ? ag.y * 0.6 : 0), tz * 0.6 + b.pos.z * 0.4);
    let pos: THREE.Vector3, fov = 38;
    orbit.current += dt * 0.35 * pbNow.speed;
    switch (REPLAY_CAMS[pbNow.cam].id) {
      case "orbit": {
        const a = orbit.current + (sign > 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
        pos = new THREE.Vector3(tx + Math.sin(a) * 6.5, 2.4, tz + Math.cos(a) * 6.5);
        fov = 40;
        break;
      }
      case "baseline":
        pos = new THREE.Vector3(sign * (c.halfL + 3.5), 2.1, tz * 0.4);
        fov = 34;
        break;
      case "rim":
        pos = new THREE.Vector3(rimX - sign * 0.8, 6.2, 1.8);
        look.set(tx * 0.5 + rimX * 0.5, 1.2, tz * 0.5);
        fov = 50;
        break;
      case "courtside":
        pos = new THREE.Vector3(tx - sign * 2.5, 1.25, (tz >= 0 ? 1 : -1) * (c.halfW + 3));
        fov = 36;
        break;
      default:
        pos = new THREE.Vector3(b.pos.x * 0.85, 9.5, c.halfW + 17);
        look.set(b.pos.x, 1.1, b.pos.z * 0.25);
        fov = 30;
    }
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
    let raf = 0, last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last >= 1000 / fps - 1) { last = t; invalidate(); }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [fps, invalidate]);
  return null;
}

/** Tiny frame-rate readout rendered into a fixed DOM element. */
function FpsCounter() {
  const el = useRef<HTMLDivElement | null>(null);
  const frames = useRef({ n: 0, t: performance.now() });
  useEffect(() => {
    const d = document.createElement("div");
    d.setAttribute("aria-hidden", "true");
    Object.assign(d.style, { position: "fixed", top: "8px", left: "8px", zIndex: "60", font: "600 12px var(--font-body)", color: "#ffb627", background: "rgba(13,27,46,.8)", padding: "2px 6px", borderRadius: "4px", pointerEvents: "none" });
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
      f.n = 0; f.t = now;
    }
  });
  return null;
}

export function fmtClock(sec: number) {
  if (sec < 60) return Math.max(0, sec).toFixed(1);
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function GameScene(props: GameSceneProps) {
  const g = useSettings((s) => s.graphics);
  const cam = useSettings((s) => s.camera);
  const camState = useRef<CameraState>({ forward: new THREE.Vector2(0, -1), shake: 0, override: null, cut: false });
  const replayFrame = useRef<ViewFrame | null>(null);
  const benchExcite = useRef<[number, number]>([0, 0]);
  const benchSize = props.match.state.cfg.practice ? 0 : g.preset === "low" ? 0 : g.preset === "medium" ? 4 : 9;
  const excite = useRef(0.3);
  const clockA = useRef({ shot: 24, game: 720 });
  const clockB = useRef({ shot: 24, game: 720 });
  const rimShake = useRef([0, 0]);
  const ballPos = useRef<THREE.Vector3 | null>(null);
  const scoreRef = useRef({ h: 0, a: 0, period: "Q1", clock: "12:00" });
  const ballMesh = useRef<THREE.Mesh>(null);
  const s = props.match.state;
  const court = s.cfg.court;
  const home = s.teams[0].team, away = s.teams[1].team;
  const quality = g.preset;
  const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 1, 2) * g.resolutionScale;

  useEffect(() => {
    audio.startCrowd();
    return () => audio.stopCrowd();
  }, []);

  return (
    <Canvas
      shadows={g.shadows ? { type: THREE.PCFShadowMap } : false}
      dpr={dpr}
      gl={{ antialias: !g.antialias ? false : false, powerPreference: "high-performance", stencil: false }}
      camera={{ fov: 30, near: 0.5, far: 400, position: [0, 9, 26] }}
      onCreated={({ gl, scene, camera }) => {
        if (process.env.NODE_ENV !== "production") (window as unknown as { __bl: unknown }).__bl = { scene, camera, gl, match: props.match, THREE, camState };
        gl.toneMapping = THREE.NoToneMapping;
        gl.outputColorSpace = THREE.SRGBColorSpace;
      }}
      frameloop={g.fpsCap > 0 && g.fpsCap < 120 ? "demand" : "always"}
    >
      {g.fpsCap > 0 && g.fpsCap < 120 && <FrameCap fps={g.fpsCap} />}
      {g.showFps && <FpsCounter />}
      <color attach="background" args={[props.arena === "gym" ? "#bdb4a3" : "#05070a"]} />
      <fog attach="fog" args={[props.arena === "gym" ? "#bdb4a3" : "#05070a", 45, 140]} />
      <ReplayDriver match={props.match} replay={props.replay} frameRef={replayFrame} camState={camState} ballPos={ballPos} />
      <Environment />
      <Lights kind={props.arena} shadows={g.shadows} />
      <Suspense fallback={null}>
        <Arena court={court} home={home} away={away} kind={props.arena} quality={quality} crowdDensity={g.crowdDensity} exciteRef={excite} scoreRef={scoreRef} />
        {([1, -1] as const).map((side, i) => (
          <Hoop key={side} court={court} side={side} team={home} ceilingHung={props.arena === "gym"} ballRef={ballPos} clockRef={i === 0 ? clockA : clockB} rimShake={rimShake} />
        ))}
        <BallMesh ref={ballMesh} radius={court.ballRadius} />
        <Players match={props.match} uniforms={props.uniforms} ballMesh={ballMesh} replayFrame={replayFrame} benchSize={benchSize} benchExcite={benchExcite} />
        <ControlMarkers match={props.match} replayFrame={replayFrame} />
        <NameTags match={props.match} replayFrame={replayFrame} />
      </Suspense>
      <CameraRig match={props.match} mode={props.cameraMode} zoom={cam.zoom} heightMul={cam.height} stateRef={camState} focusAgent={() => s.agents.find((a) => a.human === 0)?.idx ?? s.ball.owner} />
      <SimDriver {...props} camState={camState} exciteRef={excite} clockRefs={[clockA, clockB]} rimShake={rimShake} ballPos={ballPos} scoreRef={scoreRef} benchExcite={benchExcite} />
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
