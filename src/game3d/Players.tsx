"use client";
import { useGLTF, useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Match } from "@/game/sim/match";
import type { UniformStyle } from "./character/uniformTexture";
import { Avatar, type PoseInput } from "./character/Avatar";
import type { MaskSet } from "./character/skinMaterial";

export const PLAYER_GLB = "/models/player.glb";
export const MASK_URLS = ["/models/player_maskA.png", "/models/player_maskB.png", "/models/player_maskC.png", "/models/player_maskD.png"];

export function useMasks(): MaskSet {
  const [A, B, C, D] = useTexture(MASK_URLS);
  useMemo(() => {
    for (const t of [A, B, C, D]) {
      t.flipY = false;
      t.colorSpace = THREE.NoColorSpace;
      t.anisotropy = 4;
      t.needsUpdate = true;
    }
  }, [A, B, C, D]);
  return { A, B, C, D };
}

export interface PlayersProps {
  match: Match;
  uniforms: [UniformStyle, UniformStyle];
  ballMesh: React.RefObject<THREE.Mesh | null>;
  /** Called with each avatar's world hand positions for overlays/markers. */
  avatarsRef?: React.RefObject<Map<string, Avatar>>;
}

export function Players({ match, uniforms, ballMesh, avatarsRef }: PlayersProps) {
  const gltf = useGLTF(PLAYER_GLB) as unknown as GLTF;
  const masks = useMasks();
  const group = useRef<THREE.Group>(null);
  const avatars = useRef(new Map<string, Avatar>());
  const ballSpin = useRef(new THREE.Quaternion());
  /** Visual offset carried over when the ball leaves the hands, decays to zero. */
  const ballOffset = useRef(new THREE.Vector3());
  const wasAttached = useRef(false);

  useEffect(() => {
    const map = avatars.current;
    return () => {
      for (const a of map.values()) a.dispose();
      map.clear();
    };
  }, []);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const s = match.state;
    const g = group.current;
    if (!g) return;
    const live = new Set<string>();
    for (const ag of s.agents) {
      const id = ag.player.id;
      live.add(id);
      let av = avatars.current.get(id);
      if (!av) {
        const team = s.teams[ag.team].team;
        av = new Avatar(gltf, masks, ag.player, team, uniforms[ag.team]);
        avatars.current.set(id, av);
        g.add(av.root);
      }
      const hasBall = s.ball.owner === ag.idx;
      const ballP = s.ball.phys.pos;
      const handler = match.handler();
      const lookTarget = hasBall ? new THREE.Vector3(match.rim(ag.team).x, 3, 0) : handler ? new THREE.Vector3(handler.pos.x, 1.6, handler.pos.z) : new THREE.Vector3(ballP.x, ballP.y, ballP.z);
      const pose: PoseInput = {
        x: ag.pos.x, y: ag.y, z: ag.pos.z, facing: ag.facing, vx: ag.vel.x, vz: ag.vel.z,
        action: ag.action.kind, actionT: ag.action.t, actionDur: ag.action.dur, actionData: ag.action.data,
        hasBall, dribbling: hasBall && s.ball.mode === "dribble", hand: ag.hand,
        ballWorld: new THREE.Vector3(ballP.x, ballP.y, ballP.z), lookAt: lookTarget,
        stance: ag.action.kind === "stance" || (ag.team !== s.offense && s.phase === "live" && handler !== null && Math.hypot(handler.pos.x - ag.pos.x, handler.pos.z - ag.pos.z) < 2.5),
        stamina: ag.stamina, dt, heightM: ag.player.heightIn * 0.0254, airborne: ag.y > 0.02,
        celebrate: ag.action.kind === "celebrate",
      };
      av.root.visible = true;
      av.update(pose);
      if (hasBall && s.ball.mode === "held" && ballMesh.current) {
        // the ball sits between the hands
        const mid = new THREE.Vector3().addVectors(av.handL, av.handR).multiplyScalar(0.5);
        const fwd = new THREE.Vector3(Math.sin(ag.facing), 0, Math.cos(ag.facing));
        mid.addScaledVector(fwd, 0.07);
        ballMesh.current.position.copy(mid);
        ballMesh.current.userData.attached = true;
      }
    }
    // remove avatars for players no longer on the floor
    for (const [id, av] of avatars.current) {
      if (!live.has(id)) {
        g.remove(av.root);
        av.dispose();
        avatars.current.delete(id);
      }
    }
    if (avatarsRef) avatarsRef.current = avatars.current;
    // ball (when not attached to hands)
    const bm = ballMesh.current;
    if (bm) {
      const attached = !!bm.userData.attached && s.ball.mode === "held" && s.ball.owner !== null;
      if (!attached) {
        const b = s.ball.phys;
        if (wasAttached.current) ballOffset.current.set(bm.position.x - b.pos.x, bm.position.y - b.pos.y, bm.position.z - b.pos.z);
        if (ballOffset.current.lengthSq() > 0.25) ballOffset.current.set(0, 0, 0); // teleports (inbounds, lineups) don't blend
        ballOffset.current.multiplyScalar(Math.exp(-22 * dt));
        bm.position.set(b.pos.x + ballOffset.current.x, b.pos.y + ballOffset.current.y, b.pos.z + ballOffset.current.z);
        // roll from velocity
        const v = new THREE.Vector3(b.vel.x, 0, b.vel.z);
        const speed = v.length();
        if (speed > 0.01 || s.ball.mode === "dribble") {
          const axis = new THREE.Vector3(v.z, 0, -v.x).normalize();
          const ang = (s.ball.mode === "dribble" ? 8 : speed / 0.12) * dt;
          if (axis.lengthSq() > 0) ballSpin.current.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, ang));
        }
        bm.quaternion.copy(ballSpin.current);
      }
      wasAttached.current = attached;
      bm.userData.attached = false;
    }
  });

  return <group ref={group} />;
}

useGLTF.preload(PLAYER_GLB);
