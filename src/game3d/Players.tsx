"use client";
import { useGLTF, useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Match } from "@/game/sim/match";
import type { Player } from "@/engine/types";
import type { UniformStyle } from "./character/uniformTexture";
import { Avatar, type PoseInput } from "./character/Avatar";
import type { MaskSet } from "./character/skinMaterial";
import { liveView, type ViewFrame } from "./replay";
import { BENCH_SEATS, benchSeat } from "@/game/court";
import { asset } from "@/lib/site";

/** Cushion height of the bench chairs (m); Arena builds chairs to match. */
export const SEAT_HEIGHT = 0.5;

export const PLAYER_GLB = asset("/models/player.glb");
export const MASK_URLS = ["A", "B", "C", "D"].map((k) => asset(`/models/player_mask${k}.png`));

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
  /** Replay frame to draw instead of the live game (null = live). */
  replayFrame?: React.RefObject<ViewFrame | null>;
  /** How many bench players to draw per team (0 hides the benches). */
  benchSize?: number;
  /** Seconds of excitement left for each team's bench (set on big plays). */
  benchExcite?: React.RefObject<[number, number]>;
  /** A player's foot hit the floor (live play only, not replays). */
  onFootstep?: (x: number, speed: number) => void;
  /** Park games: street clothes per player (shirt and shorts colors) instead of team uniforms. */
  street?: (p: Player, team: 0 | 1) => { shirt: string; shorts: string };
}

export function Players({ match, uniforms, ballMesh, avatarsRef, replayFrame, benchSize = BENCH_SEATS, benchExcite, onFootstep, street }: PlayersProps) {
  const gltf = useGLTF(PLAYER_GLB) as unknown as GLTF;
  const masks = useMasks();
  const group = useRef<THREE.Group>(null);
  const avatars = useRef(new Map<string, Avatar>());
  const ballSpin = useRef(new THREE.Quaternion());
  /** Visual offset carried over when the ball leaves the hands, decays to zero. */
  const ballOffset = useRef(new THREE.Vector3());
  const wasAttached = useRef(false);
  const benchTick = useRef(0);
  const benchDt = useRef(new Map<string, number>());

  useEffect(() => {
    const map = avatars.current;
    return () => {
      // take the bodies out of the scene too: if the group outlives this effect (a hot reload
      // or a remount), the next frame builds fresh avatars and the old ones would stand frozen
      for (const a of map.values()) {
        a.root.removeFromParent();
        a.dispose();
      }
      map.clear();
    };
  }, []);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const s = match.state;
    const v = replayFrame?.current ?? liveView(match);
    const g = group.current;
    if (!g) return;
    const live = new Set<string>();
    const handler = v.ball.owner !== null ? (v.agents[v.ball.owner] ?? null) : null;
    for (const ag of v.agents) {
      const id = ag.player.id;
      live.add(id);
      let av = avatars.current.get(id);
      if (!av) {
        const team = s.teams[ag.team].team;
        if (street) {
          const o = street(ag.player, ag.team);
          av = new Avatar(gltf, masks, ag.player, { ...team, colors: { primary: o.shirt, secondary: o.shorts, accent: o.shorts } }, "home", "street");
        } else av = new Avatar(gltf, masks, ag.player, team, uniforms[ag.team]);
        avatars.current.set(id, av);
        g.add(av.root);
      }
      const hasBall = v.ball.owner === ag.idx;
      const ballP = v.ball.pos;
      const lookTarget = hasBall
        ? new THREE.Vector3(v.rimX[ag.team], 3, 0)
        : handler
          ? new THREE.Vector3(handler.pos.x, 1.6, handler.pos.z)
          : new THREE.Vector3(ballP.x, ballP.y, ballP.z);
      const pose: PoseInput = {
        x: ag.pos.x,
        y: ag.y,
        z: ag.pos.z,
        facing: ag.facing,
        vx: ag.vel.x,
        vz: ag.vel.z,
        action: ag.action.kind,
        actionT: ag.action.t,
        actionDur: ag.action.dur,
        actionData: ag.action.data,
        hasBall,
        dribbling: hasBall && v.ball.mode === "dribble",
        hand: ag.hand,
        ballWorld: new THREE.Vector3(ballP.x, ballP.y, ballP.z),
        lookAt: lookTarget,
        stance:
          ag.action.kind === "stance" ||
          (ag.team !== v.offense && v.phase === "live" && handler !== null && Math.hypot(handler.pos.x - ag.pos.x, handler.pos.z - ag.pos.z) < 2.5),
        stamina: ag.stamina,
        dt,
        heightM: ag.player.heightIn * 0.0254,
        airborne: ag.y > 0.02,
        celebrate: ag.action.kind === "celebrate",
        catchBall: v.ball.mode === "pass" && v.ball.passTo === ag.idx ? new THREE.Vector3(ballP.x, ballP.y, ballP.z) : null,
      };
      av.root.visible = true;
      av.onStep = onFootstep && !replayFrame?.current ? (sp) => onFootstep(ag.pos.x, sp) : null;
      av.update(pose);
      if (hasBall && v.ball.mode === "held" && ballMesh.current) {
        // the ball sits between the hands
        const mid = new THREE.Vector3().addVectors(av.handL, av.handR).multiplyScalar(0.5);
        const fwd = new THREE.Vector3(Math.sin(ag.facing), 0, Math.cos(ag.facing));
        mid.addScaledVector(fwd, 0.07);
        ballMesh.current.position.copy(mid);
        ballMesh.current.userData.attached = true;
      }
    }
    // bench players sit in the chairs and follow the ball; updated a third of the frames each
    benchTick.current++;
    const ex = benchExcite?.current;
    if (ex) {
      ex[0] = Math.max(0, ex[0] - dt);
      ex[1] = Math.max(0, ex[1] - dt);
    }
    const onFloor = new Set(v.agents.map((a) => a.player.id));
    for (const ti of [0, 1] as const) {
      if (benchSize <= 0) break;
      const t = s.teams[ti];
      const benchers = t.roster.filter((p) => !onFloor.has(p.id)).slice(0, Math.min(benchSize, BENCH_SEATS));
      benchers.forEach((p, i) => {
        live.add(p.id);
        let av = avatars.current.get(p.id);
        if (!av) {
          av = new Avatar(gltf, masks, p, t.team, uniforms[ti]);
          avatars.current.set(p.id, av);
          g.add(av.root);
        }
        const acc = (benchDt.current.get(p.id) ?? 0) + dt;
        if ((benchTick.current + i) % 3 !== 0 && av.root.visible) {
          benchDt.current.set(p.id, acc);
          return;
        }
        benchDt.current.set(p.id, 0);
        const seat = benchSeat(s.cfg.court, ti, i);
        av.root.visible = true;
        av.update({
          x: seat.x,
          y: 0,
          z: seat.z,
          facing: 0,
          vx: 0,
          vz: 0,
          action: "bench",
          actionT: 0,
          actionDur: 0,
          actionData: {},
          hasBall: false,
          dribbling: false,
          hand: 1,
          ballWorld: null,
          lookAt: new THREE.Vector3(v.ball.pos.x, Math.max(1, v.ball.pos.y), v.ball.pos.z),
          stance: false,
          stamina: 1,
          dt: Math.min(acc, 0.15),
          heightM: p.heightIn * 0.0254,
          airborne: false,
          celebrate: false,
          seatY: SEAT_HEIGHT,
          benchExcite: ex && ex[ti] > 0 && (i * 7 + p.jersey) % 3 !== 0 ? 1 : 0,
        });
      });
    }
    // remove avatars for players no longer on the floor or the bench
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
      const attached = !!bm.userData.attached && v.ball.mode === "held" && v.ball.owner !== null;
      if (!attached) {
        const b = v.ball;
        if (wasAttached.current) ballOffset.current.set(bm.position.x - b.pos.x, bm.position.y - b.pos.y, bm.position.z - b.pos.z);
        if (ballOffset.current.lengthSq() > 0.25) ballOffset.current.set(0, 0, 0); // teleports (inbounds, lineups) don't blend
        ballOffset.current.multiplyScalar(Math.exp(-22 * dt));
        bm.position.set(b.pos.x + ballOffset.current.x, b.pos.y + ballOffset.current.y, b.pos.z + ballOffset.current.z);
        // roll from velocity
        const bv = new THREE.Vector3(b.vel.x, 0, b.vel.z);
        const speed = bv.length();
        if (speed > 0.01 || v.ball.mode === "dribble") {
          const axis = new THREE.Vector3(bv.z, 0, -bv.x).normalize();
          const ang = (v.ball.mode === "dribble" ? 8 : speed / 0.12) * dt;
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
