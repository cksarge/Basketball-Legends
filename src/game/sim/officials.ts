// The three-person officiating crew: floor positioning (lead, trail, center), whistles and
// hand signals, the opening toss, and handing the ball to inbounders and free-throw shooters.
// Purely presentational: officials never touch the RNG or change game outcomes.
import { huddleSpot } from "../court";
import { v2, type V2 } from "../vec";
import type { GameEvent } from "./events";
import type { Match } from "./match";
import type { TeamIdx } from "./state";

export type RefSignal =
  | "none" | "foul" | "shootingFoul" | "report" | "outOfBounds" | "travel" | "threeSeconds" | "shotClock"
  | "goaltend" | "backcourt" | "count" | "visibleCount" | "timeout" | "threeAttempt" | "threeGood"
  | "charge" | "block" | "subs" | "holdBall" | "toss" | "handBall";

export interface Official {
  idx: number;
  /** Jersey number. */
  number: number;
  pos: V2;
  vel: V2;
  facing: number;
  signal: RefSignal;
  signalT: number;
  signalDur: number;
  /** World angle the signal points toward (direction of play). */
  signalDir: number;
  queue: { signal: RefSignal; dur: number; dir?: number }[];
}

export interface Crew {
  refs: Official[];
  lead: number;
  trail: number;
  center: number;
  lastOffense: TeamIdx;
  /** Official administering the dead ball (walks it to the spot, hands it in). */
  admin: number | null;
  /** Ball hand-off in progress: ref -> player over `dur` seconds. */
  handoff: { ref: number; t: number; dur: number } | null;
  /** Official tracking a three-point attempt in the air. */
  threeRef: number | null;
}

const REF_SPEED = 6.4;

export function createCrew(match: Match): Crew {
  const c = match.state.cfg.court;
  const nums = [12, 27, 41, 8, 63, 19, 35, 54];
  const seed = match.state.cfg.seed;
  const refs: Official[] = [0, 1, 2].map((i) => ({
    idx: i, number: nums[(seed + i * 3) % nums.length], pos: v2(0, 0), vel: v2(), facing: 0,
    signal: "none", signalT: 0, signalDur: 0, signalDir: 0, queue: [],
  }));
  // jump ball: crew chief at center court, the others on the sidelines
  refs[0].pos = v2(0, -0.8);
  refs[1].pos = v2(4.5, c.halfW + 0.5);
  refs[2].pos = v2(-4.5, -(c.halfW + 0.5));
  refs[1].facing = Math.PI;
  return { refs, lead: 1, trail: 2, center: 0, lastOffense: match.state.offense, admin: null, handoff: null, threeRef: null };
}

/** Where an official holds the ball (in front of the chest). */
export function refHand(o: Official): { x: number; y: number; z: number } {
  return { x: o.pos.x + Math.sin(o.facing) * 0.36, y: 1.12, z: o.pos.z + Math.cos(o.facing) * 0.36 };
}

const angleTo = (from: V2, x: number, z: number) => Math.atan2(x - from.x, z - from.z);
const dirFor = (match: Match, team: TeamIdx) => (match.attackSide(team) > 0 ? Math.PI / 2 : -Math.PI / 2);

function nearest(crew: Crew, x: number, z: number, exclude: number[] = []) {
  let best = crew.refs[0], bd = Infinity;
  for (const o of crew.refs) {
    if (exclude.includes(o.idx)) continue;
    const d = Math.hypot(o.pos.x - x, o.pos.z - z);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

function signal(o: Official, seq: { signal: RefSignal; dur: number; dir?: number }[]) {
  o.queue = seq.slice(1);
  const first = seq[0];
  o.signal = first.signal;
  o.signalDur = first.dur;
  o.signalT = 0;
  if (first.dir !== undefined) o.signalDir = first.dir;
}

/** React to game events with the right whistle and signal. */
export function crewOnEvent(match: Match, crew: Crew, e: GameEvent) {
  const s = match.state;
  const other = (t: TeamIdx): TeamIdx => (t === 0 ? 1 : 0);
  switch (e.t) {
    case "foul": {
      const f = s.agents[e.player];
      if (!f) break;
      const o = nearest(crew, f.pos.x, f.pos.z);
      const first: RefSignal = e.kind === "charge" ? "charge" : e.kind === "blocking" ? "block" : "foul";
      const ballTeam = e.kind === "charge" ? other(f.team) : s.agents[e.on]?.team ?? other(f.team);
      signal(o, [{ signal: first, dur: 1.0 }, e.fts > 0 ? { signal: "shootingFoul", dur: 1.4 } : { signal: "report", dur: 1.1, dir: dirFor(match, ballTeam) }]);
      break;
    }
    case "violation": {
      const b = s.ball.phys.pos;
      const o = nearest(crew, b.x, b.z);
      const dir = dirFor(match, other(e.team));
      const map: Partial<Record<typeof e.kind, RefSignal>> = {
        travel: "travel", threeSeconds: "threeSeconds", shotClock: "shotClock", goaltending: "goaltend",
        backcourt: "backcourt", eightSeconds: "count", tenSeconds: "count", fiveSeconds: "count", outOfBounds: "outOfBounds",
      };
      const sig = map[e.kind] ?? "report";
      signal(o, sig === "outOfBounds" ? [{ signal: "outOfBounds", dur: 1.3, dir }] : [{ signal: sig, dur: 1.2 }, { signal: "outOfBounds", dur: 1.0, dir }]);
      break;
    }
    case "turnover":
      if (e.reason === "outOfBounds") {
        const b = s.ball.phys.pos;
        const p = s.agents[e.player];
        if (p) signal(nearest(crew, b.x, b.z), [{ signal: "outOfBounds", dur: 1.3, dir: dirFor(match, other(p.team)) }]);
      }
      break;
    case "timeout": {
      const b = s.ball.phys.pos;
      signal(nearest(crew, b.x, b.z), [{ signal: "timeout", dur: 1.3 }]);
      break;
    }
    case "sub": {
      const o = nearest(crew, 0, -s.cfg.court.halfW);
      if (o.signal === "none") signal(o, [{ signal: "subs", dur: 1.0 }]);
      break;
    }
    case "shot":
      if (e.points === 3) {
        const sh = s.agents[e.shooter];
        if (!sh) break;
        const o = nearest(crew, sh.pos.x, sh.pos.z);
        if (o.signal === "none" || o.signal === "threeAttempt") { signal(o, [{ signal: "threeAttempt", dur: 2.4 }]); crew.threeRef = o.idx; }
      }
      break;
    case "make":
      if (e.points === 3 && crew.threeRef !== null) signal(crew.refs[crew.threeRef], [{ signal: "threeGood", dur: 1.3 }]);
      crew.threeRef = null;
      break;
    case "miss":
    case "block":
      if (crew.threeRef !== null) { const o = crew.refs[crew.threeRef]; if (o.signal === "threeAttempt") signal(o, [{ signal: "none", dur: 0 }]); }
      crew.threeRef = null;
      break;
    default:
      break;
  }
}

/** Positions, movement and ball handling for this step. Runs after the game step. */
export function crewStep(match: Match, crew: Crew, dt: number) {
  const s = match.state;
  const c = s.cfg.court;
  // change of possession: lead and trail swap ends, the center stays on his sideline
  if (s.offense !== crew.lastOffense && (s.phase === "live" || s.phase === "inbound")) {
    [crew.lead, crew.trail] = [crew.trail, crew.lead];
    crew.lastOffense = s.offense;
  }
  // "holding the ball" and the visible count only last while their situation does: the phase logic below re-asserts them
  for (const o of crew.refs) if (o.signal === "holdBall" || o.signal === "visibleCount") { o.signal = "none"; o.signalDur = 0; }
  const side = match.attackSide(s.offense);
  const b = s.ball.phys.pos;
  const lead = crew.refs[crew.lead], trail = crew.refs[crew.trail], center = crew.refs[crew.center];
  const targets = new Map<Official, { p: V2; face?: V2 }>();
  const ballXZ = v2(b.x, b.z);

  // dead-ball administration: the nearest official takes the ball to the inbound spot
  if (s.phase === "deadball" && s.inbound && !s.inbound.afterScore) {
    if (crew.admin === null) crew.admin = nearest(crew, s.inbound.spot.x, s.inbound.spot.z).idx;
  } else if (s.phase !== "inbound") crew.admin = null;

  switch (s.phase) {
    case "pregame":
    case "jumpball": {
      const chief = crew.refs[0];
      targets.set(chief, { p: v2(0, -0.8), face: v2(0, 0) });
      targets.set(crew.refs[1], { p: v2(4.5, c.halfW + 0.5), face: v2(0, 0) });
      targets.set(crew.refs[2], { p: v2(-4.5, -(c.halfW + 0.5)), face: v2(0, 0) });
      // the toss: hold the ball, then send it straight up between the jumpers
      if (s.ball.mode === "dead") {
        if (s.phaseTimer < 0.95 && chief.signal !== "toss") signal(chief, [{ signal: "toss", dur: 0.7 }]);
        else if (chief.signal !== "toss") { chief.signal = "holdBall"; chief.signalDur = 0; }
        const h = refHand(chief);
        if (chief.signal !== "toss" || chief.signalT < 0.3) s.ball.phys.pos = { x: h.x, y: chief.signal === "toss" ? h.y + chief.signalT * 3.2 : h.y, z: h.z };
      }
      break;
    }
    case "freethrows": {
      const ft = s.freeThrows;
      const fside = ft ? match.attackSide(ft.team) : side;
      const rimX = fside * (c.halfL - c.rimFromBaseline);
      const shooter = ft ? s.agents[ft.shooter] : null;
      const d = shooter?.action.data;
      const handing = !!d && !d.started && s.ball.mode === "dead" && Number(d.handP ?? 1) < 1;
      // the lead administers from the lane, then backs out to the baseline
      targets.set(lead, handing ? { p: v2(rimX - fside * 1.9, -1.15), face: shooter?.pos } : { p: v2(fside * (c.halfL + 0.8), -2.4), face: v2(rimX, 0) });
      targets.set(trail, { p: v2(fside * (c.halfL - 6.6), c.halfW + 0.55), face: v2(rimX, 0) });
      targets.set(center, { p: v2(fside * (c.halfL - 5.6), -(c.halfW + 0.55)), face: v2(rimX, 0) });
      if (handing && lead.signal === "none") { lead.signal = "holdBall"; lead.signalDur = 0; }
      break;
    }
    case "timeout":
    case "periodEnd":
    case "halftime": {
      // the crew meets at the scorer's table
      crew.refs.forEach((o, i) => targets.set(o, { p: v2(-1.1 + i * 1.1, -(c.halfW + 0.55)), face: v2(0, 0) }));
      void huddleSpot;
      break;
    }
    case "final":
      crew.refs.forEach((o, i) => targets.set(o, { p: v2(-1.1 + i * 1.1, -(c.halfW + 0.55)), face: v2(0, -c.halfW - 3) }));
      break;
    default: {
      // live, inbound and dead balls: three-person mechanics
      const leadZ = Math.max(-3.4, Math.min(3.4, b.z * 0.55));
      targets.set(lead, { p: v2(side * (c.halfL + 0.85), Math.abs(leadZ) < 1.4 ? (leadZ >= 0 ? 1.4 : -1.4) : leadZ), face: ballXZ });
      const tx = side * Math.max(0.5, Math.min(c.halfL - 6.5, b.x * side - 2.6));
      targets.set(trail, { p: v2(tx, c.halfW + 0.6), face: ballXZ });
      const cx = side * Math.max(1.5, Math.min(c.halfL - 4.6, b.x * side - 0.8));
      targets.set(center, { p: v2(cx, -(c.halfW + 0.6)), face: ballXZ });
      if (crew.admin !== null && s.inbound && s.phase === "deadball") {
        // walk the ball to the spot, standing on the court side of it
        const o = crew.refs[crew.admin];
        const sp = s.inbound.spot;
        const inward = sp.z > 0 ? -1.25 : 1.25;
        targets.set(o, { p: v2(sp.x, sp.z + inward), face: sp });
        if (o.signal === "none" || o.signal === "holdBall") { o.signal = "holdBall"; o.signalDur = 0; }
        const h = refHand(o);
        s.ball.phys.pos = { x: h.x, y: h.y, z: h.z };
        s.ball.phys.vel = { x: 0, y: 0, z: 0 };
      }
      if (s.phase === "inbound" && crew.admin !== null && s.inbound) {
        const o = crew.refs[crew.admin];
        const sp = s.inbound.spot;
        targets.set(o, { p: v2(sp.x + (sp.x > 0 ? -1.4 : 1.4), sp.z + (sp.z > 0 ? -1.0 : 1.0)), face: sp });
        // visible five-second count once the ball is in the inbounder's hands
        if (s.inbound.timer > 0 && (o.signal === "none" || o.signal === "visibleCount" || o.signal === "handBall")) {
          o.signal = "visibleCount"; o.signalT = s.inbound.timer; o.signalDur = 0;
        }
      }
    }
  }

  // ball hand-off to the inbounder (bounce pass from the official)
  if (crew.handoff) {
    const hf = crew.handoff;
    hf.t += dt;
    const owner = s.ball.owner !== null ? s.agents[s.ball.owner] : null;
    if (!owner || hf.t >= hf.dur || s.phase !== "inbound") crew.handoff = null;
    else {
      const o = crew.refs[hf.ref];
      if (o.signal !== "handBall") signal(o, [{ signal: "handBall", dur: 0.45 }]);
      const from = refHand(o);
      const to = s.ball.phys.pos; // where the inbounder holds it (set by the game this step)
      const k = hf.t / hf.dur;
      const y = k < 0.5 ? from.y + (0.12 - from.y) * (k / 0.5) : 0.12 + (to.y - 0.12) * ((k - 0.5) / 0.5);
      s.ball.phys.pos = { x: from.x + (to.x - from.x) * k, y, z: from.z + (to.z - from.z) * k };
    }
  }

  // move: jog to the spot facing the play; stand still while signalling
  for (const o of crew.refs) {
    const t = targets.get(o);
    if (o.signal !== "none") {
      o.signalT += dt;
      if (o.signalDur > 0 && o.signalT >= o.signalDur) {
        const next = o.queue.shift();
        if (next) { o.signal = next.signal; o.signalDur = next.dur; o.signalT = 0; if (next.dir !== undefined) o.signalDir = next.dir; }
        else { o.signal = "none"; o.signalT = 0; }
      }
    }
    const busySignal = o.signal !== "none" && o.signal !== "threeAttempt" && o.signal !== "holdBall" && o.signal !== "visibleCount";
    let tx = o.pos.x, tz = o.pos.z;
    if (t && !busySignal) { tx = t.p.x; tz = t.p.z; }
    const dx = tx - o.pos.x, dz = tz - o.pos.z;
    const dist = Math.hypot(dx, dz);
    const want = dist > 0.12 ? Math.min(REF_SPEED, dist * 2.2) : 0;
    const vx = dist > 1e-3 ? (dx / dist) * want : 0, vz = dist > 1e-3 ? (dz / dist) * want : 0;
    const k = 1 - Math.exp(-6 * dt);
    o.vel = v2(o.vel.x + (vx - o.vel.x) * k, o.vel.z + (vz - o.vel.z) * k);
    o.pos.x += o.vel.x * dt;
    o.pos.z += o.vel.z * dt;
    // give the players room, and never stand inside the hoop bases
    for (const a of s.agents) {
      const ax = o.pos.x - a.pos.x, az = o.pos.z - a.pos.z;
      const ad = Math.hypot(ax, az);
      if (ad < 0.7 && ad > 1e-4) { o.pos.x += (ax / ad) * (0.7 - ad); o.pos.z += (az / ad) * (0.7 - ad); }
    }
    match.keepOutOfStanchions(o.pos, 0.35);
    // face the play (or the direction being signalled)
    const look = busySignal && (o.signal === "report" || o.signal === "outOfBounds") ? null : t?.face ?? ballXZ;
    const faceTo = look ? angleTo(o.pos, look.x, look.z) : o.facing;
    let df = faceTo - o.facing;
    df = Math.atan2(Math.sin(df), Math.cos(df));
    o.facing += df * Math.min(1, dt * 7);
  }
}

/** Start a referee hand-off of the ball to the inbounder (called when an inbound begins). */
export function crewStartHandoff(crew: Crew) {
  if (crew.admin === null) return false;
  crew.handoff = { ref: crew.admin, t: 0, dur: 0.5 };
  const o = crew.refs[crew.admin];
  if (o.signal === "holdBall") { o.signal = "none"; o.signalT = 0; }
  return true;
}
