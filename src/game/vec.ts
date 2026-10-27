// Tiny allocation-light vector helpers for the simulation (no three.js dependency,
// so the sim can run in workers and on a future authoritative host).

export interface V3 {
  x: number;
  y: number;
  z: number;
}
export interface V2 {
  x: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const copy3 = (a: V3): V3 => ({ x: a.x, y: a.y, z: a.z });
export const set3 = (o: V3, x: number, y: number, z: number) => {
  o.x = x;
  o.y = y;
  o.z = z;
  return o;
};
export const add3 = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub3 = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale3 = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot3 = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const len3 = (a: V3) => Math.hypot(a.x, a.y, a.z);
export const dist3 = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const norm3 = (a: V3): V3 => {
  const l = len3(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
export const lerp3 = (a: V3, b: V3, t: number): V3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
export const cross3 = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

export const v2 = (x = 0, z = 0): V2 => ({ x, z });
export const dist2 = (a: V2, b: V2) => Math.hypot(a.x - b.x, a.z - b.z);
export const len2 = (x: number, z: number) => Math.hypot(x, z);
export const angleTo = (from: V2, to: V2) => Math.atan2(to.x - from.x, to.z - from.z);
/** Smallest signed difference between angles a and b (radians). */
export const angDiff = (a: number, b: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
export const approach = (cur: number, target: number, maxStep: number) => (cur < target ? Math.min(target, cur + maxStep) : Math.max(target, cur - maxStep));
export const damp = (cur: number, target: number, lambda: number, dt: number) => target + (cur - target) * Math.exp(-lambda * dt);

/** Closest point on segment ab to p (2D on the floor). Returns t in [0,1]. */
export function segT2(a: V2, b: V2, p: V2) {
  const dx = b.x - a.x,
    dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1;
  return Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
}
export function distToSeg2(a: V2, b: V2, p: V2) {
  const t = segT2(a, b, p);
  return Math.hypot(a.x + (b.x - a.x) * t - p.x, a.z + (b.z - a.z) * t - p.z);
}
