"use client";
// Developer animation lab: drives one Avatar through every action with a scrubber.
import { useGLTF, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Player, Team } from "@/engine/types";
import { Avatar, type PoseInput } from "../character/Avatar";
import { PLAYER_GLB, useMasks } from "../Players";

export interface Clip {
  id: string;
  label: string;
  dur: number;
  /** Builds the pose input at time t (seconds) within the clip. */
  at: (t: number) => Partial<PoseInput>;
}

const G = 9.81;
function jumpY(t: number, jumpAt: number, height: number) {
  if (t < jumpAt) return 0;
  const vy = Math.sqrt(2 * G * height);
  const tt = t - jumpAt;
  return Math.max(0, vy * tt - 0.5 * G * tt * tt);
}
function dribbleBall(t: number, x: number, z: number, h: number, speed = 0) {
  const ph = (t * (1.6 + speed * 0.28)) % 1;
  const y = 0.12 + (h * 0.5 - 0.12) * Math.abs(Math.cos(ph * Math.PI));
  return new THREE.Vector3(x - 0.3 * 1, y, z + 0.32);
}

export const CLIPS: Clip[] = [
  { id: "idle", label: "Idle", dur: 3, at: () => ({ action: "idle" }) },
  { id: "tired", label: "Tired idle", dur: 3, at: () => ({ action: "idle", stamina: 0.3 }) },
  { id: "walk", label: "Walk", dur: 2, at: () => ({ action: "move", vz: 1.8 }) },
  { id: "run", label: "Run", dur: 2, at: () => ({ action: "move", vz: 5 }) },
  { id: "sprint", label: "Sprint", dur: 2, at: () => ({ action: "move", vz: 8 }) },
  { id: "stance", label: "Defensive stance", dur: 2, at: () => ({ action: "stance", stance: true }) },
  { id: "slide", label: "Defensive slide", dur: 2, at: (t) => ({ action: "stance", stance: true, vx: Math.sin(t * 2) * 3 }) },
  { id: "dribble", label: "Dribble (standing)", dur: 3, at: (t) => ({ action: "idle", hasBall: true, dribbling: true, ballWorld: dribbleBall(t, 0, 0, 2) }) },
  {
    id: "dribbleRun",
    label: "Dribble (running)",
    dur: 3,
    at: (t) => ({ action: "move", vz: 5, hasBall: true, dribbling: true, ballWorld: dribbleBall(t, 0, 0, 2, 5) }),
  },
  { id: "triple", label: "Triple threat (holding)", dur: 2, at: () => ({ action: "idle", hasBall: true }) },
  {
    id: "jumper",
    label: "Jump shot",
    dur: 1.7,
    at: (t) => {
      const jumpAt = 0.36,
        rel = jumpAt + Math.sqrt(2 * G * 0.33) / G - 0.02;
      return {
        action: "jumper",
        actionT: t,
        actionDur: 1.31,
        hasBall: t < rel,
        actionData: { jumpAt, release: rel, released: t >= rel, ideal: rel },
        y: jumpY(t, jumpAt, 0.33),
        airborne: t > jumpAt && jumpY(t, jumpAt, 0.33) > 0.02,
      };
    },
  },
  {
    id: "layup",
    label: "Layup",
    dur: 1.5,
    at: (t) => {
      const jumpAt = 0.36,
        rel = jumpAt + Math.sqrt(2 * G * 0.5) / G - 0.03;
      return {
        action: "layup",
        actionT: t,
        actionDur: 1.2,
        vz: 3.5,
        hasBall: t < rel,
        actionData: { jumpAt, release: rel, released: t >= rel },
        y: jumpY(t, jumpAt, 0.5),
        airborne: jumpY(t, jumpAt, 0.5) > 0.02,
      };
    },
  },
  {
    id: "dunk",
    label: "Dunk",
    dur: 1.7,
    at: (t) => {
      const jumpAt = 0.38,
        rel = jumpAt + Math.sqrt(2 * G * 0.75) / G;
      return {
        action: "dunk",
        actionT: t,
        actionDur: 1.4,
        vz: 3.5,
        hasBall: t < rel,
        actionData: { jumpAt, release: rel, released: t >= rel },
        y: jumpY(t, jumpAt, 0.75),
        airborne: jumpY(t, jumpAt, 0.75) > 0.02,
      };
    },
  },
  {
    id: "block",
    label: "Block",
    dur: 1.2,
    at: (t) => ({ action: "block", actionT: t, actionDur: 1, y: jumpY(t, 0.05, 0.55), airborne: jumpY(t, 0.05, 0.55) > 0.02 }),
  },
  {
    id: "rebound",
    label: "Rebound",
    dur: 1.2,
    at: (t) => ({ action: "rebound", actionT: t, actionDur: 0.9, y: jumpY(t, 0.05, 0.5), airborne: jumpY(t, 0.05, 0.5) > 0.02 }),
  },
  {
    id: "pass",
    label: "Chest pass",
    dur: 0.7,
    at: (t) => ({ action: "pass", actionT: t, actionDur: 0.39, hasBall: t < 0.14, actionData: { release: 0.14, kind: "chest" } }),
  },
  {
    id: "lob",
    label: "Lob pass",
    dur: 0.8,
    at: (t) => ({ action: "pass", actionT: t, actionDur: 0.47, hasBall: t < 0.22, actionData: { release: 0.22, kind: "lob" } }),
  },
  { id: "steal", label: "Steal attempt", dur: 0.8, at: (t) => ({ action: "steal", actionT: t, actionDur: 0.45, stance: true }) },
  { id: "post", label: "Post up", dur: 2, at: () => ({ action: "post", hasBall: true }) },
  { id: "screen", label: "Set screen", dur: 2, at: () => ({ action: "screen" }) },
  {
    id: "ftRoutine",
    label: "Free throw: routine",
    dur: 1.3,
    at: (t) => ({ action: "freeThrow", hasBall: true, actionData: { routine: true }, ballWorld: dribbleBall((t * 1.54) / 1.6, 0, 0, 2) }),
  },
  { id: "ftSet", label: "Free throw: set", dur: 1.5, at: () => ({ action: "freeThrow", hasBall: true, actionData: {} }) },
  {
    id: "ftStroke",
    label: "Free throw: stroke",
    dur: 1.8,
    at: (t) => ({
      action: "freeThrow",
      actionT: t,
      actionDur: 1.6,
      hasBall: t < 0.72,
      actionData: { started: true, ideal: 0.72, release: 0.72, shot: t >= 0.72 },
    }),
  },
  { id: "celebrate", label: "Celebrate", dur: 2, at: () => ({ action: "celebrate", celebrate: true }) },
  { id: "fall", label: "Fall (charge / ankle breaker)", dur: 1.4, at: (t) => ({ action: "fall", actionT: t, actionDur: 1.2 }) },
  {
    id: "catch",
    label: "Catch a pass",
    dur: 1,
    at: (t) => ({
      action: "idle",
      catchBall: new THREE.Vector3(0.15, 1.35 + Math.sin(Math.min(1, t / 0.85) * Math.PI) * 0.4, 6 - Math.min(1, t / 0.85) * 5.55),
    }),
  },
  { id: "bench", label: "Bench: seated", dur: 2, at: () => ({ action: "bench", seatY: 0.5 }) },
  { id: "benchUp", label: "Bench: on their feet", dur: 2, at: () => ({ action: "bench", seatY: 0.5, benchExcite: 1 }) },
  {
    id: "ref-foul",
    label: "Ref: foul",
    dur: 1.2,
    at: (t) => ({ action: "official", actionT: t, actionData: { signal: "foul", signalT: t, signalDir: Math.PI / 2 } }),
  },
  {
    id: "ref-shootingFoul",
    label: "Ref: shooting foul",
    dur: 1.6,
    at: (t) => ({ action: "official", actionT: t, actionData: { signal: "shootingFoul", signalT: t, signalDir: Math.PI / 2 } }),
  },
  {
    id: "ref-report",
    label: "Ref: direction",
    dur: 1.2,
    at: (t) => ({ action: "official", actionT: t, actionData: { signal: "report", signalT: t, signalDir: Math.PI / 2 } }),
  },
  {
    id: "ref-travel",
    label: "Ref: travel",
    dur: 1.2,
    at: (t) => ({ action: "official", actionT: t, actionData: { signal: "travel", signalT: t, signalDir: Math.PI / 2 } }),
  },
  {
    id: "ref-threeSeconds",
    label: "Ref: three seconds",
    dur: 1.2,
    at: (t) => ({ action: "official", actionT: t, actionData: { signal: "threeSeconds", signalT: t, signalDir: Math.PI / 2 } }),
  },
  {
    id: "ref-shotClock",
    label: "Ref: shot clock",
    dur: 1.2,
    at: (t) => ({ action: "official", actionT: t, actionData: { signal: "shotClock", signalT: t, signalDir: Math.PI / 2 } }),
  },
  {
    id: "ref-goaltend",
    label: "Ref: goaltending",
    dur: 1.2,
    at: (t) => ({ action: "official", actionT: t, actionData: { signal: "goaltend", signalT: t, signalDir: Math.PI / 2 } }),
  },
  {
    id: "ref-backcourt",
    label: "Ref: backcourt",
    dur: 1.2,
    at: (t) => ({ action: "official", actionT: t, actionData: { signal: "backcourt", signalT: t, signalDir: Math.PI / 2 } }),
  },
  {
    id: "ref-visibleCount",
    label: "Ref: five-second count",
    dur: 3,
    at: (t) => ({ action: "official", actionT: t, actionData: { signal: "visibleCount", signalT: t, signalDir: Math.PI / 2 } }),
  },
  {
    id: "ref-timeout",
    label: "Ref: timeout",
    dur: 1.2,
    at: (t) => ({ action: "official", actionT: t, actionData: { signal: "timeout", signalT: t, signalDir: Math.PI / 2 } }),
  },
  {
    id: "ref-threeAttempt",
    label: "Ref: three attempt",
    dur: 1.2,
    at: (t) => ({ action: "official", actionT: t, actionData: { signal: "threeAttempt", signalT: t, signalDir: Math.PI / 2 } }),
  },
  {
    id: "ref-threeGood",
    label: "Ref: three is good",
    dur: 1.2,
    at: (t) => ({ action: "official", actionT: t, actionData: { signal: "threeGood", signalT: t, signalDir: Math.PI / 2 } }),
  },
  {
    id: "ref-charge",
    label: "Ref: charge",
    dur: 1.2,
    at: (t) => ({ action: "official", actionT: t, actionData: { signal: "charge", signalT: t, signalDir: Math.PI / 2 } }),
  },
  {
    id: "ref-block",
    label: "Ref: blocking foul",
    dur: 1.2,
    at: (t) => ({ action: "official", actionT: t, actionData: { signal: "block", signalT: t, signalDir: Math.PI / 2 } }),
  },
  {
    id: "ref-subs",
    label: "Ref: substitution",
    dur: 1.2,
    at: (t) => ({ action: "official", actionT: t, actionData: { signal: "subs", signalT: t, signalDir: Math.PI / 2 } }),
  },
  {
    id: "ref-holdBall",
    label: "Ref: holding the ball",
    dur: 1.2,
    at: (t) => ({ action: "official", actionT: t, actionData: { signal: "holdBall", signalT: t, signalDir: Math.PI / 2 } }),
  },
  {
    id: "ref-toss",
    label: "Ref: jump-ball toss",
    dur: 0.8,
    at: (t) => ({ action: "official", actionT: t, actionData: { signal: "toss", signalT: t, signalDir: Math.PI / 2 } }),
  },
  {
    id: "ref-handBall",
    label: "Ref: hand the ball in",
    dur: 0.6,
    at: (t) => ({ action: "official", actionT: t, actionData: { signal: "handBall", signalT: t, signalDir: Math.PI / 2 } }),
  },
];

function Env() {
  const ref = useRef(false);
  useFrame(({ gl, scene }) => {
    if (ref.current) return;
    ref.current = true;
    const pm = new THREE.PMREMGenerator(gl);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  });
  return null;
}

function Actor({
  clip,
  time,
  playing,
  speed,
  onTime,
  player,
  team,
  x = 0,
  facing = 0,
}: {
  clip: Clip;
  time: number;
  playing: boolean;
  speed: number;
  onTime: (t: number) => void;
  player: Player;
  team: Team;
  x?: number;
  facing?: number;
}) {
  const gltf = useGLTF(PLAYER_GLB) as unknown as GLTF;
  const masks = useMasks();
  const avatar = useMemo(() => new Avatar(gltf, masks, player, team, "home"), [gltf, masks, player, team]);
  const t = useRef(time);
  const ball = useRef<THREE.Mesh>(null);
  useEffect(() => {
    t.current = time;
  }, [time]);
  useEffect(() => () => avatar.dispose(), [avatar]);
  useFrame((_, dt) => {
    if (playing) {
      t.current = (t.current + dt * speed) % clip.dur;
      onTime(t.current);
    }
    const base: PoseInput = {
      x,
      y: 0,
      z: 0,
      facing,
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
      lookAt: new THREE.Vector3(0, 3, 8),
      stance: false,
      stamina: 1,
      dt: playing ? dt * speed : 1 / 60,
      heightM: 2.0,
      airborne: false,
      celebrate: false,
    };
    const pose = { ...base, ...clip.at(t.current) };
    const lvx = pose.vx,
      lvz = pose.vz;
    pose.vx = lvx * Math.cos(facing) + lvz * Math.sin(facing);
    pose.vz = -lvx * Math.sin(facing) + lvz * Math.cos(facing);
    if (pose.ballWorld) pose.ballWorld = pose.ballWorld.clone().add(new THREE.Vector3(x, 0, 0));
    avatar.update(pose);
    if (ball.current) {
      ball.current.visible = pose.hasBall || !!pose.ballWorld;
      if (pose.dribbling && pose.ballWorld) ball.current.position.copy(pose.ballWorld);
      else if (pose.ballWorld && pose.actionData.routine) ball.current.position.copy(pose.ballWorld);
      else
        ball.current.position
          .copy(avatar.handL)
          .add(avatar.handR)
          .multiplyScalar(0.5)
          .add(new THREE.Vector3(0, 0, 0.07));
    }
  });
  return (
    <>
      <primitive object={avatar.root} />
      <mesh ref={ball} castShadow>
        <sphereGeometry args={[0.12, 24, 16]} />
        <meshStandardMaterial color="#d4622a" roughness={0.6} />
      </mesh>
    </>
  );
}

function SheetCamera() {
  useFrame(({ camera }) => {
    camera.position.set(1.2, 1.5, 6.4);
    camera.lookAt(0, 1.05, 0);
  });
  return null;
}

export default function PoseLab({ player, team }: { player: Player; team: Team }) {
  const [clipId, setClipId] = useState("jumper");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [sheet, setSheet] = useState(false);
  const [profile, setProfile] = useState(false);
  const clip = CLIPS.find((c) => c.id === clipId)!;
  useEffect(() => {
    // dev tool: read the URL once after mount (the page is prerendered without it)
    const q = new URLSearchParams(location.search);
    /* eslint-disable react-hooks/set-state-in-effect */
    if (q.get("sheet")) setSheet(true);
    if (q.get("profile")) setProfile(true);
    if (q.get("clip")) setClipId(q.get("clip")!);
    /* eslint-enable react-hooks/set-state-in-effect */
    (window as unknown as { __lab: unknown }).__lab = { setClipId, setSheet, setProfile };
  }, []);
  return (
    <div className="flex h-dvh">
      <aside className="flex w-64 flex-col gap-1 overflow-y-auto border-r border-line bg-navy p-3">
        {CLIPS.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              setClipId(c.id);
              setTime(0);
            }}
            data-clip={c.id}
            className={`rounded px-2 py-1 text-left text-sm ${c.id === clipId ? "bg-amber text-navy" : "hover:bg-deck-2"}`}
          >
            {c.label}
          </button>
        ))}
      </aside>
      <div className="relative flex-1">
        <Canvas
          shadows
          camera={{ position: [2.6, 1.6, 3.6], fov: 40 }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.AgXToneMapping;
          }}
        >
          <color attach="background" args={["#16283f"]} />
          <Env />
          <hemisphereLight args={["#ffffff", "#444444", 0.6]} />
          <directionalLight position={[3, 6, 4]} intensity={2.5} castShadow />
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[20, 20]} />
            <meshStandardMaterial color="#cf9a5e" />
          </mesh>
          <Suspense fallback={null}>
            {sheet ? (
              Array.from({ length: 6 }, (_, i) => (
                <Actor
                  key={`${clip.id}-${i}`}
                  clip={clip}
                  time={(clip.dur * i) / 6}
                  playing={false}
                  speed={0}
                  onTime={() => undefined}
                  player={player}
                  team={team}
                  x={(i - 2.5) * 1.25}
                  facing={profile ? Math.PI / 2 : 0}
                />
              ))
            ) : (
              <Actor clip={clip} time={time} playing={playing} speed={speed} onTime={setTime} player={player} team={team} />
            )}
          </Suspense>
          {sheet && <SheetCamera />}
          {!sheet && <OrbitControls target={[0, 1.1, 0]} makeDefault />}
        </Canvas>
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-navy/90 p-3">
          <button onClick={() => setPlaying((p) => !p)} className="rounded bg-deck-2 px-3 py-1" data-play>
            {playing ? "Pause" : "Play"}
          </button>
          <input
            aria-label="Time"
            type="range"
            min={0}
            max={clip.dur}
            step={0.01}
            value={time}
            onChange={(e) => {
              setPlaying(false);
              setTime(Number(e.target.value));
            }}
            className="flex-1 accent-amber"
            data-scrub
          />
          <span className="w-20 text-sm tabular-nums">{time.toFixed(2)}s</span>
          <select aria-label="Speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="rounded bg-deck-2 px-2 py-1">
            {[0.1, 0.25, 0.5, 1].map((v) => (
              <option key={v} value={v}>
                {v}x
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
