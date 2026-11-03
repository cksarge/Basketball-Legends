// The Hall of Fame: a career's numbers, honors and titles, judged at retirement.
import type { LeagueId } from "@/engine/types";
import type { Franchise, HallEntry, RetiredPlayer } from "../types";

/** Careers are shorter below the pros, so the bar is lower. */
export const HALL_BARS: Record<LeagueId, number> = { pro: 75, college: 30, hs: 25 };
export const HALL_BAR = HALL_BARS.pro;
const POINTS = 400;
const REBOUNDS_ASSISTS = 800;
const PER_AWARD = 3;
const PER_TITLE = 6;

export function hallScore(r: RetiredPlayer): number {
  if (!r.career) return 0;
  return r.career.pts / POINTS + (r.career.reb + r.career.ast) / REBOUNDS_ASSISTS + (r.awards ?? 0) * PER_AWARD + (r.titles ?? 0) * PER_TITLE;
}

export function induct(f: Franchise, r: RetiredPlayer): Franchise {
  const score = hallScore(r);
  if (!r.career || score < HALL_BARS[f.league]) return f;
  const entry: HallEntry = {
    id: r.id,
    name: r.name,
    pos: r.pos,
    year: r.year,
    score: Math.round(score),
    career: r.career,
    awards: r.awards ?? 0,
    titles: r.titles ?? 0,
    lastTeamId: r.lastTeamId,
  };
  return { ...f, hall: [...f.hall, entry] };
}
