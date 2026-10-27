// Court geometry in meters. Origin at center court, +X toward the right basket,
// +Z toward the near (camera/bench) sideline, +Y up.
import { LEAGUE_RULES, type LeagueId } from "@/engine/types";

export const FT = 0.3048;

export interface CourtSpec {
  league: LeagueId;
  length: number;
  width: number;
  halfL: number;
  halfW: number;
  /** Distance from baseline to rim center. */
  rimFromBaseline: number;
  rimHeight: number;
  rimRadius: number;
  ballRadius: number;
  boardFromBaseline: number;
  boardWidth: number;
  boardHeight: number;
  boardBottom: number;
  threeRadius: number;
  cornerThree: number;
  /** |z| at which the arc meets the straight corner line. */
  cornerZ: number;
  /** Distance from rim center where corner lines end (along x). */
  cornerLineLen: number;
  laneWidth: number;
  laneLength: number; // baseline to FT line
  ftLineFromBaseline: number;
  restrictedRadius: number;
  centerCircle: number;
}

export function courtFor(league: LeagueId): CourtSpec {
  const r = LEAGUE_RULES[league];
  const length = (league === "hs" ? 84 : 94) * FT;
  const width = 50 * FT;
  const threeRadius = r.threePointFt * FT;
  const cornerThree = r.cornerThreeFt * FT;
  const cornerZ = Math.min(cornerThree, threeRadius);
  const rimFromBaseline = 5.25 * FT;
  // where the arc (radius R) crosses |z| = cornerZ
  const cornerLineLen = Math.sqrt(Math.max(0, threeRadius * threeRadius - cornerZ * cornerZ));
  return {
    league,
    length,
    width,
    halfL: length / 2,
    halfW: width / 2,
    rimFromBaseline,
    rimHeight: 10 * FT,
    rimRadius: 0.2286,
    ballRadius: league === "pro" || league === "college" ? 0.1194 : 0.1194,
    boardFromBaseline: 4 * FT,
    boardWidth: 6 * FT,
    boardHeight: 3.5 * FT,
    boardBottom: 2.9, // bottom edge of the glass
    threeRadius,
    cornerThree,
    cornerZ,
    cornerLineLen,
    laneWidth: (league === "pro" ? 16 : 12) * FT,
    laneLength: 19 * FT,
    ftLineFromBaseline: 19 * FT,
    restrictedRadius: 4 * FT,
    centerCircle: 6 * FT,
  };
}

/** Basket position for side: +1 = right basket (x > 0), -1 = left. */
export function rimPos(c: CourtSpec, side: 1 | -1) {
  return { x: side * (c.halfL - c.rimFromBaseline), y: c.rimHeight, z: 0 };
}

export function boardX(c: CourtSpec, side: 1 | -1) {
  return side * (c.halfL - c.boardFromBaseline);
}

/** Is the floor point (x, z) a three-point location when attacking `side`? */
export function isThree(c: CourtSpec, side: 1 | -1, x: number, z: number): boolean {
  const rx = side * (c.halfL - c.rimFromBaseline);
  const dx = (x - rx) * -side; // distance out from rim toward half court (>0 = in front of rim)
  if (Math.abs(z) >= c.cornerZ && dx <= c.cornerLineLen) return true;
  return Math.hypot(x - rx, z) > c.threeRadius;
}

export function distToRim(c: CourtSpec, side: 1 | -1, x: number, z: number) {
  const r = rimPos(c, side);
  return Math.hypot(x - r.x, z - r.z);
}

export function inBounds(c: CourtSpec, x: number, z: number, margin = 0) {
  return Math.abs(x) <= c.halfL - margin && Math.abs(z) <= c.halfW - margin;
}

/** Is point inside the painted lane on `side`? */
export function inLane(c: CourtSpec, side: 1 | -1, x: number, z: number) {
  const base = side * c.halfL;
  const ft = side * (c.halfL - c.laneLength);
  const lo = Math.min(base, ft), hi = Math.max(base, ft);
  return x >= lo && x <= hi && Math.abs(z) <= c.laneWidth / 2;
}

export function ftSpot(c: CourtSpec, side: 1 | -1) {
  return { x: side * (c.halfL - c.ftLineFromBaseline), z: 0 };
}

/** Chairs per team bench. */
export const BENCH_SEATS = 9;

/**
 * Team benches line the far sideline (opposite the broadcast camera), facing the court:
 * home (team 0) toward +x, away toward -x. Seat 0 is nearest midcourt.
 */
export function benchSeat(c: CourtSpec, team: 0 | 1, i: number) {
  const s = team === 0 ? 1 : -1;
  return { x: s * (Math.min(6.5, c.halfL * 0.5) + i * 0.65), z: -(c.halfW + 1.6) };
}

/** Where the five players stand during a timeout huddle (a half ring in front of the bench). */
export function huddleSpot(c: CourtSpec, team: 0 | 1, i: number) {
  const s = team === 0 ? 1 : -1;
  const cx = s * (Math.min(6.5, c.halfL * 0.5) + 2.6), cz = -(c.halfW + 0.2);
  const a = (i - 2) * 0.62; // fan out on the court side of the center
  return { x: cx + Math.sin(a) * 1.15, z: cz + Math.cos(a) * 1.15, cx, cz };
}
