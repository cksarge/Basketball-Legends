"use client";
// One player standing on a lit floor disc, in his team's home uniform. Used by the career creator and hub.
import { OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo } from "react";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Player, Team } from "@/engine/types";
import { Avatar, type PoseInput } from "./character/Avatar";
import { PLAYER_GLB, useMasks } from "./Players";

function Figure({ player, team, action }: { player: Player; team: Team; action: "idle" | "dribble" }) {
  const gltf = useGLTF(PLAYER_GLB) as unknown as GLTF;
  const masks = useMasks();
  const avatar = useMemo(() => new Avatar(gltf, masks, player, team, "home"), [gltf, masks, player, team]);
  useEffect(() => () => avatar.dispose(), [avatar]);
  const ball = useMemo(() => new THREE.Vector3(), []);
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const dribbling = action === "dribble";
    if (dribbling) {
      const ph = (t * 1.6) % 1;
      ball.set(-0.3, 0.12 + 0.88 * Math.abs(Math.cos(ph * Math.PI)), 0.32);
    }
    const pose: PoseInput = {
      x: 0,
      y: 0,
      z: 0,
      facing: 0,
      vx: 0,
      vz: 0,
      action: "idle",
      actionT: 0,
      actionDur: 0,
      actionData: {},
      hasBall: dribbling,
      dribbling,
      hand: 1,
      ballWorld: dribbling ? ball : null,
      lookAt: new THREE.Vector3(0, 1.7, 6),
      stance: false,
      stamina: 1,
      dt: Math.min(dt, 1 / 20),
      heightM: player.heightIn * 0.0254,
      airborne: false,
      celebrate: false,
    };
    avatar.update(pose);
  });
  return (
    <>
      <primitive object={avatar.root} />
      {action === "dribble" && (
        <mesh position={ball} castShadow>
          <sphereGeometry args={[0.12, 24, 16]} />
          <meshStandardMaterial color="#d4622a" roughness={0.6} />
        </mesh>
      )}
    </>
  );
}

export default function PlayerPreview({ player, team, action = "idle" }: { player: Player; team: Team; action?: "idle" | "dribble" }) {
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 1.25, 4.4], fov: 32 }} aria-label={`3D preview of ${player.firstName} ${player.lastName}`}>
      <color attach="background" args={["#0d1b2e"]} />
      <hemisphereLight args={["#dfe9ff", "#1a2a40", 0.9]} />
      <directionalLight position={[2.5, 5, 3.5]} intensity={2.2} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-3, 2.5, -2]} intensity={0.8} color={team.colors.primary} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[1.3, 48]} />
        <meshStandardMaterial color="#1f3552" roughness={0.85} />
      </mesh>
      <Suspense fallback={null}>
        <Figure player={player} team={team} action={action} />
      </Suspense>
      <OrbitControls target={[0, 1.0, 0]} enablePan={false} minDistance={2.6} maxDistance={6} minPolarAngle={0.9} maxPolarAngle={1.75} />
    </Canvas>
  );
}
