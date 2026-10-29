// Team and player AI. Produces AgentIntents for every non-human agent.
// `decide` is true on decision ticks (~5 Hz); movement steering runs every frame.
import { clamp } from "@/engine/rng";
import { distToRim, inLane, isThree, rimPos } from "../court";
import { dist2, distToSeg2, v2, type V2 } from "../vec";
import { type Match, PARK_POSSESSION } from "./match";
import { type Agent, type TeamIdx, tuningFor } from "./state";

interface AIMemo {
  target?: V2;
  plan?: "drive" | "iso" | "pnr" | "post" | "kick" | "advance" | "hold";
  planUntil?: number;
  cutUntil?: number;
  exitZ?: number;
  screenFor?: number;
  nextPassOk?: number;
  shootIntent?: boolean;
  lastDecision?: number;
  variant?: number;
}
const memo = new WeakMap<Agent, AIMemo>();
const M = (a: Agent) => {
  let m = memo.get(a);
  if (!m) {
    m = { variant: a.idx % 2 };
    memo.set(a, m);
  }
  return m;
};

/** AI plans per on-court slot, for saving a game in progress. */
export function exportAIMemory(match: Match): Record<number, AIMemo> {
  const out: Record<number, AIMemo> = {};
  for (const a of match.state.agents) {
    const m = memo.get(a);
    if (m) out[a.idx] = { ...m };
  }
  return out;
}
export function importAIMemory(match: Match, data: Record<number, AIMemo> | undefined) {
  if (!data) return;
  for (const a of match.state.agents) if (data[a.idx]) memo.set(a, { ...data[a.idx] });
}

export function runAI(match: Match, dt: number, decide: boolean) {
  const s = match.state;
  COURT_HALF = { x: s.cfg.court.halfL, z: s.cfg.court.halfW };
  for (const a of s.agents) {
    if (a.human !== null) continue;
    // park shooting games move their own players
    if (match.drill?.controls(a)) continue;
    if (s.cfg.practice && a.team === 1) {
      holdStill(a);
      continue;
    }
    const intent = a.intent;
    intent.act = undefined;
    switch (s.phase) {
      case "jumpball":
        holdStill(a);
        break;
      case "deadball":
        deadBallMove(match, a);
        break;
      case "inbound":
        if (s.ball.mode === "loose") reboundAI(match, a, decide);
        else if (s.ball.mode === "pass" && s.ball.pass?.to === a.idx) receivePass(match, a);
        else inboundAI(match, a, decide);
        break;
      case "freethrows":
        holdStill(a);
        break;
      case "live":
        if (s.ball.mode === "loose" || s.ball.mode === "shot") reboundAI(match, a, decide);
        else if (s.ball.mode === "pass" && s.ball.pass?.to === a.idx) receivePass(match, a);
        else if (a.team === s.offense) offenseAI(match, a, decide);
        else defenseAI(match, a, decide);
        break;
      default:
        holdStill(a);
    }
  }
  void dt;
}

// --------------------------------------------------------------- steering
function holdStill(a: Agent) {
  a.intent.moveX = 0;
  a.intent.moveZ = 0;
  a.intent.sprint = false;
  a.intent.faceX = undefined;
  a.intent.faceZ = undefined;
}

/** Arrive steering toward target with slowdown radius. */
let COURT_HALF = { x: 14.3, z: 7.62 };
/** When set, off-ball offensive movement avoids lingering in / strolling through the lane. */
let LANE: { match: Match; side: 1 | -1 } | null = null;
function goTo(a: Agent, t: V2, opts: { sprint?: boolean; face?: V2; slow?: number; precision?: number; allowOut?: boolean; inLaneOk?: boolean } = {}) {
  if (!opts.allowOut) t = v2(clamp(t.x, -COURT_HALF.x + 0.7, COURT_HALF.x - 0.7), clamp(t.z, -COURT_HALF.z + 0.7, COURT_HALF.z - 0.7));
  if (LANE && !opts.inLaneOk) {
    const c = LANE.match.state.cfg.court;
    const side = LANE.side;
    const m = M(a);
    const inside = inLane(c, side, a.pos.x, a.pos.z);
    if (inside) {
      if (m.exitZ === undefined) m.exitZ = (t.z >= 0 ? 1 : -1) * (c.laneWidth / 2 + 1.4);
      if (a.laneTime > 0.7 || inLane(c, side, t.x, t.z)) {
        t = v2(a.pos.x - side * 0.4, m.exitZ);
        opts = { ...opts, sprint: true, precision: 0.3 };
      }
    } else {
      m.exitZ = undefined;
      // reroute around the top of the key instead of walking through the paint
      let crosses = false;
      for (let k = 1; k <= 8; k++) {
        const f = k / 8;
        if (inLane(c, side, a.pos.x + (t.x - a.pos.x) * f, a.pos.z + (t.z - a.pos.z) * f)) {
          crosses = true;
          break;
        }
      }
      if (crosses && !inLane(c, side, t.x, t.z)) {
        const topX = side * (c.halfL - c.laneLength - 1.2);
        t = v2(topX, a.pos.z + (t.z - a.pos.z) * 0.5);
      } else if (inLane(c, side, t.x, t.z)) {
        t = v2(t.x, (t.z >= 0 ? 1 : -1) * (c.laneWidth / 2 + 0.9));
      }
    }
  }
  const dx = t.x - a.pos.x,
    dz = t.z - a.pos.z;
  const d = Math.hypot(dx, dz);
  const slow = opts.slow ?? 1.4;
  const prec = opts.precision ?? 0.12;
  if (d < prec) {
    a.intent.moveX = 0;
    a.intent.moveZ = 0;
  } else {
    const k = Math.min(1, d / slow);
    a.intent.moveX = (dx / d) * k;
    a.intent.moveZ = (dz / d) * k;
  }
  a.intent.sprint = !!opts.sprint && d > 2.5;
  if (opts.face) {
    a.intent.faceX = opts.face.x;
    a.intent.faceZ = opts.face.z;
  } else {
    a.intent.faceX = undefined;
    a.intent.faceZ = undefined;
  }
}

/** Move to meet the ball on its way. */
function receivePass(match: Match, a: Agent) {
  const s = match.state;
  const p = s.ball.pass!;
  const b = s.ball.phys;
  // aim for the point on the remaining flight path closest to us
  const remaining = Math.max(0, p.dur - p.t);
  const end = v2(b.pos.x + b.vel.x * remaining, b.pos.z + b.vel.z * remaining);
  const t = match.segT(v2(b.pos.x, b.pos.z), end, a.pos);
  const meet = v2(b.pos.x + (end.x - b.pos.x) * t, b.pos.z + (end.z - b.pos.z) * t);
  goTo(a, meet, { sprint: true, slow: 0.3, face: v2(b.pos.x, b.pos.z), precision: 0.05 });
}

// --------------------------------------------------------------- dead ball
function deadBallMove(match: Match, a: Agent) {
  const s = match.state;
  const ib = s.inbound;
  if (!ib) {
    holdStill(a);
    return;
  }
  const side = match.attackSide(ib.team);
  if (ib.check) {
    // park check: the ball handler walks up top, everyone else finds their spot
    const holder = s.agents[ib.inbounder];
    if (a.idx === ib.inbounder) goTo(a, ib.spot, { slow: 1.2, face: rimPos(s.cfg.court, side) });
    else if (a.team === ib.team) goTo(a, match.spacingSpot(a.role, side, M(a).variant), { slow: 2 });
    else if (holder && a.guarding === holder.idx) goTo(a, v2(ib.spot.x + side * 1.3, ib.spot.z), { slow: 1.2, face: ib.spot });
    else {
      const man = a.guarding !== null ? s.agents[a.guarding] : null;
      const rim = rimPos(s.cfg.court, side);
      const spot = man ? match.spacingSpot(man.role, side, M(man).variant) : v2(rim.x - side * 3, 0);
      goTo(a, v2(spot.x + (rim.x - spot.x) * 0.25, spot.z * 0.8), { slow: 2 });
    }
    return;
  }
  if (a.team === ib.team) {
    // jog toward own backcourt / spacing
    const spot = ib.afterScore ? v2(-side * 6 + ((a.idx % 5) - 2) * 1.2, ((a.idx % 5) - 2) * 2.4) : match.spacingSpot(a.role, side, M(a).variant);
    goTo(a, spot, { slow: 2.5 });
  } else {
    const myRim = rimPos(s.cfg.court, match.attackSide(a.team === 0 ? 1 : 0));
    const spot = v2(myRim.x - match.attackSide(ib.team) * (3 + (a.idx % 5)), ((a.idx % 5) - 2) * 2.2);
    goTo(a, spot, { slow: 2.5 });
  }
}

// ---------------------------------------------------------------- inbound
function inboundAI(match: Match, a: Agent, decide: boolean) {
  const s = match.state;
  const ib = s.inbound!;
  const side = match.attackSide(ib.team);
  if (a.idx === ib.inbounder) {
    holdStill(a);
    a.intent.faceX = 0;
    a.intent.faceZ = 0;
    if (decide && s.ball.owner === a.idx && ib.timer > (s.cfg.fast ? 0.2 : 1.1)) {
      // pass to the most open teammate, preferring the point guard
      const mates = match.agentsOf(a.team).filter((m) => m !== a);
      let best: Agent | null = null,
        bv = -1;
      for (const m of mates) {
        const open = openness(match, m);
        const dist = dist2(m.pos, a.pos);
        const v = open * (m.role === "ball" ? 1.6 : 1) * (dist < 12 ? 1 : 0.4) * (passLaneClear(match, a, m) ? 1 : 0.2);
        if (v > bv) {
          bv = v;
          best = m;
        }
      }
      if (best && (bv > 0.35 || ib.timer > 3.6)) a.intent.act = { type: "pass", to: best.idx, kind: "chest" };
    }
    return;
  }
  if (a.team === ib.team) {
    if (a.role === "ball") {
      // come to the ball
      const t = ib.afterScore
        ? v2(ib.spot.x + side * 4.2, clamp(ib.spot.z + (M(a).variant ? 2.5 : -2.5), -6, 6))
        : v2(ib.spot.x + side * 1.5, ib.spot.z - Math.sign(ib.spot.z) * 3.5);
      goTo(a, t, { face: ib.spot });
    } else {
      goTo(a, ib.afterScore ? v2(-side * 2 + (a.idx % 5) * side * 2.5, ((a.idx % 5) - 2) * 3) : match.spacingSpot(a.role, side, M(a).variant), { slow: 2 });
    }
  } else {
    // defense: guard assignments, deny the point guard
    const man = a.guarding !== null ? s.agents[a.guarding] : null;
    if (man) {
      const myRim = rimPos(s.cfg.court, match.attackSide(man.team));
      const toRim = norm(v2(myRim.x - man.pos.x, myRim.z - man.pos.z));
      goTo(a, v2(man.pos.x + toRim.x * 1.2, man.pos.z + toRim.z * 1.2), { face: man.pos });
    }
  }
}

// ---------------------------------------------------------------- offense
function offenseAI(match: Match, a: Agent, decide: boolean) {
  const s = match.state;
  const c = s.cfg.court;
  const side = match.attackSide(a.team);
  const rim = rimPos(c, side);
  const hasBall = s.ball.owner === a.idx;
  const m = M(a);
  const aggression = s.cfg.sliders.aiAggression;

  if (hasBall) {
    if (match.isBusy(a)) {
      holdStill(a);
      return;
    }
    // half court at the park: after a change of possession, take it back past the arc before scoring
    if (s.cfg.park?.halfCourt && s.park && !s.park.cleared) {
      const out = v2(rim.x - side * (c.threeRadius + 1.4), clamp(a.pos.z * 0.6, -4, 4));
      goTo(a, out, { slow: 0.6, sprint: distToRim(c, side, a.pos.x, a.pos.z) < 3 });
      if (decide && (m.nextPassOk ?? 0) < s.time) {
        const outlet = match
          .agentsOf(a.team)
          .find((t) => t !== a && isThree(c, side, t.pos.x, t.pos.z) && openness(match, t) > 0.6 && passLaneClear(match, a, t));
        if (outlet && match.rng.chance(0.35)) {
          a.intent.act = { type: "pass", to: outlet.idx, kind: "chest" };
          m.nextPassOk = s.time + 0.8;
        }
      }
      keepInBounds(match, a);
      return;
    }
    const front = a.pos.x * side > 0;
    const dRim = distToRim(c, side, a.pos.x, a.pos.z);
    const shotClock = s.cfg.rules.shotClock || s.cfg.park ? s.shotClock : 99;
    const humanCaller = (s as typeof s & { callFor?: number | null }).callFor;

    // pass to a human teammate who's calling for the ball
    if (humanCaller != null && s.agents[humanCaller]?.team === a.team && humanCaller !== a.idx) {
      (s as typeof s & { callFor?: number | null }).callFor = null;
      a.intent.act = { type: "pass", to: humanCaller, kind: passKind(match, a, s.agents[humanCaller]) };
      return;
    }

    if (!front && s.ball.mode !== "loose") {
      // advance the ball; push in transition
      const defBack = match.agentsOf(a.team === 0 ? 1 : 0).filter((d) => (d.pos.x - a.pos.x) * side > 0).length;
      // beat the press and the half-court count: get it up the floor when time runs short
      const pressed = s.teams[a.team === 0 ? 1 : 0].tactics.defense === "press";
      const urgent = pressed || s.backcourtTimer > s.cfg.rules.backcourtSeconds * 0.45;
      const push = defBack <= 2 || s.teams[a.team].tactics.pace > 0.6 || urgent;
      const lane = m.variant ? 2.5 : -2.5;
      goTo(a, v2(side * 4, lane), { sprint: push, slow: 0.5 });
      if (decide && push) {
        // ahead pass to a streaking teammate
        const ahead = match
          .agentsOf(a.team)
          .filter((t) => t !== a && (t.pos.x - a.pos.x) * side > (urgent ? 3 : 6) && openness(match, t) > (urgent ? 0.6 : 0.8));
        if (ahead.length && match.rng.chance(urgent ? 0.55 : 0.35)) a.intent.act = { type: "pass", to: ahead[0].idx, kind: "chest" };
      }
      return;
    }

    // fast break: attack the rim if numbers
    const defendersAhead = match
      .agentsOf(a.team === 0 ? 1 : 0)
      .filter((d) => (rim.x - d.pos.x) * side < (rim.x - a.pos.x) * side + 1 && Math.abs(d.pos.z - a.pos.z) < 6).length;
    if (dRim < 11 && defendersAhead === 0) m.plan = "drive";

    if (decide) {
      m.lastDecision = s.time;
      const ev = match.shotValue(a);
      const three = isThree(c, side, a.pos.x, a.pos.z);
      const tac = s.teams[a.team].tactics;
      const tune = tuningFor(s.cfg);
      const threePref = (0.85 + tac.threeRate * 0.3) * tune.threeBias;
      const clockPressure = shotClock < 5 ? 0.35 : shotClock < 9 ? 0.15 : 0;
      // possession maturity: early in the clock only take clearly good shots
      const shotClockMax = s.cfg.park ? PARK_POSSESSION : (s.cfg.rules.shotClock ?? 35);
      const elapsed = shotClockMax - shotClock;
      const patience = 9 + tune.patience + (1 - tac.pace) * 9;
      const early = elapsed < patience ? 0.4 * (1 - elapsed / patience) : 0;
      const threshold = (three ? 1.07 / threePref : 1.0) + early - clockPressure - (a.heat > 0.5 ? 0.05 : 0);
      const holdOk = a.holdTime > 0.5 || s.time - s.ball.lastPassTime > 0.9;
      // shoot
      if (ev > threshold && holdOk && dRim < c.threeRadius + 1.6 && (dRim > 3 || match.contestOn(a) < 0.5)) {
        a.intent.act = { type: "shoot", phase: "press" };
        return;
      }
      if (shotClock < 2.2) {
        a.intent.act = { type: "shoot", phase: "press" };
        return;
      }
      // don't camp in the lane with the ball
      if (a.laneTime > 1.7) {
        if (dRim < 3.2) {
          a.intent.act = { type: "shoot", phase: "press" };
          return;
        }
        m.plan = "kick";
        m.planUntil = s.time + 1;
      }
      // finish at the rim when close
      if (dRim < 2.4 && (match.contestOn(a) < 0.45 || (m.plan === "drive" && elapsed > patience * 0.5))) {
        a.intent.act = { type: "shoot", phase: "press" };
        return;
      }
      // pass to a better option
      if ((m.nextPassOk ?? 0) < s.time && a.holdTime > 0.35) {
        let best: Agent | null = null,
          bv = 0;
        for (const t of match.agentsOf(a.team)) {
          if (t === a) continue;
          if (!passLaneClear(match, a, t)) continue;
          const open = openness(match, t);
          const val = match.shotValue(t) * (0.55 + 0.45 * open) + (t.human !== null ? 0.08 : 0) - dist2(a.pos, t.pos) * 0.008;
          if (val > bv) {
            bv = val;
            best = t;
          }
        }
        const myVal = ev + (m.plan === "drive" ? 0.25 : 0);
        if (best && bv > myVal + 0.12 && (a.holdTime > 1.2 || bv > 1.1)) {
          a.intent.act = { type: "pass", to: best.idx, kind: passKind(match, a, best) };
          m.nextPassOk = s.time + 0.6;
          m.plan = undefined;
          return;
        }
        // lob to a cutting big
        const lobT = match
          .agentsOf(a.team)
          .find(
            (t) =>
              t !== a &&
              distToRim(c, side, t.pos.x, t.pos.z) < 2.2 &&
              openness(match, t) > 0.7 &&
              match.reach(t) + match.verticalLeap(t) > c.rimHeight + 0.15 &&
              t.vel.x * side > 1,
          );
        if (lobT && match.rng.chance(0.25 * aggression)) {
          a.intent.act = { type: "pass", to: lobT.idx, kind: "alley" };
          return;
        }
      }
      // choose a plan
      if (!m.plan || (m.planUntil ?? 0) < s.time) {
        const defender = match.nearestOpponent(a);
        const laneOpen = driveLaneOpen(match, a);
        const handle = match.r(a, "ballHandle");
        const post = (a.player.pos === "C" || a.player.pos === "PF") && match.r(a, "postControl") > 60 && dRim < 6;
        const call = s.teams[a.team].playCall;
        const opts: [NonNullable<AIMemo["plan"]>, number][] = [
          ["drive", (laneOpen ? 2.2 : 0.4) * (match.r(a, "layup") / 70) * aggression],
          ["iso", (handle / 75) * (defender ? 1 : 0.2)],
          ["pnr", call === "pnr" ? 3 : 1.1],
          ["post", post ? 1.6 : 0],
          ["hold", 0.5],
        ];
        m.plan = match.rng.weighted(
          opts.map((o) => o[0]),
          opts.map((o) => o[1]),
        );
        m.planUntil = s.time + 1.5 + match.rng.range(0, 1.5);
        if (m.plan === "pnr") requestScreen(match, a);
      }
      // dribble moves to create space
      const def = match.nearestOpponent(a);
      if (def && dist2(def.pos, a.pos) < 1.6 && !a.pickedUp && match.rng.chance(0.22 * (match.r(a, "ballHandle") / 80))) {
        const moves = ["crossover", "behindBack", "hesitation", "stepback", "spin", "betweenLegs"] as const;
        const w = [3, 1.5, 2, three ? 0.6 : 1.5, 1, 1.5];
        // pick the side that moves away from the nearest sideline
        const lx = Math.cos(a.facing),
          lz = -Math.sin(a.facing);
        const towardMiddle = -(a.pos.z * lz + 0 * lx) > 0 ? 1 : -1;
        const dir = Math.abs(a.pos.z) > c.halfW - 2.2 ? towardMiddle : match.rng.chance(0.5) ? 1 : -1;
        a.intent.act = { type: "dribbleMove", move: match.rng.weighted([...moves], w), dir };
        return;
      }
      if (m.plan === "post" && a.action.kind !== "post") a.intent.act = { type: "post", on: true };
    }

    // execute plan movement
    switch (m.plan) {
      case "drive": {
        const target = v2(rim.x - side * 0.6, rim.z + (a.pos.z > 0 ? 0.4 : -0.4));
        goTo(a, target, { sprint: true, slow: 0.3 });
        break;
      }
      case "post": {
        const target = v2(rim.x - side * 1.6, clamp(a.pos.z, -1.5, 1.5));
        goTo(a, target, { slow: 0.5, face: v2(a.pos.x - side * 3, a.pos.z) });
        break;
      }
      case "pnr": {
        // use the screen: curl around the screener toward the rim
        const scr = m.screenFor !== undefined ? s.agents[m.screenFor] : null;
        if (scr && dist2(scr.pos, a.pos) < 3) {
          const t = v2(scr.pos.x + side * 1.8, scr.pos.z + (scr.pos.z > a.pos.z ? 1.5 : -1.5));
          goTo(a, t, { slow: 0.6 });
        } else {
          goTo(a, match.spacingSpot("ball", side), { slow: 1.5 });
        }
        break;
      }
      case "iso": {
        const t = v2(rim.x - side * (c.threeRadius - 0.6), a.pos.z * 0.8);
        goTo(a, t, { slow: 1.2 });
        break;
      }
      case "kick": {
        // pass out or back out of the lane
        goTo(a, v2(a.pos.x - side * 2.5, a.pos.z * 1.2), { slow: 0.5 });
        break;
      }
      default: {
        const t = match.spacingSpot(a.role, side, m.variant);
        goTo(a, v2(t.x * 0.9 + a.pos.x * 0.1, t.z * 0.9 + a.pos.z * 0.1), { slow: 2 });
      }
    }
    // avoid backcourt / out of bounds
    if (a.pos.x * side < 0.6 && s.frontcourt) {
      a.intent.moveX = Math.abs(a.intent.moveX) * side;
    }
    keepInBounds(match, a);
    return;
  }

  // ---- off-ball offense
  LANE = { match, side };
  try {
    offBall(match, a, decide, side, rim, m);
  } finally {
    LANE = null;
  }
}

function offBall(match: Match, a: Agent, decide: boolean, side: 1 | -1, rim: { x: number; y: number; z: number }, m: AIMemo) {
  const s = match.state;
  const c = s.cfg.court;
  const handler = match.handler();
  if (!handler) {
    goTo(a, match.spacingSpot(a.role, side, m.variant));
    return;
  }
  // transition: sprint to frontcourt
  if (!s.frontcourt && a.pos.x * side < 2) {
    const lane = (a.role === "corner" ? 1 : a.role === "wing" ? -1 : a.role === "post" ? 0.3 : 0.6) * (c.halfW - 2);
    goTo(a, v2(rim.x - side * (a.role === "post" ? 2 : 6), lane), { sprint: true, slow: 2 });
    return;
  }
  // screener duty
  if (m.screenFor !== undefined && (m.planUntil ?? 0) > s.time) {
    const user = s.agents[m.screenFor];
    const def = user ? match.nearestOpponent(user) : null;
    if (def && user && s.ball.owner === user.idx) {
      // set the screen on the defender's side toward the middle of the floor
      const hd = norm(v2(def.pos.x - user.pos.x, def.pos.z - user.pos.z));
      let perp = v2(-hd.z, hd.x);
      if (perp.z * -Math.sign(user.pos.z || 1) < 0) perp = v2(-perp.x, -perp.z);
      const screenSpot = v2(def.pos.x + perp.x * 0.7, def.pos.z + perp.z * 0.7);
      if (inLane(c, side, screenSpot.x, screenSpot.z)) {
        m.screenFor = undefined;
        return;
      }
      goTo(a, screenSpot, { slow: 0.4, face: user.pos });
      if (dist2(a.pos, screenSpot) < 0.6 && a.action.kind !== "screen") match.startAction(a, "screen", 1.4);
      return;
    }
    // roll / pop after the screen
    if (a.action.kind === "screen" && a.action.t > a.action.dur) a.action = { kind: "idle", t: 0, dur: 0, data: {} };
  }
  // cuts: backdoor when the defender is overplaying / ball-watching
  if (decide && (m.cutUntil ?? 0) < s.time) {
    const def = a.guarding !== null ? null : match.nearestOpponent(a);
    const d = def ?? match.nearestOpponent(a);
    const defFacingBall = d ? Math.abs(angleBetween(d.facing, Math.atan2(handler.pos.x - d.pos.x, handler.pos.z - d.pos.z))) < 0.6 : false;
    if (d && defFacingBall && match.rng.chance(0.07 * (match.r(a, "iq") / 70)) && distToRim(c, side, a.pos.x, a.pos.z) > 3) {
      m.cutUntil = s.time + 1.6;
      m.target = v2(rim.x - side * 1.2, rim.z + match.rng.range(-1, 1));
    } else if (match.rng.chance(0.04)) {
      // relocate along the perimeter
      m.variant = m.variant ? 0 : 1;
    }
  }
  if ((m.cutUntil ?? 0) > s.time && m.target) {
    goTo(a, m.target, { sprint: true, slow: 0.5, inLaneOk: a.laneTime < 1.2 });
    return;
  }
  // spacing spot, adjusted away from the ball handler
  let spot = match.spacingSpot(a.role, side, m.variant);
  if (dist2(spot, handler.pos) < 3.5) {
    const away = norm(v2(spot.x - handler.pos.x, spot.z - handler.pos.z));
    spot = v2(spot.x + away.x * 2.5, spot.z + away.z * 2.5);
  }
  // drift to open space when the handler drives (drive-and-kick)
  if (M(handler).plan === "drive" && isThree(c, side, spot.x, spot.z)) {
    spot = v2(spot.x, spot.z * 1.05);
  }
  goTo(a, spot, { slow: 1.6, face: handler.pos });
  keepInBounds(match, a);
}

function requestScreen(match: Match, handler: Agent) {
  const s = match.state;
  const bigs = match.agentsOf(handler.team).filter((t) => t !== handler && (t.role === "post" || t.role === "corner"));
  const scr = bigs.sort((a, b) => dist2(a.pos, handler.pos) - dist2(b.pos, handler.pos))[0];
  if (!scr) return;
  const mm = M(scr);
  mm.screenFor = handler.idx;
  mm.planUntil = s.time + 3.5;
  M(handler).screenFor = scr.idx;
}

function passKind(match: Match, from: Agent, to: Agent): "chest" | "bounce" | "lob" {
  let blocked = 0;
  for (const d of match.agentsOf(from.team === 0 ? 1 : 0)) {
    if (distToSeg2(from.pos, to.pos, d.pos) < 0.8) blocked++;
  }
  if (blocked && dist2(from.pos, to.pos) > 5) return "lob";
  return blocked && match.rng.chance(0.6) ? "bounce" : "chest";
}

// ---------------------------------------------------------------- defense
function defenseAI(match: Match, a: Agent, decide: boolean) {
  const s = match.state;
  const c = s.cfg.court;
  const offTeam = s.offense;
  const side = match.attackSide(offTeam); // basket we protect
  const rim = rimPos(c, side);
  const handler = match.handler();
  const tactics = s.teams[a.team].tactics;
  const aggression = s.cfg.sliders.aiAggression;
  if (match.isBusy(a)) {
    holdStill(a);
    return;
  }

  // full-court press: pick up the ball in the backcourt and trap it before half court
  const pressing =
    tactics.defense === "press" && handler !== null && handler.team === offTeam && !s.frontcourt && (s.phase === "live" || s.phase === "inbound");
  // transition defense: get back
  if (!pressing && handler && (handler.pos.x - a.pos.x) * side > 1 && Math.abs(a.pos.x - rim.x) > 6) {
    goTo(a, v2(rim.x - side * 3, clamp(handler.pos.z * 0.5, -3, 3)), { sprint: true });
    return;
  }

  let man = a.guarding !== null ? s.agents[a.guarding] : null;
  if (!man || man.team === a.team) {
    man = match.nearestOpponent(a);
  }
  if (!man) {
    holdStill(a);
    return;
  }

  // in a zone, whoever is closest to the ball takes it; the others guard their area
  const zone = tactics.defense === "zone23" || tactics.defense === "zone32";
  let onBall = handler !== null && man.idx === handler.idx;
  if (zone && handler && handler.team === offTeam) {
    const closest = match.agentsOf(a.team).reduce((b, d) => (dist2(d.pos, handler.pos) < dist2(b.pos, handler.pos) ? d : b));
    onBall = closest === a;
    if (onBall) man = handler;
  }
  const ballPos = s.ball.phys.pos;
  const toRim = norm(v2(rim.x - man.pos.x, rim.z - man.pos.z));
  const manRimDist = distToRim(c, side, man.pos.x, man.pos.z);

  let target: V2;
  if (pressing && handler) {
    const helpers = match
      .agentsOf(a.team)
      .filter((d) => d.guarding !== handler.idx)
      .sort((x, y) => dist2(x.pos, handler.pos) - dist2(y.pos, handler.pos));
    const toR = norm(v2(rim.x - handler.pos.x, rim.z - handler.pos.z));
    if (onBall) {
      target = v2(handler.pos.x + toR.x * 0.75, handler.pos.z + toR.z * 0.75);
    } else if (helpers[0] === a && s.phase === "live") {
      // the trapper closes from the middle of the floor, pinning the ball toward the sideline
      const mid = handler.pos.z > 0 ? -1 : 1;
      target = v2(handler.pos.x + toR.x * 0.5, handler.pos.z + mid * 0.85);
    } else {
      // everyone else denies the next pass
      target = v2(man.pos.x + (handler.pos.x - man.pos.x) * 0.3 + toR.x * 0.6, man.pos.z + (handler.pos.z - man.pos.z) * 0.3);
    }
  } else if (zone && !onBall) {
    const spot = zoneSpot(match, a, side);
    // close out on anyone who drifts into my area (not the ball, someone else has it)
    const intruder = match
      .agentsOf(offTeam)
      .filter((o) => o !== handler && dist2(o.pos, spot) < 3.4)
      .sort((x, y) => dist2(x.pos, spot) - dist2(y.pos, spot))[0];
    const backLine = distToRim(c, side, spot.x, spot.z) < 3.2;
    const hRim = handler ? distToRim(c, side, handler.pos.x, handler.pos.z) : 99;
    if (handler && backLine && hRim < 6) {
      // the back line walls off the paint on drives
      target = v2(handler.pos.x + (rim.x - handler.pos.x) * 0.45, handler.pos.z + (rim.z - handler.pos.z) * 0.45);
      target = v2(target.x * 0.7 + spot.x * 0.3, target.z * 0.7 + spot.z * 0.3);
    } else if (intruder && (!backLine || distToRim(c, side, intruder.pos.x, intruder.pos.z) < 4.5)) {
      // close out, but the back line never chases out past the short corner
      const toR = norm(v2(rim.x - intruder.pos.x, rim.z - intruder.pos.z));
      const guardSpot = v2(intruder.pos.x + toR.x * 1.1, intruder.pos.z + toR.z * 1.1);
      target = v2(spot.x * 0.3 + guardSpot.x * 0.7, spot.z * 0.3 + guardSpot.z * 0.7);
    } else target = spot;
  } else if (onBall && s.cfg.park?.game === "21" && handler && match.agentsOf(a.team).length > 1) {
    // 21: the closest defender plays the ball, the rest wall off the paint
    const defenders = match.agentsOf(a.team).sort((x, y) => dist2(x.pos, handler.pos) - dist2(y.pos, handler.pos));
    const k = defenders.indexOf(a);
    if (k === 0) target = v2(man.pos.x + toRim.x * 1.05, man.pos.z + toRim.z * 1.05);
    else {
      const lat = v2(-toRim.z, toRim.x);
      const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 1.5;
      const depth = 2.4 + Math.ceil(k / 2) * 0.6;
      target = v2(man.pos.x + toRim.x * depth + lat.x * off, man.pos.z + toRim.z * depth + lat.z * off);
      onBall = false;
    }
  } else if (onBall) {
    // respect shooters, give cushion to quick drivers
    const shooter = match.r(man, "three") > 78;
    const quick = match.r(man, "speedWithBall") - match.r(a, "speed") > 8;
    let gap = 1.05 + (quick ? 0.35 : 0) - (shooter && isThree(c, side, man.pos.x, man.pos.z) ? 0.25 : 0);
    if (manRimDist > c.threeRadius + 2.5) gap += 1.0; // don't pick up too far out
    if (tactics.defense === "press") gap = 0.85;
    target = v2(man.pos.x + toRim.x * gap, man.pos.z + toRim.z * gap);
  } else {
    // off-ball: sag toward the ball / paint based on distance to the ball
    const distBall = Math.hypot(man.pos.x - ballPos.x, man.pos.z - ballPos.z);
    const help = clamp(distBall / 12, 0.15, 0.6);
    const base = v2(man.pos.x + toRim.x * 1.3, man.pos.z + toRim.z * 1.3);
    const paint = v2(rim.x - side * 2.5, 0);
    target = v2(base.x + (paint.x - base.x) * help * 0.6, base.z + (paint.z - base.z) * help * 0.6);
    // deny one pass away
    if (distBall < 6 && handler) {
      const lane = v2((man.pos.x + handler.pos.x) / 2, (man.pos.z + handler.pos.z) / 2);
      target = v2(target.x * 0.6 + lane.x * 0.4, target.z * 0.6 + lane.z * 0.4);
    }
    // help on drives
    if (handler && M(handler).plan === "drive") {
      const hRim = distToRim(c, side, handler.pos.x, handler.pos.z);
      const myRim = distToRim(c, side, a.pos.x, a.pos.z);
      if (hRim < 5 && myRim < hRim && dist2(a.pos, handler.pos) < 4 && match.r(a, "iq") > 55) {
        target = v2(handler.pos.x + (rim.x - handler.pos.x) * 0.4, handler.pos.z + (rim.z - handler.pos.z) * 0.4);
      }
    }
  }
  const face = handler ? handler.pos : v2(ballPos.x, ballPos.z);
  goTo(a, target, { slow: 0.6, face, sprint: dist2(a.pos, target) > 3, precision: 0.08 });
  if (onBall && dist2(a.pos, man.pos) < 2.2 && a.action.kind === "idle") match.startAction(a, "stance", 0);

  if (!decide || !handler) return;
  const d = dist2(a.pos, handler.pos);
  // contest / block shots
  const shooting = ["jumper", "fadeaway", "floater", "hook", "layup", "dunk"].includes(handler.action.kind);
  if (shooting && d < 1.6 && a.y === 0) {
    const pBlock = (match.r(a, "block") / 99) * (handler.action.kind === "layup" || handler.action.kind === "dunk" ? 0.85 : 0.5);
    if (match.rng.chance(pBlock * aggression)) a.intent.act = { type: "block" };
    return;
  }
  // pump fake bite handled in match; steals
  if (onBall && d < 1.1 && !shooting) {
    const pSteal = 0.02 * (match.r(a, "steal") / 75) * aggression * (handler.action.kind === "dribbleMove" ? 1.6 : 1) * tuningFor(s.cfg).steals;
    if (match.rng.chance(pSteal)) a.intent.act = { type: "steal" };
  }
  // double team stars
  if (tactics.doubleTeamStars && !onBall && d < 4 && handler.player.potential > 88 && match.rng.chance(0.1)) {
    goTo(a, v2(handler.pos.x + toRim.x * 0.8, handler.pos.z + 0.8), { sprint: true });
  }
}

function zoneSpot(match: Match, a: Agent, side: 1 | -1): V2 {
  const s = match.state;
  const c = s.cfg.court;
  const rim = rimPos(c, side);
  const ball = s.ball.phys.pos;
  const shift = clamp(ball.z / c.halfW, -1, 1) * 1.6;
  const team = match.agentsOf(a.team).sort((x, y) => ["PG", "SG", "SF", "PF", "C"].indexOf(x.player.pos) - ["PG", "SG", "SF", "PF", "C"].indexOf(y.player.pos));
  const k = team.indexOf(a);
  const z23 = [v2(5.2, -1.6), v2(5.2, 1.6), v2(2.2, -3.6), v2(2.2, 3.6), v2(1.4, 0)];
  const z32 = [v2(6.3, 0), v2(4.8, -3.4), v2(4.8, 3.4), v2(1.8, -2.2), v2(1.8, 2.2)];
  const spots = s.teams[a.team].tactics.defense === "zone32" ? z32 : z23;
  const sp = spots[k] ?? v2(3, 0);
  return v2(rim.x - side * sp.x, sp.z + shift);
}

// ---------------------------------------------------------------- rebound
function reboundAI(match: Match, a: Agent, decide: boolean) {
  const s = match.state;
  const c = s.cfg.court;
  const b = s.ball.phys;
  const land = predictLanding(match);
  const shotTeam = s.ball.shot?.team ?? s.ball.lastTouch;
  const offense = a.team === shotTeam;
  const crash = s.teams[a.team].tactics.crashBoards;
  const side = match.attackSide(shotTeam);
  const rim = rimPos(c, side);
  const dLand = dist2(a.pos, land);

  if (s.ball.mode === "shot" && s.ball.shot) {
    // the ball is in the air on a shot: box out or crash
    if (offense) {
      const crasher = a.role === "post" || (a.role === "corner" && crash > 0.35) || (crash > 0.7 && a.role !== "ball");
      if (crasher && a.idx !== s.ball.shot.shooter) goTo(a, v2(rim.x - side * 1.6, a.pos.z * 0.5), { sprint: true });
      else if (s.cfg.park?.halfCourt) goTo(a, v2(rim.x - side * (c.threeRadius + 1), a.pos.z * 0.8), { slow: 2 });
      else goTo(a, v2(-side * 4, a.pos.z * 0.5), { sprint: false, slow: 3 }); // get back
    } else {
      // zones box out whoever is closest; man defenders find their own man
      const zoned = s.teams[a.team].tactics.defense.startsWith("zone");
      const man = !zoned && a.guarding !== null ? s.agents[a.guarding] : match.nearestOpponent(a);
      if (man) {
        const toRim = norm(v2(rim.x - man.pos.x, rim.z - man.pos.z));
        goTo(a, v2(man.pos.x + toRim.x * 0.65, man.pos.z + toRim.z * 0.65), { face: man.pos, slow: 0.4 });
      }
    }
    return;
  }
  // loose ball: chase the landing spot; closest players attack it
  const mates = match.agentsOf(a.team).sort((x, y) => dist2(x.pos, land) - dist2(y.pos, land));
  const rank = mates.indexOf(a);
  const chasers = offense ? 1 + Math.round(crash * 2) : 3;
  if (rank < chasers || dLand < (offense ? 2.5 : 4)) {
    goTo(a, land, { sprint: true, slow: 0.2 });
    const above = b.pos.y > match.heightM(a) * 1.1 && b.pos.y < a.y + match.reach(a) + match.verticalLeap(a);
    if (decide && above && dist2(a.pos, v2(b.pos.x, b.pos.z)) < 1.2 && b.vel.y < 0 && a.y === 0) a.intent.act = { type: "rebound" };
  } else {
    // safety: retreat on defense, space on offense
    // offense: get back in transition; defense: hold position between ball and the basket
    const back = s.cfg.park?.halfCourt ? c.threeRadius + 1 : 9;
    goTo(a, offense ? v2(rim.x - side * back, a.pos.z * 0.5) : v2((land.x + rim.x) / 2, (land.z + rim.z) / 2), { slow: 1.5 });
  }
}

export function predictLanding(match: Match): V2 {
  const b = match.state.ball.phys;
  // simple ballistic estimate to reach ~1.4 m height
  let x = b.pos.x,
    y = b.pos.y,
    z = b.pos.z,
    vy = b.vel.y;
  const vx = b.vel.x,
    vz = b.vel.z;
  for (let i = 0; i < 180; i++) {
    const h = 1 / 60;
    vy -= 9.81 * h;
    x += vx * h;
    y += vy * h;
    z += vz * h;
    if (vy < 0 && y < 1.5) break;
  }
  return v2(x, z);
}

// ---------------------------------------------------------------- helpers
export function openness(match: Match, a: Agent): number {
  let best = 9;
  for (const o of match.agentsOf(a.team === 0 ? 1 : 0)) best = Math.min(best, dist2(o.pos, a.pos));
  return clamp((best - 0.8) / 2.5, 0, 1);
}

function passLaneClear(match: Match, from: Agent, to: Agent): boolean {
  for (const d of match.agentsOf(from.team === 0 ? 1 : 0)) {
    const t = match.segT(from.pos, to.pos, d.pos);
    if (t < 0.12 || t > 0.92) continue;
    if (distToSeg2(from.pos, to.pos, d.pos) < 0.6 + match.r(d, "steal") * 0.004) return false;
  }
  return true;
}

function driveLaneOpen(match: Match, a: Agent): boolean {
  const s = match.state;
  const rim = rimPos(s.cfg.court, match.attackSide(a.team));
  const r2 = v2(rim.x, rim.z);
  let blockers = 0;
  for (const d of match.agentsOf(a.team === 0 ? 1 : 0)) {
    if (distToSeg2(a.pos, r2, d.pos) < 1.1 && dist2(d.pos, r2) < dist2(a.pos, r2)) blockers++;
  }
  return blockers <= (match.r(a, "ballHandle") > 80 ? 1 : 0);
}

function keepInBounds(match: Match, a: Agent) {
  const c = match.state.cfg.court;
  if (Math.abs(a.pos.z) > c.halfW - 0.5 && Math.sign(a.intent.moveZ) === Math.sign(a.pos.z)) a.intent.moveZ = -Math.sign(a.pos.z) * 0.3;
  if (Math.abs(a.pos.x) > c.halfL - 0.5 && Math.sign(a.intent.moveX) === Math.sign(a.pos.x)) a.intent.moveX = -Math.sign(a.pos.x) * 0.3;
}

const norm = (p: V2): V2 => {
  const l = Math.hypot(p.x, p.z) || 1;
  return v2(p.x / l, p.z / l);
};
function angleBetween(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export type { TeamIdx };
