"use client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { courtFor } from "@/game/court";
import type { Team } from "@/engine/types";
import { useSettings } from "@/state/settings";
import { Arena, type ArenaKind } from "./Arena";
import { Hoop } from "./Hoop";

function Env() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.5;
    return () => { env.dispose(); pm.dispose(); };
  }, [gl, scene]);
  return null;
}

function Orbit({ reduced }: { reduced: boolean }) {
  const { camera } = useThree();
  useFrame((st) => {
    const t = reduced ? 0.6 : st.clock.elapsedTime * 0.045;
    const r = 21;
    camera.position.set(Math.sin(t) * r * 0.9, 5.5 + Math.sin(t * 0.7) * 1.2, Math.cos(t) * r * 0.62 + 4);
    camera.lookAt(Math.sin(t) * 3, 1.5, 0);
  });
  return null;
}

export default function MenuBackdrop({ team, kind }: { team: Team; kind: ArenaKind }) {
  const g = useSettings((s) => s.graphics);
  const reduced = useSettings((s) => s.accessibility.reducedMotion);
  const court = useMemo(() => courtFor(kind === "gym" ? "hs" : kind === "college" ? "college" : "pro"), [kind]);
  const excite = useRef(0.35);
  const score = useRef({ h: 0, a: 0, period: "Q1", clock: "12:00" });
  const clock = useRef({ shot: 24, game: 720 });
  const ball = useRef<THREE.Vector3 | null>(null);
  const shake = useRef([0, 0]);
  return (
    <Canvas dpr={Math.min(1.5, typeof window !== "undefined" ? window.devicePixelRatio : 1)} camera={{ fov: 38, near: 0.5, far: 300 }} gl={{ antialias: false, powerPreference: "high-performance" }}
      onCreated={({ gl }) => { gl.toneMapping = THREE.NoToneMapping; }}>
      <color attach="background" args={["#05070a"]} />
      <fog attach="fog" args={["#05070a", 40, 120]} />
      <Env />
      <hemisphereLight args={["#cfd9ff", "#1a1410", 0.6]} />
      <directionalLight position={[3, 26, 6]} intensity={2.2} />
      {[-10, 0, 10].map((x) => <pointLight key={x} position={[x, 18, 0]} intensity={240} distance={46} decay={2} />)}
      <Suspense fallback={null}>
        <Arena court={court} home={team} away={team} kind={kind} quality={g.preset === "ultra" ? "high" : g.preset} crowdDensity={g.crowdDensity * 0.85} exciteRef={excite} scoreRef={score} />
        {([1, -1] as const).map((side) => <Hoop key={side} court={court} side={side} team={team} ceilingHung={kind === "gym"} ballRef={ball} clockRef={clock} rimShake={shake} />)}
      </Suspense>
      <Orbit reduced={reduced} />
      <EffectComposer multisampling={0}>
        {g.bloom ? <Bloom intensity={0.5} luminanceThreshold={0.85} mipmapBlur /> : <></>}
        <ToneMapping mode={ToneMappingMode.AGX} />
        <Vignette offset={0.25} darkness={0.7} />
      </EffectComposer>
    </Canvas>
  );
}
