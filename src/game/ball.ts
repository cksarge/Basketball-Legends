// Ball flight physics: gravity, drag, Magnus-lite spin, floor, rims, backboards,
// net damping, and make detection. Runs with internal substeps for stability.
import { boardX, type CourtSpec, rimPos } from "./court";
import { add3, cross3, dot3, len3, scale3, sub3, type V3, v3 } from "./vec";

export const GRAVITY = 9.81;

export type BallEventType = "floor" | "rim" | "board" | "net" | "score" | "outOfBounds" | "stanchion";
export interface BallEvent {
  type: BallEventType;
  side?: 1 | -1;
  speed: number;
  pos: V3;
}

export interface BallPhys {
  pos: V3;
  vel: V3;
  spin: V3; // angular velocity (rad/s)
  /** Seconds spent in the cylinder below a rim (net). */
  inNet: number;
  /** Was the ball above rim height on the way down for each side (for make detection). */
  aboveRim: { [k: string]: boolean };
  /** Touched rim/board since last release (for scoring/logic). */
  touchedRim: boolean;
  touchedBoard: boolean;
}

export function newBallPhys(): BallPhys {
  return { pos: v3(0, 1.2, 0), vel: v3(), spin: v3(), inNet: 0, aboveRim: {}, touchedRim: false, touchedBoard: false };
}

const RESTITUTION_FLOOR = 0.78;
const RESTITUTION_RIM = 0.55;
const RESTITUTION_BOARD = 0.62;
const FRICTION_FLOOR = 0.85;
const DRAG = 0.012; // simple quadratic drag coefficient (per meter)
const RIM_TUBE = 0.0095; // rim tube radius
const NET_DEPTH = 0.42;

/**
 * Integrate the ball for dt seconds. Returns physical events in order.
 */
export function stepBall(b: BallPhys, c: CourtSpec, dt: number, out: BallEvent[] = []): BallEvent[] {
  const sub = Math.max(1, Math.ceil(dt / (1 / 480)));
  const h = dt / sub;
  const R = c.ballRadius;
  for (let s = 0; s < sub; s++) {
    // forces
    const sp = len3(b.vel);
    const drag = DRAG * sp;
    b.vel.x -= b.vel.x * drag * h;
    b.vel.y -= b.vel.y * drag * h + GRAVITY * h;
    b.vel.z -= b.vel.z * drag * h;
    // tiny Magnus effect from spin (backspin keeps shots soft)
    const mag = cross3(b.spin, b.vel);
    b.vel.x += mag.x * 0.00045 * h;
    b.vel.y += mag.y * 0.00045 * h;
    b.vel.z += mag.z * 0.00045 * h;
    b.spin = scale3(b.spin, 1 - 0.2 * h);

    const prevY = b.pos.y;
    b.pos.x += b.vel.x * h;
    b.pos.y += b.vel.y * h;
    b.pos.z += b.vel.z * h;

    for (const side of [1, -1] as const) {
      collideHoop(b, c, side, prevY, out);
    }

    // floor
    if (b.pos.y < R) {
      b.pos.y = R;
      if (b.vel.y < 0) {
        const impact = -b.vel.y;
        b.vel.y = impact > 0.35 ? impact * RESTITUTION_FLOOR : 0;
        // spin converts to horizontal speed on bounce
        b.vel.x = b.vel.x * FRICTION_FLOOR + b.spin.z * R * 0.15;
        b.vel.z = b.vel.z * FRICTION_FLOOR - b.spin.x * R * 0.15;
        b.spin = scale3(b.spin, 0.6);
        if (impact > 0.35) out.push({ type: "floor", speed: impact, pos: { ...b.pos } });
      }
      // rolling friction
      if (b.vel.y === 0) {
        b.vel.x *= 1 - 0.9 * h;
        b.vel.z *= 1 - 0.9 * h;
      }
    }
  }
  return out;
}

function collideHoop(b: BallPhys, c: CourtSpec, side: 1 | -1, prevY: number, out: BallEvent[]) {
  const R = c.ballRadius;
  const rim = rimPos(c, side);
  const bx = boardX(c, side);
  const key = side === 1 ? "r" : "l";

  // --- backboard (thin box, front face toward court)
  const faceX = bx - side * 0.015;
  const nearBoard = Math.abs(b.pos.z) <= c.boardWidth / 2 + R && b.pos.y >= c.boardBottom - R && b.pos.y <= c.boardBottom + c.boardHeight + R;
  if (nearBoard) {
    const penetration = side === 1 ? b.pos.x + R - faceX : faceX - (b.pos.x - R);
    const behind = side === 1 ? b.pos.x > bx + 0.05 : b.pos.x < bx - 0.05;
    if (penetration > 0 && !behind && b.vel.x * side > 0) {
      b.pos.x = faceX - side * R;
      const sp = Math.abs(b.vel.x);
      b.vel.x = -b.vel.x * RESTITUTION_BOARD;
      b.vel.y *= 0.9;
      b.vel.z *= 0.9;
      b.spin.z *= -0.5;
      b.touchedBoard = true;
      out.push({ type: "board", side, speed: sp, pos: { ...b.pos } });
    }
  }
  // --- support arm / stanchion: block balls passing behind the board
  if (Math.abs(b.pos.z) < 0.15 && b.pos.y > c.boardBottom - 0.4 && b.pos.y < c.boardBottom + 0.2) {
    const beyond = side === 1 ? b.pos.x > bx + 0.05 && b.pos.x < bx + 1.2 : b.pos.x < bx - 0.05 && b.pos.x > bx - 1.2;
    if (beyond && b.vel.x * side > 0) {
      b.vel.x = -b.vel.x * 0.3;
      out.push({ type: "stanchion", side, speed: 1, pos: { ...b.pos } });
    }
  }

  // --- rim torus: closest point on the rim circle
  const dx = b.pos.x - rim.x,
    dz = b.pos.z - rim.z;
  const horiz = Math.hypot(dx, dz) || 1e-6;
  const cx = rim.x + (dx / horiz) * c.rimRadius;
  const cz = rim.z + (dz / horiz) * c.rimRadius;
  const d = v3(b.pos.x - cx, b.pos.y - rim.y, b.pos.z - cz);
  const dl = len3(d);
  const minD = R + RIM_TUBE;
  if (dl < minD && dl > 1e-6) {
    const n = scale3(d, 1 / dl);
    b.pos = add3(b.pos, scale3(n, minD - dl));
    const vn = dot3(b.vel, n);
    if (vn < 0) {
      const vt = sub3(b.vel, scale3(n, vn));
      b.vel = add3(scale3(vt, 0.82), scale3(n, -vn * RESTITUTION_RIM));
      b.spin = add3(scale3(b.spin, 0.5), scale3(cross3(n, vt), 1.5));
      b.touchedRim = true;
      out.push({ type: "rim", side, speed: -vn, pos: { ...b.pos } });
    }
  }
  // the rim-to-board connector (back of the rim) is implicitly covered by the torus

  // --- make detection: center crosses the rim plane downward inside the ring
  if (b.pos.y > rim.y + 0.02) b.aboveRim[key] = true;
  if (prevY >= rim.y && b.pos.y < rim.y && b.vel.y < 0 && b.aboveRim[key]) {
    if (horiz < c.rimRadius - R * 0.35) {
      out.push({ type: "score", side, speed: -b.vel.y, pos: { ...b.pos } });
    }
    b.aboveRim[key] = false;
  }
  // --- net: damp horizontal motion and pull toward center while inside
  if (b.pos.y < rim.y && b.pos.y > rim.y - NET_DEPTH && horiz < c.rimRadius + 0.02) {
    if (b.inNet === 0) out.push({ type: "net", side, speed: -b.vel.y, pos: { ...b.pos } });
    b.inNet += 1 / 480;
    b.vel.x = b.vel.x * 0.985 - dx * 0.6 * (1 / 480) * 60;
    b.vel.z = b.vel.z * 0.985 - dz * 0.6 * (1 / 480) * 60;
    if (b.vel.y < -1.5) b.vel.y *= 0.993;
    // keep inside the net cone
    const maxR = c.rimRadius * (1 - 0.35 * ((rim.y - b.pos.y) / NET_DEPTH)) - R * 0.5;
    if (horiz > maxR && maxR > 0) {
      b.pos.x = rim.x + (dx / horiz) * maxR;
      b.pos.z = rim.z + (dz / horiz) * maxR;
    }
  } else if (b.pos.y < rim.y - NET_DEPTH || horiz > c.rimRadius + 0.1) {
    if (b.inNet > 0 && b.pos.y < rim.y - NET_DEPTH) b.inNet = 0;
  }
}

/**
 * Solve launch velocity to travel from p0 to target with apex height `apex` above the higher point.
 * Returns velocity and time of flight.
 */
export function solveArc(p0: V3, target: V3, apexAbove: number): { vel: V3; t: number } {
  const apexY = Math.max(p0.y, target.y) + apexAbove;
  const up = Math.sqrt(2 * GRAVITY * Math.max(0.01, apexY - p0.y));
  const t1 = up / GRAVITY;
  const t2 = Math.sqrt((2 * Math.max(0.0001, apexY - target.y)) / GRAVITY);
  const t = t1 + t2;
  return { vel: v3((target.x - p0.x) / t, up, (target.z - p0.z) / t), t };
}

/** Launch velocity for a given angle (radians above horizontal) to hit target. */
export function solveAngle(p0: V3, target: V3, angle: number): { vel: V3; t: number } | null {
  const dx = target.x - p0.x,
    dz = target.z - p0.z;
  const dh = Math.hypot(dx, dz);
  const dy = target.y - p0.y;
  const cos = Math.cos(angle),
    tan = Math.tan(angle);
  const denom = 2 * cos * cos * (dh * tan - dy);
  if (denom <= 0) return null;
  const v = Math.sqrt((GRAVITY * dh * dh) / denom);
  const vh = v * cos;
  const t = dh / vh;
  return { vel: v3((dx / dh) * vh, v * Math.sin(angle), (dz / dh) * vh), t };
}

/**
 * Numerically find the launch velocity at `angle` (rad) whose free flight (same drag,
 * gravity and spin model as stepBall, no collisions) passes through `target`
 * while descending. Returns null if unreachable.
 */
export function aimAt(p0: V3, target: V3, angle: number, spin: V3 = v3()): { vel: V3; t: number } | null {
  const dx = target.x - p0.x,
    dz = target.z - p0.z;
  const dh = Math.hypot(dx, dz);
  if (dh < 0.05) return { vel: v3(0, 3, 0), t: 0.6 };
  const ux = dx / dh,
    uz = dz / dh;
  const heightAt = (v: number): { y: number; t: number; desc: boolean } | null => {
    let px = 0,
      py = p0.y,
      vx = v * Math.cos(angle),
      vy = v * Math.sin(angle);
    let sp = { ...spin };
    const h = 1 / 480;
    for (let t = 0; t < 4; t += h) {
      const s = Math.hypot(vx, vy);
      const drag = DRAG * s;
      vx -= vx * drag * h;
      vy -= vy * drag * h + GRAVITY * h;
      // Magnus in the shot plane (spin about the horizontal axis perpendicular to travel)
      const spinPerp = -sp.x * uz + sp.z * ux;
      vx += -spinPerp * vy * 0.00045 * h;
      vy += spinPerp * vx * 0.00045 * h;
      sp = scale3(sp, 1 - 0.2 * h);
      const npx = px + vx * h;
      if (npx >= dh) {
        const f = (dh - px) / (npx - px);
        return { y: py + vy * h * f, t: t + h * f, desc: vy < 0 };
      }
      px = npx;
      py += vy * h;
      if (py < -1) return null;
    }
    return null;
  };
  let lo = 1,
    hi = 30;
  let best: { v: number; t: number } | null = null;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const r = heightAt(mid);
    if (!r || r.y < target.y) lo = mid;
    else {
      hi = mid;
      best = { v: mid, t: r.t };
    }
  }
  if (!best) return null;
  const v = best.v;
  return { vel: v3(ux * v * Math.cos(angle), v * Math.sin(angle), uz * v * Math.cos(angle)), t: best.t };
}

/** Launch velocity reaching `target` after exactly `t` seconds (ignores drag; passes are short). */
export function solveTime(p0: V3, target: V3, t: number): V3 {
  const tt = Math.max(0.08, t);
  return v3((target.x - p0.x) / tt, (target.y - p0.y + 0.5 * GRAVITY * tt * tt) / tt, (target.z - p0.z) / tt);
}
