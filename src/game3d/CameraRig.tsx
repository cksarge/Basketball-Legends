"use client";
import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import type { Match } from "@/game/sim/match";
import type { CameraMode } from "@/state/settings";
import { type CourtSpec, huddleSpot } from "@/game/court";
import { floorSize } from "./courtTexture";

/**
 * Lowest a camera may sit at (x, z) without ending up inside the seating bowl
 * (mirrors Arena's lower bowl: rows start 1.6 m past the floor edge, 0.82 m deep, 0.42 m rise).
 */
export function standsClearance(court: CourtSpec, x: number, z: number) {
  const { w, h } = floorSize(court);
  const d = Math.max(Math.abs(x) - (w / 2 + 1.6), Math.abs(z) - (h / 2 + 1.6));
  if (d <= 0) return 0;
  return 0.45 + (d / 0.82) * 0.42 + 1.7; // seat height plus a seated fan's head, plus margin
}

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
  stateRef,
  focusAgent,
}: {
  match: Match;
  mode: CameraMode;
  zoom: number;
  heightMul: number;
  stateRef: React.RefObject<CameraState>;
  focusAgent: () => number | null;
}) {
  const { camera } = useThree();
  const look = useRef(new THREE.Vector3(0, 1, 0));
  const pos = useRef(new THREE.Vector3(0, 8, 22));
  const tmpT = useRef(new THREE.Vector3());

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const s = match.state;
    const c = s.cfg.court;
    const cs = stateRef.current!;
    const ball = s.ball.phys.pos;
    const off = s.offense;
    const side = match.attackSide(off);
    const cam = camera as THREE.PerspectiveCamera;
    let targetPos: THREE.Vector3,
      targetLook: THREE.Vector3,
      fov = 32 / zoom;

    if (cs.override) {
      targetPos = cs.override.pos;
      targetLook = cs.override.look;
      fov = cs.override.fov ?? fov;
    } else if (s.phase === "timeout" || s.phase === "periodEnd" || s.phase === "halftime") {
      // breaks: look in on a team huddle (the team that called timeout, else alternate)
      const ti = s.timeoutTeam ?? ((s.period % 2) as 0 | 1);
      const h = huddleSpot(c, s.phase === "timeout" ? ti : ((s.period % 2) as 0 | 1), 2);
      targetPos = tmpT.current.set(h.cx + 2.5, 3.0, h.cz + 7.5);
      targetLook = new THREE.Vector3(h.cx, 1.2, h.cz);
      fov = 36;
    } else if (s.phase === "freethrows" && s.freeThrows) {
      const shooter = s.agents[s.freeThrows.shooter];
      const fs = match.attackSide(s.freeThrows.team);
      targetPos = tmpT.current.set(shooter.pos.x - fs * 6.5, 2.6, shooter.pos.z + 4.5);
      targetLook = new THREE.Vector3(fs * (c.halfL - c.rimFromBaseline), 2.4, 0);
      fov = 40;
    } else {
      // follow the ball, biased toward the basket being attacked
      const fx = THREE.MathUtils.clamp(ball.x * 0.82 + side * 2.2, -c.halfL + 3, c.halfL - 3);
      const fz = THREE.MathUtils.clamp(ball.z * 0.25, -3, 3);
      const fa = focusAgent();
      const ag = fa !== null ? s.agents[fa] : null;
      switch (mode) {
        case "2k": {
          targetLook = new THREE.Vector3(fx, 1.2, fz * 1.4);
          targetPos = new THREE.Vector3(fx * 0.92, 7.5 * heightMul, c.halfW + 13 / zoom);
          fov = 38 / zoom;
          break;
        }
        case "low": {
          // courtside, just behind the near ad boards, at about eye level over them
          targetLook = new THREE.Vector3(fx, 1.3, fz * 0.6);
          targetPos = new THREE.Vector3(fx * 0.85, 2.3 * heightMul, c.halfW + 3.35);
          fov = 46 / zoom;
          break;
        }
        case "baseline": {
          const bx = -side * (c.halfL + 6 / zoom);
          targetLook = new THREE.Vector3(side * (c.halfL - 4), 1.4, ball.z * 0.4);
          targetPos = new THREE.Vector3(bx, 6 * heightMul, ball.z * 0.3);
          fov = 45 / zoom;
          break;
        }
        case "player": {
          if (ag) {
            const behind = new THREE.Vector3(ag.pos.x - (side * 6.5) / zoom, 3.8 * heightMul, ag.pos.z * 0.85);
            targetPos = behind;
            targetLook = new THREE.Vector3(ag.pos.x + side * 6, 1.4, ag.pos.z * 0.6);
            fov = 50;
          } else {
            targetLook = new THREE.Vector3(fx, 1.2, fz);
            targetPos = new THREE.Vector3(fx, 9, c.halfW + 18);
          }
          break;
        }
        case "skycam": {
          targetLook = new THREE.Vector3(fx, 0, fz);
          targetPos = new THREE.Vector3(fx - side * 2, (22 * heightMul) / zoom, c.halfW + 4);
          fov = 45;
          break;
        }
        default: {
          targetLook = new THREE.Vector3(fx, 1.1, fz);
          targetPos = new THREE.Vector3(fx * 0.85, 9.5 * heightMul, c.halfW + 17 / zoom);
          fov = 30 / zoom;
        }
      }
    }
    // never put the camera inside the crowd (zoomed-out or raised presets included)
    if (!cs.override) {
      const minY = standsClearance(c, targetPos.x, targetPos.z);
      if (targetPos.y < minY) targetPos = targetPos.clone().setY(minY);
    }
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
