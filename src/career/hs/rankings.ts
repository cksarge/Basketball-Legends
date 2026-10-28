// Recruiting rankings for your class: scouts project your senior-year overall, then add production
// and exposure from camps and showcases. The score maps to a national rank, an Arizona rank and stars.
import { playerOvr } from "@/engine/player";
import { clamp } from "@/engine/rng";
import type { Career, HsSeason, IsoDate, RecruitRanking } from "../types";
import { averages } from "./season";

/** Overall a typical prospect gains per remaining high school year. */
export const YEARLY_GAIN = 7;
const C0 = 84;
const SPREAD = 3;
export const RANKED_DEPTH = 2500;
export const MAX_EXPOSURE = 4;

/** National rank for a scouting score (lower is better), or null beyond the ranked depth. */
export function nationalRank(score: number): number | null {
  const r = Math.max(1, Math.round(Math.exp((C0 - score) / SPREAD)));
  return r > RANKED_DEPTH ? null : r;
}

export function starsFor(rank: number | null) {
  if (rank === null) return 0;
  return rank <= 32 ? 5 : rank <= 300 ? 4 : rank <= 1200 ? 3 : 2;
}

/** Arizona produces roughly 2% of the country's ranked prospects. */
export const stateRank = (national: number | null) => (national === null ? null : Math.max(1, Math.round(national * 0.022 + 0.4)));

/** Points for what you did on varsity (0..5): scoring, all-around play and minutes. */
export function productionBonus(s: HsSeason | undefined) {
  const a = averages(s?.stats.varsity);
  if (!a || a.gp < 5) return 0;
  return clamp(a.ppg / 6 + (a.rpg + a.apg) / 8 + a.mpg / 30, 0, 5);
}

export function rankCareer(c: Career, date: IsoDate, extraExposure = 0): RecruitRanking {
  const seasons = c.hs.seasons;
  const s = seasons[seasons.length - 1];
  const grade = s?.grade ?? 9;
  // after the season ends you've used up that year
  const done = !!s?.awards.length || !!s?.regionTable;
  const yearsLeft = Math.max(0, 12 - grade + (done ? 0 : 1) - 1);
  const projected = playerOvr(c.player) + yearsLeft * YEARLY_GAIN;
  const best = Math.max(0, ...seasons.map(productionBonus));
  // exposure carries over from last year, fading as coaches look for fresh evaluations
  const carried = s?.ranking?.exposure ?? (seasons[seasons.length - 2]?.ranking?.exposure ?? 0) * 0.6;
  const exposure = clamp(carried + extraExposure, 0, MAX_EXPOSURE);
  const score = Math.round((projected + best + exposure) * 10) / 10;
  const national = nationalRank(score);
  return { date, stars: starsFor(national), national, state: stateRank(national), score, exposure };
}

export function rankingText(r: RecruitRanking | undefined) {
  if (!r) return "Not yet rated";
  if (!r.national) return "Not rated yet: scouts need to see more";
  return `${"★".repeat(r.stars)}${"☆".repeat(5 - r.stars)} · #${r.national} nationally · #${r.state} in Arizona`;
}
