// Fast score model for games your player isn't in, plus standings and power rankings.
// Constants are fitted to the real-time engine (scripts/dev runs of full high school games):
// margin = 2.2 home + 1.25 x strength gap, residual sd 12.4, about 100 combined points.
import { Rng } from "@/engine/rng";
import type { GameResult, ScheduledGame } from "../types";

export const HOME_EDGE = 2.2;
export const MARGIN_PER_POINT = 1.25;
export const MARGIN_SD = 12.4;
export const TOTAL_MEAN = 100;
export const TOTAL_SD = 9;

/** Probability the home team wins, for a strength gap (home minus away). */
export function homeWinProb(gap: number, neutral = false) {
  const mean = (neutral ? 0 : HOME_EDGE) + MARGIN_PER_POINT * gap;
  // normal CDF via the error function approximation
  const z = mean / (MARGIN_SD * Math.SQRT2);
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + (z >= 0 ? erf : -erf));
}

export function simScore(homeStrength: number, awayStrength: number, rng: Rng, neutral = false): GameResult {
  const margin = Math.round((neutral ? 0 : HOME_EDGE) + MARGIN_PER_POINT * (homeStrength - awayStrength) + rng.normal(0, MARGIN_SD));
  const total = Math.max(50, Math.round(TOTAL_MEAN + (homeStrength + awayStrength - 100) * 0.4 + rng.normal(0, TOTAL_SD)));
  let home = Math.round((total + margin) / 2);
  let away = Math.max(18, total - home);
  home = Math.max(18, home);
  let overtimes = 0;
  while (home === away) {
    overtimes++;
    home += rng.int(4, 12) + (homeStrength > awayStrength ? 1 : 0);
    away += rng.int(4, 12);
  }
  return { home, away, played: false, overtimes };
}

export interface Standing {
  teamId: string;
  w: number;
  l: number;
  rw: number;
  rl: number;
  pf: number;
  pa: number;
  streak: number; // +3 = won three, -2 = lost two
  last10: string;
}

export function standings(games: ScheduledGame[], teamIds: string[]): Map<string, Standing> {
  const table = new Map<string, Standing>(teamIds.map((id) => [id, { teamId: id, w: 0, l: 0, rw: 0, rl: 0, pf: 0, pa: 0, streak: 0, last10: "" }]));
  const results = new Map<string, ("W" | "L")[]>();
  for (const g of games) {
    if (!g.result || g.kind === "scrimmage") continue;
    const homeWon = g.result.home > g.result.away;
    for (const [id, won, pf, pa] of [
      [g.homeId, homeWon, g.result.home, g.result.away],
      [g.awayId, !homeWon, g.result.away, g.result.home],
    ] as const) {
      const s = table.get(id);
      if (!s) continue;
      if (won) s.w++;
      else s.l++;
      if (g.kind === "region") {
        if (won) s.rw++;
        else s.rl++;
      }
      s.pf += pf;
      s.pa += pa;
      results.set(id, [...(results.get(id) ?? []), won ? "W" : "L"]);
    }
  }
  for (const [id, rs] of results) {
    const s = table.get(id)!;
    let k = rs.length - 1;
    const last = rs[k];
    while (k >= 0 && rs[k] === last) k--;
    s.streak = (rs.length - 1 - k) * (last === "W" ? 1 : -1);
    const tail = rs.slice(-10);
    s.last10 = `${tail.filter((r) => r === "W").length}-${tail.filter((r) => r === "L").length}`;
  }
  return table;
}

export const winPct = (s: Standing) => (s.w + s.l ? s.w / (s.w + s.l) : 0);

/**
 * Power rating in the spirit of the AIA's computer rankings: win percentage, opponents' win percentage,
 * and a capped margin term. Higher is better.
 */
export function powerRatings(games: ScheduledGame[], teamIds: string[]): Map<string, number> {
  const table = standings(games, teamIds);
  const opps = new Map<string, string[]>();
  const margin = new Map<string, number>();
  for (const g of games) {
    if (!g.result) continue;
    const d = Math.max(-20, Math.min(20, g.result.home - g.result.away));
    opps.set(g.homeId, [...(opps.get(g.homeId) ?? []), g.awayId]);
    opps.set(g.awayId, [...(opps.get(g.awayId) ?? []), g.homeId]);
    margin.set(g.homeId, (margin.get(g.homeId) ?? 0) + d);
    margin.set(g.awayId, (margin.get(g.awayId) ?? 0) - d);
  }
  const out = new Map<string, number>();
  for (const id of teamIds) {
    const s = table.get(id)!;
    const os = opps.get(id) ?? [];
    const owp = os.length ? os.reduce((a, o) => a + (table.get(o) ? winPct(table.get(o)!) : 0.5), 0) / os.length : 0.5;
    const gp = s.w + s.l;
    out.set(id, winPct(s) * 0.55 + owp * 0.35 + (gp ? (margin.get(id) ?? 0) / gp / 20 : 0) * 0.1);
  }
  return out;
}

/** Teams ordered best first by power rating (ties broken by wins, then point differential). */
export function ranked(games: ScheduledGame[], teamIds: string[]): string[] {
  const pr = powerRatings(games, teamIds);
  const st = standings(games, teamIds);
  return [...teamIds].sort(
    (a, b) => pr.get(b)! - pr.get(a)! || st.get(b)!.w - st.get(a)!.w || st.get(b)!.pf - st.get(b)!.pa - (st.get(a)!.pf - st.get(a)!.pa) || a.localeCompare(b),
  );
}
