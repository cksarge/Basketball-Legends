"use client";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Match } from "@/game/sim/match";
import type { Official } from "@/game/sim/officials";
import type { Player } from "@/engine/types";
import { generatePlayer } from "@/engine/player";
import { Rng } from "@/engine/rng";
import { Avatar } from "./character/Avatar";
import { PLAYER_GLB, SEAT_HEIGHT, useMasks } from "./Players";
import type { ViewFrame } from "./replay";
import { tableSeats } from "@/game/court";

/** A plausible adult for an official or table crew member (no gear, short hair, ordinary build). */
function person(seed: string, kind: "official" | "staff", number: number): Player {
  const rng = new Rng(seed);
  const p = generatePlayer(rng, { targetOvr: 50, age: 40, league: "pro", teamId: null, idPrefix: seed });
  p.heightIn = kind === "official" ? 71 + rng.int(0, 6) : 66 + rng.int(0, 8);
  p.weightLb = Math.round(p.heightIn * (2.55 + rng.next() * 0.45));
  p.jersey = number;
  p.lastName = "";
  p.appearance = {
    ...p.appearance, headband: false, armSleeve: "none", kneePads: false,
    hairStyle: rng.pick([0, 1, 3, 4]), facialHair: rng.pick([0, 0, 1, 2, 4]), shoeColor: "#111111",
  };
  return p;
}

export function Officials({ match, replayFrame, crewSize = 4 }: { match: Match; replayFrame: React.RefObject<ViewFrame | null>; crewSize?: number }) {
  const gltf = useGLTF(PLAYER_GLB) as unknown as GLTF;
  const masks = useMasks();
  const group = useRef<THREE.Group>(null);
  const s = match.state;
  const home = s.teams[0].team;
  const avatars = useMemo(() => {
    const refs = (s.crew?.refs ?? []).map((o) => new Avatar(gltf, masks, person(`ref:${s.cfg.seed}:${o.idx}`, "official", o.number), home, "home", "official"));
    const staff = s.crew ? Array.from({ length: crewSize }, (_, i) => new Avatar(gltf, masks, person(`table:${home.id}:${i}`, "staff", 0), home, "home", "staff")) : [];
    return { refs, staff };
  }, [gltf, masks, s.crew, s.cfg.seed, home, crewSize]);
  const tick = useRef(0);

  useEffect(() => {
    const g = group.current;
    if (!g) return;
    for (const a of [...avatars.refs, ...avatars.staff]) g.add(a.root);
    return () => { for (const a of [...avatars.refs, ...avatars.staff]) { g.remove(a.root); a.dispose(); } };
  }, [avatars]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const crew = s.crew;
    if (!crew) return;
    const frameRefs: Official[] = replayFrame.current?.officials ?? crew.refs;
    const b = replayFrame.current?.ball.pos ?? s.ball.phys.pos;
    const ballV = new THREE.Vector3(b.x, Math.max(1, b.y), b.z);
    frameRefs.forEach((o, i) => {
      const av = avatars.refs[i];
      if (!av) return;
      av.update({
        x: o.pos.x, y: 0, z: o.pos.z, facing: o.facing, vx: o.vel.x, vz: o.vel.z,
        action: "official", actionT: o.signalT, actionDur: o.signalDur,
        actionData: { signal: o.signal === "none" ? "" : o.signal, signalT: o.signalT, signalDir: o.signalDir },
        hasBall: false, dribbling: false, hand: 1, ballWorld: null, lookAt: ballV,
        stance: false, stamina: 1, dt, heightM: av.player.heightIn * 0.0254, airborne: false, celebrate: false,
      });
    });
    // the table crew: seated, following the ball; updated every other frame
    tick.current++;
    const seats = tableSeats(s.cfg.court);
    avatars.staff.forEach((av, i) => {
      if ((tick.current + i) % 2) return;
      const seat = seats[i];
      av.update({
        x: seat.x, y: 0, z: seat.z, facing: 0, vx: 0, vz: 0, action: "bench", actionT: 0, actionDur: 0, actionData: {},
        hasBall: false, dribbling: false, hand: 1, ballWorld: null, lookAt: ballV, stance: false, stamina: 1, dt: dt * 2,
        heightM: av.player.heightIn * 0.0254, airborne: false, celebrate: false, seatY: SEAT_HEIGHT,
      });
    });
  });

  return <group ref={group} />;
}
