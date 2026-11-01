"use client";
// The main menu's trailer: real players, arenas and parks, staged shot by shot and cut together.
// It runs on its own clock, so it plays the same way every time and picks up where it was after a hidden tab.
import { PerformanceMonitor, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Noise, ToneMapping, Vignette } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { generateRoster, playerOvr } from "@/engine/player";
import type { Player, Team } from "@/engine/types";
import { courtFor, rimPos } from "@/game/court";
import { parkById } from "@/game/park/parks";
import { useSettings } from "@/state/settings";
import { Arena } from "./Arena";
import { pickVariant, variant } from "./arena/variants";
import { BallMesh } from "./Ball";
import { Avatar, type PoseInput } from "./character/Avatar";
import { Hoop } from "./Hoop";
import { Env } from "./MenuBackdrop";
import { PARK_WORLD, ParkLights, ParkScene, parkSky } from "./park/ParkScene";
import { PLAYER_GLB, useMasks } from "./Players";
import {
  FADE,
  HALFCOURT,
  PARK_SHOT,
  SHOTS,
  ballArc,
  breakHeroX,
  cameraFor,
  clamp01,
  dribbleHeight,
  fadeAt,
  halfcourtBall,
  parkHero,
  shotAt,
  type ShotId,
  type Vec3,
} from "./trailer/timeline";

const PARK_ID = "boardwalk";
const park = parkById(PARK_ID);
const court = courtFor("pro");
// park courts use high school dimensions, so the shot there aims at a different rim
const parkCourt = courtFor("hs");
const asVec = (r: { x: number; y: number; z: number }): Vec3 => [r.x, r.y, r.z];
const arenaRim = asVec(rimPos(court, 1));
const parkRim = asVec(rimPos(parkCourt, 1));
const CONFETTI = 260;
const ARENA_BG = "#05070a";

const pose = (over: Partial<PoseInput>, player: Player): PoseInput => ({
  x: 0,
  y: 0,
  z: 0,
  facing: Math.PI / 2,
  vx: 0,
  vz: 0,
  action: "idle",
  actionT: 0,
  actionDur: 0,
  actionData: {},
  hasBall: false,
  dribbling: false,
  hand: 1,
  ballWorld: null,
  lookAt: null,
  stance: false,
  stamina: 1,
  dt: 1 / 60,
  heightM: player.heightIn * 0.0254,
  airborne: false,
  celebrate: false,
  ...over,
});

/** Everything that moves. Runs once a frame from the trailer's own clock. */
function Director({
  home,
  away,
  startAt,
  frozen,
  parkReady,
  black,
  dark,
  onShot,
}: {
  home: Team;
  away: Team;
  startAt: number;
  frozen: boolean;
  parkReady: React.RefObject<boolean>;
  black: React.RefObject<HTMLDivElement | null>;
  dark: React.RefObject<HTMLDivElement | null>;
  onShot: (id: ShotId, index: number) => void;
}) {
  const { camera, scene } = useThree();
  const gltf = useGLTF(PLAYER_GLB) as unknown as GLTF;
  const masks = useMasks();
  const cast = useMemo(() => {
    const best = (t: Team, n: number) => [...generateRoster(t, 1)].sort((a, b) => playerOvr(b) - playerOvr(a)).slice(0, n);
    const [star, mate] = best(home, 2);
    // the face of the trailer: always the same player, with a clean look for the close shots
    const hero: Player = { ...star, appearance: { ...star.appearance, hairStyle: 3, facialHair: 0, headband: false } };
    const [d1, d2] = best(away, 2);
    return { hero, mate, d1, d2 };
  }, [home, away]);
  const avatars = useMemo(
    () => ({
      hero: new Avatar(gltf, masks, cast.hero, home, "home"),
      mate: new Avatar(gltf, masks, cast.mate, home, "home"),
      d1: new Avatar(gltf, masks, cast.d1, away, "away"),
      d2: new Avatar(gltf, masks, cast.d2, away, "away"),
    }),
    [gltf, masks, cast, home, away],
  );
  useEffect(
    () => () => {
      for (const a of Object.values(avatars)) a.dispose();
    },
    [avatars],
  );
  const clock = useRef(startAt);
  const shown = useRef(-1);
  const stage = useThree((s) => s.scene);
  const refs = useRef({
    ball: null as THREE.Mesh | null,
    mic: null as THREE.Group | null,
    spot: null as THREE.SpotLight | null,
    confetti: null as THREE.InstancedMesh | null,
  });
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const flakes = useMemo(
    () =>
      Array.from({ length: CONFETTI }, (_, i) => {
        const a = (i * 2.399963) % (Math.PI * 2);
        const r = 1 + ((i * 7) % 90) / 10;
        return { x: Math.cos(a) * r, z: Math.sin(a) * r, y: 3 + ((i * 13) % 110) / 10, spin: 1 + (i % 7) * 0.6, drift: i % 5 };
      }),
    [],
  );
  const colors = useMemo(() => [home.colors.primary, "#ffb627", "#f2f5f8"].map((c) => new THREE.Color(c)), [home]);
  const ballPos = useMemo(() => new THREE.Vector3(), []);
  const trail = useRef<(THREE.Mesh | null)[]>([]);

  useFrame((_, dt) => {
    if (!frozen) clock.current += Math.min(dt, 0.05);
    let { index, shot, local } = shotAt(clock.current);
    // the park is a big download on a first visit: skip it until it's ready
    if (shot.id === "park" && !parkReady.current && !frozen) {
      clock.current += shot.duration - local;
      ({ index, shot, local } = shotAt(clock.current));
    }
    const id = shot.id;
    if (index !== shown.current) {
      shown.current = index;
      onShot(id, index);
      const sky = parkSky(park).horizon;
      scene.background = new THREE.Color(id === "park" ? sky : ARENA_BG);
      scene.fog = id === "park" ? new THREE.Fog(sky, PARK_WORLD.fogNear, PARK_WORLD.fogFar) : new THREE.Fog(ARENA_BG, 40, 120);
      // the parks run out to the horizon, far past what an arena needs
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.far = id === "park" ? PARK_WORLD.cameraFar : 400;
        camera.updateProjectionMatrix();
      }
    }
    const arena = stage.getObjectByName("trailer-arena");
    const parkGroup = stage.getObjectByName("trailer-park");
    if (arena) arena.visible = id !== "park";
    if (parkGroup) parkGroup.visible = id === "park";
    const rim = id === "park" ? parkRim : arenaRim;
    if (black.current) black.current.style.opacity = String(frozen ? 0 : fadeAt(local, shot.duration));

    const hero: Partial<PoseInput> = {};
    const others: Record<"mate" | "d1" | "d2", Partial<PoseInput> | null> = { mate: null, d1: null, d2: null };
    const ball: Vec3 = [0, -5, 0];
    let shake = 0;
    let swish = false;

    if (id === "break") {
      const x = breakHeroX(local);
      Object.assign(hero, { x, z: 0.4, vx: 5.2, dribbling: true, hasBall: true });
      Object.assign(ball, [x + 0.5, dribbleHeight(local), 0.02]);
      // everyone else is behind the play, so nothing crosses the lens
      others.d1 = { x: x - 1.6, z: 2, vx: 5.2 };
      others.mate = { x: x - 3, z: 4, vx: 5.2 };
      others.d2 = { x: x - 4.4, z: 3, vx: 5.2 };
    } else if (id === "dunk") {
      // slow motion: the game clock runs at about a third of real time
      const t = local * 0.27;
      const air = clamp01((t - 0.12) / 0.92);
      const x = rim[0] - 2.5 + 2.15 * clamp01(t / 0.62);
      const y = Math.sin(Math.PI * air) * 1.02;
      const up = air > 0 && air < 1;
      Object.assign(hero, { x, y, vx: up ? 0 : 3, action: "dunk", actionT: t, actionDur: 1.1, actionData: { release: 0.5 }, airborne: up, hasBall: t < 0.5 });
      if (t < 0.5) Object.assign(ball, [x + 0.4, y + 1.5 + 0.95 * clamp01(t / 0.5), 0.1]);
      else {
        const fall = t - 0.5;
        Object.assign(ball, [rim[0] - 0.05, Math.max(0.12, rim[1] - 0.1 - 4.9 * fall * fall * 6), 0]);
        if (fall < 0.06) shake = 1;
        swish = true;
      }
      others.d1 = { x: rim[0] - 1.5, z: 2.4, facing: -Math.PI / 2, stance: true };
    } else if (id === "interview") {
      Object.assign(hero, { x: 3, z: 2, facing: 0.1, lookAt: new THREE.Vector3(3.7 + Math.sin(local * 0.8) * 0.3, 1.8, 5) });
    } else if (id === "park") {
      const start = PARK_SHOT.start;
      const t = Math.max(0, local - start);
      const released = t > PARK_SHOT.release;
      const [x] = parkHero(rim);
      const air = clamp01((t - 0.3) / 1);
      const y = Math.sin(Math.PI * air) * 0.5;
      Object.assign(hero, {
        x,
        y,
        z: 1.8,
        action: "jumper",
        actionT: t,
        actionDur: 2.2,
        actionData: { jumpAt: 0.3, release: PARK_SHOT.release },
        airborne: air > 0 && air < 1,
        hasBall: !released,
      });
      if (!released) Object.assign(ball, [x + 0.3, y + 1.3 + 0.9 * clamp01(t / PARK_SHOT.release), 1.8]);
      else {
        const k = (t - PARK_SHOT.release) / PARK_SHOT.flight;
        Object.assign(ball, k < 1 ? ballArc([x + 0.35, y + 2.3, 1.8], [rim[0], rim[1], 0], 5.2, k) : [rim[0], Math.max(0.12, rim[1] - (k - 1) * 3), 0]);
        swish = k > 0.9;
      }
      others.d1 = { x: x + 1.1, z: 1.5, facing: -Math.PI / 2, stance: t < 0.3 };
    } else if (id === "halfcourt") {
      const rel = HALFCOURT.release;
      const released = local > rel;
      const air = clamp01((local - 0.8) / 1.1);
      const y = Math.sin(Math.PI * air) * 0.55;
      const k = (local - rel) / HALFCOURT.flight;
      Object.assign(hero, {
        x: 0,
        y,
        z: 0,
        action: k > 1.1 ? "idle" : "jumper",
        actionT: local * 0.7,
        actionDur: 2.4,
        actionData: { jumpAt: 0.5, release: rel * 0.7 },
        airborne: air > 0 && air < 1,
        hasBall: !released,
        celebrate: k > 1.1,
      });
      if (!released) Object.assign(ball, [0.3, y + 1.3 + 1 * clamp01(local / rel), 0]);
      else {
        Object.assign(ball, k < 1 ? ballArc([0.35, y + 2.4, 0], rim, HALFCOURT.apex, k) : [rim[0], Math.max(0.12, rim[1] - (k - 1) * 3.2), 0]);
        swish = k > 0.92;
      }
      others.d1 = { x: 1.6, z: 0.8, facing: -Math.PI / 2, stance: local < rel };
      others.mate = { x: -7, z: 4, celebrate: k > 1.1 };
    } else {
      Object.assign(hero, { x: 0, z: 0, facing: 0, celebrate: local > 2.6, lookAt: new THREE.Vector3(0, 6, 8) });
    }

    const heroPos: Vec3 = [hero.x ?? 0, hero.y ?? 0, hero.z ?? 0];
    ballPos.set(ball[0], ball[1], ball[2]);
    const ballNow = ballPos.y > 0 ? ballPos : null;
    const frameDt = Math.min(dt, 0.05);
    avatars.hero.update(pose({ ...hero, dt: frameDt, ballWorld: ballNow }, cast.hero));
    avatars.hero.root.visible = true;
    for (const k of ["mate", "d1", "d2"] as const) {
      const p = others[k];
      avatars[k].root.visible = !!p;
      if (p) avatars[k].update(pose({ ...p, dt: frameDt }, cast[k]));
    }
    const r = refs.current;
    if (r.ball) {
      r.ball.position.copy(ballPos);
      r.ball.rotation.x += frameDt * 6;
      r.ball.visible = ball[1] > 0;
    }
    if (r.mic) r.mic.visible = id === "interview";
    if (r.spot) r.spot.intensity = id === "legend" ? 26 * clamp01(local / 0.8) : 0;
    if (dark.current) dark.current.style.opacity = String(id === "legend" ? clamp01(local / 1.2) : 0);
    for (const [i, m] of trail.current.entries()) {
      if (!m) continue;
      const back = (i + 1) * 0.022;
      const on = id === "halfcourt" && !swish && local - back > HALFCOURT.release;
      m.visible = on;
      if (on) m.position.set(...halfcourtBall(local - back, rim));
    }
    if (r.confetti) {
      r.confetti.visible = id === "legend" && local > 2.4;
      if (r.confetti.visible) {
        flakes.forEach((f, i) => {
          const fall = (f.y + 14 - ((local - 2.4) * 1.5 + i * 0.01)) % 14;
          dummy.position.set(f.x + Math.sin(local + f.drift) * 0.4, fall, f.z);
          dummy.rotation.set(local * f.spin, local * f.spin * 0.7, 0);
          dummy.updateMatrix();
          r.confetti!.setMatrixAt(i, dummy.matrix);
        });
        r.confetti.instanceMatrix.needsUpdate = true;
      }
    }
    trailerState.crowd =
      shot.crowd + (id === "dunk" && ball[1] < 3 ? 0.3 : 0) + (id === "halfcourt" && (local - HALFCOURT.release) / HALFCOURT.flight > 1 ? 0.5 : 0);
    trailerState.lights = shot.lights;
    trailerState.shake = shake;
    trailerState.ball = swish ? ballPos : null;
    trailerState.scene = id;
    trailerState.local = local;

    const cam = cameraFor(id, local, rim, id === "halfcourt" ? [0, 0, 0] : heroPos, id === "halfcourt" ? halfcourtBall(local, rim) : ball);
    camera.position.set(...cam.pos);
    camera.lookAt(...cam.look);
    if (camera instanceof THREE.PerspectiveCamera && camera.fov !== cam.fov) {
      camera.fov = cam.fov;
      camera.updateProjectionMatrix();
    }
  });

  return (
    <>
      {Object.values(avatars).map((a, i) => (
        <primitive key={i} object={a.root} />
      ))}
      <BallMesh ref={(m) => void (refs.current.ball = m)} radius={court.ballRadius} />
      {/* the half-court shot's tail, so the ball reads in the air */}
      {Array.from({ length: 8 }, (_, i) => (
        <mesh key={i} ref={(m) => void (trail.current[i] = m)} visible={false}>
          <sphereGeometry args={[court.ballRadius * (1 - i * 0.09), 12, 8]} />
          <meshBasicMaterial color="#ffb627" transparent opacity={0.26 - i * 0.03} depthWrite={false} />
        </mesh>
      ))}
      {/* the reporter's microphone, just in frame */}
      <group ref={(g) => void (refs.current.mic = g)} position={[3.3, 1.18, 3.1]} rotation={[-0.45, 0, -0.35]} scale={0.6}>
        <mesh position={[0, 0.17, 0]}>
          <sphereGeometry args={[0.05, 20, 14]} />
          <meshStandardMaterial color="#17191d" roughness={0.9} />
        </mesh>
        <mesh>
          <cylinderGeometry args={[0.018, 0.024, 0.3, 14]} />
          <meshStandardMaterial color="#2c2f36" metalness={0.5} roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.07, 0]}>
          <boxGeometry args={[0.08, 0.06, 0.08]} />
          <meshStandardMaterial color="#ffb627" roughness={0.5} />
        </mesh>
      </group>
      <spotLight
        ref={(s) => void (refs.current.spot = s)}
        position={[0, 18, 2]}
        angle={0.2}
        penumbra={0.7}
        intensity={0}
        distance={40}
        decay={1.4}
        color="#ffe9c4"
      />
      <instancedMesh ref={(m) => void (refs.current.confetti = m)} args={[undefined, undefined, CONFETTI]} visible={false}>
        <planeGeometry args={[0.09, 0.14]} />
        <meshStandardMaterial side={THREE.DoubleSide} color={colors[1]} emissive={colors[1]} emissiveIntensity={0.6} roughness={0.6} />
      </instancedMesh>
    </>
  );
}

/** What the scene's refs read each frame. */
const trailerState = { crowd: 0.5, lights: 1, shake: 0, ball: null as THREE.Vector3 | null, scene: "break" as ShotId, local: 0 };

function SceneDriver({
  excite,
  shake,
  ball,
  score,
  clock,
  house,
}: {
  excite: React.RefObject<number>;
  shake: React.RefObject<number[]>;
  ball: React.RefObject<THREE.Vector3 | null>;
  score: React.RefObject<{ h: number; a: number; period: string; clock: string }>;
  clock: React.RefObject<{ shot: number; game: number }>;
  house: React.RefObject<THREE.Group | null>;
}) {
  useFrame(() => {
    excite.current = Math.min(1, trailerState.crowd);
    if (trailerState.shake) shake.current[0] = trailerState.shake;
    ball.current = trailerState.ball;
    const left = trailerState.scene === "halfcourt" ? Math.max(0, 3 - trailerState.local * 0.65) : 42;
    score.current.h = 104;
    score.current.a = 106;
    score.current.period = "Q4";
    score.current.clock = left < 10 ? left.toFixed(1) : "0:42";
    clock.current.game = left;
    clock.current.shot = Math.ceil(Math.min(24, left));
    house.current?.traverse((o) => {
      const l = o as THREE.Light;
      if (l.isLight) l.intensity = (l.userData.base ??= l.intensity) * trailerState.lights;
    });
  });
  return null;
}

export default function MenuTrailer({ home, away, startAt = 0, frozen = false }: { home: Team; away: Team; startAt?: number; frozen?: boolean }) {
  const g = useSettings((s) => s.graphics);
  const reduced = useSettings((s) => s.accessibility.reducedMotion);
  const still = frozen || reduced;
  const venue = useMemo(() => variant(pickVariant("pro", home)), [home]);
  const excite = useRef(0.5);
  const score = useRef({ h: 104, a: 106, period: "Q4", clock: "0:42" });
  const clock = useRef({ shot: 24, game: 42 });
  const ball = useRef<THREE.Vector3 | null>(null);
  const shake = useRef([0, 0]);
  const house = useRef<THREE.Group>(null);
  const black = useRef<HTMLDivElement>(null);
  const dark = useRef<HTMLDivElement>(null);
  const parkReady = useRef(false);
  const [dpr, setDpr] = useState(() => Math.min(1.5, typeof window !== "undefined" ? window.devicePixelRatio : 1));
  const reactRef = useRef<[number, number]>([0, 0]);
  const [shot, setShot] = useState<{ id: ShotId; index: number }>({ id: SHOTS[0].id, index: 0 });
  const quality = g.preset === "ultra" ? "high" : g.preset;
  // a still picture holds on the last shot, past the moment the lights come down
  const begin = reduced ? SHOTS.slice(0, -1).reduce((a, s) => a + s.duration, 0) + 3.6 : startAt;
  return (
    <div className="absolute inset-0" data-trailer-shot={shot.id}>
      <Canvas
        dpr={dpr}
        camera={{ fov: 38, near: 0.1, far: 400 }}
        gl={{ antialias: false, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.NoToneMapping;
        }}
      >
        {/* slower computers trade sharpness for a smooth picture */}
        <PerformanceMonitor onDecline={() => setDpr((d) => Math.max(0.75, d - 0.25))} />
        <color attach="background" args={[ARENA_BG]} />
        <Env />
        <Suspense fallback={null}>
          <group name="trailer-arena">
            <group ref={house}>
              <hemisphereLight args={["#cfd9ff", "#1a1410", 0.6]} />
              <directionalLight position={[3, 26, 6]} intensity={2.2} />
              {[-10, 0, 10].map((x) => (
                <pointLight key={x} position={[x, 18, 0]} intensity={240} distance={46} decay={2} />
              ))}
            </group>
            <Arena
              court={court}
              home={home}
              away={away}
              venue={venue}
              quality={quality}
              crowdDensity={g.crowdDensity * 0.9}
              exciteRef={excite}
              reactRef={reactRef}
              scoreRef={score}
            />
            {([1, -1] as const).map((side) => (
              <Hoop key={side} court={court} side={side} team={home} mountY={venue.girderY} ballRef={ball} clockRef={clock} rimShake={shake} />
            ))}
          </group>
          <Suspense fallback={null}>
            <group name="trailer-park" visible={false}>
              <ParkLights park={park} shadows={false} />
              <ParkScene park={park} court={parkCourt} quality={quality} exciteRef={excite} reactRef={reactRef} />
              {([1, -1] as const).map((side) => (
                <Hoop key={side} court={parkCourt} side={side} team={home} outdoor={park.hoop} ballRef={ball} clockRef={clock} rimShake={shake} />
              ))}
            </group>
            <ParkLoaded ready={parkReady} />
          </Suspense>
          <SceneDriver excite={excite} shake={shake} ball={ball} score={score} clock={clock} house={house} />
          <Director
            home={home}
            away={away}
            startAt={begin}
            frozen={still}
            parkReady={parkReady}
            black={black}
            dark={dark}
            onShot={(id, index) => setShot({ id, index })}
          />
        </Suspense>
        <EffectComposer multisampling={0}>
          {g.bloom ? <Bloom intensity={0.6} luminanceThreshold={0.8} mipmapBlur /> : <></>}
          <ToneMapping mode={ToneMappingMode.AGX} />
          <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.22} />
          <Vignette offset={0.2} darkness={0.85} />
        </EffectComposer>
      </Canvas>
      {/* the house goes dark around the Legend */}
      <div
        ref={dark}
        className="pointer-events-none absolute inset-0"
        style={{ opacity: 0, background: "radial-gradient(ellipse 34% 62% at 50% 54%, transparent 12%, rgba(0,0,0,0.95) 100%)" }}
        aria-hidden
      />
      {/* black between shots, and until the first one is ready */}
      <div ref={black} className="pointer-events-none absolute inset-0 bg-black" style={{ transition: `opacity ${FADE / 3}s linear` }} aria-hidden />
      <div key={shot.index} className="pointer-events-none absolute inset-x-0 bottom-[9vh] hidden justify-end pr-[5vw] text-right lg:flex" aria-hidden>
        {shot.id === "interview" && (
          <div className="trailer-caption rounded bg-navy/90 px-5 py-3 ring-1 ring-amber">
            <p className="text-xs font-bold uppercase tracking-widest text-amber">Postgame interview</p>
            <p className="font-display text-2xl font-black">&ldquo;I told you. We&apos;re just getting started.&rdquo;</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Builds the park's shaders in the background, so its shot doesn't freeze the trailer the first time it comes up. */
function ParkLoaded({ ready }: { ready: React.RefObject<boolean> }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    let live = true;
    gl.compileAsync(scene, camera).finally(() => {
      if (live) ready.current = true;
    });
    return () => {
      live = false;
    };
  }, [gl, scene, camera, ready]);
  return null;
}
