"use client";
import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import type { Match } from "@/game/sim/match";
import type { CameraMode } from "@/state/settings";
import { huddleSpot } from "@/game/court";
import type { VenueVariant } from "./arena/variants";
import { type CameraPose, constrainPoint, constrainPose, followPose, freeThrowPose, huddlePose } from "./cameraPose";

export interface CameraState {
  /** Floor-projected forward vector of the camera (for camera-relative controls). */
  forward: THREE.Vector2;
  shake: number;
  override: { pos: THREE.Vector3; look: THREE.Vector3; fov?: number } | null;
  /** Jump straight to the next target instead of easing (camera cuts). */
  cut?: boolean;
}

export function CameraRig({
  match,
  mode,
  zoom,
  heightMul,
  venue,
  stateRef,
  focusAgent,
}: {
  match: Match;
  mode: CameraMode;
  zoom: number;
  heightMul: number;
  venue: VenueVariant;
  stateRef: React.RefObject<CameraState>;
  focusAgent: () => number | null;
}) {
  const { camera } = useThree();
  const look = useRef(new THREE.Vector3(0, 1, 0));
  const pos = useRef(new THREE.Vector3(0, 8, 22));

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const s = match.state;
    const c = s.cfg.court;
    const cs = stateRef.current!;
    const ball = s.ball.phys.pos;
    const off = s.offense;
    const side = match.attackSide(off);
    const cam = camera as THREE.PerspectiveCamera;
    let target: CameraPose;
    if (cs.override) {
      target = { pos: cs.override.pos, look: cs.override.look, fov: cs.override.fov ?? 32 / zoom };
    } else if (s.phase === "timeout" || s.phase === "periodEnd" || s.phase === "halftime") {
      // breaks: look in on a team huddle (the team that called timeout, else alternate)
      const ti = s.timeoutTeam ?? ((s.period % 2) as 0 | 1);
      target = huddlePose(huddleSpot(c, s.phase === "timeout" ? ti : ((s.period % 2) as 0 | 1), 2));
    } else if (s.phase === "freethrows" && s.freeThrows) {
      target = freeThrowPose(c, s.agents[s.freeThrows.shooter].pos, match.attackSide(s.freeThrows.team));
    } else {
      const fa = focusAgent();
      target = followPose(mode, zoom, heightMul, c, ball, side, fa !== null ? s.agents[fa].pos : null);
    }
    // never inside the crowd or outside the building (replays and raised/zoomed presets included)
    const { pos: targetPos, look: targetLook, fov } = constrainPose(venue, c, target);
    // smooth follow (critically damped feel)
    const k = cs.override ? 3 : 3.2;
    pos.current.x = THREE.MathUtils.damp(pos.current.x, targetPos.x, k, dt);
    pos.current.y = THREE.MathUtils.damp(pos.current.y, targetPos.y, k, dt);
    pos.current.z = THREE.MathUtils.damp(pos.current.z, targetPos.z, k, dt);
    look.current.x = THREE.MathUtils.damp(look.current.x, targetLook.x, 4.2, dt);
    look.current.y = THREE.MathUtils.damp(look.current.y, targetLook.y, 4.2, dt);
    look.current.z = THREE.MathUtils.damp(look.current.z, targetLook.z, 4.2, dt);
    cam.fov = THREE.MathUtils.damp(cam.fov, fov, 3, dt);
    if (cs.cut) {
      cs.cut = false;
      pos.current.copy(targetPos);
      look.current.copy(targetLook);
      cam.fov = fov;
    }
    constrainPoint(venue, c, pos.current);
    cam.updateProjectionMatrix();
    cam.position.copy(pos.current);
    if (cs.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * cs.shake * 0.25;
      cam.position.y += (Math.random() - 0.5) * cs.shake * 0.25;
      cs.shake = Math.max(0, cs.shake - dt * 2.5);
    }
    cam.lookAt(look.current);
    const fwd = new THREE.Vector2(look.current.x - pos.current.x, look.current.z - pos.current.z).normalize();
    cs.forward.copy(fwd);
  });
  return null;
}
