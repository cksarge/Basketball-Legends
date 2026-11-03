// What the owner expects, how the year measured up, and how long the patience lasts.
import { playerOvr } from "@/engine/player";
import { clamp } from "@/engine/rng";
import type { Team } from "@/engine/types";
import { leagueModule } from "../leagues";
import { START_CAP } from "../pro/rules";
import { teamSlot } from "../pro/tradeValue";
import type { Franchise, Grade, OwnerGoal, OwnerReview } from "../types";

const YOUNG_AGE = 25;
const YOUNG_FLOOR = 60;
const DEVELOPMENT_STEP = 2;
const FULL_SEASON = 82;
const LOWEST_SHARE = 0.3;
const SHARE_SPREAD = 0.4;
const PROFIT_PRESTIGE = 30_000_000;
const WEIGHTS: Partial<Record<OwnerGoal["key"], number>> = { winning: 0.6, profit: 0.2, development: 0.2 };
const POINTS: Record<Grade, number> = { A: 12, B: 6, C: 0, D: -10, F: -20 };
const TITLE_BONUS = 15;
/** Margins over a goal for A, B, C and D. */
const BANDS: Record<OwnerGoal["key"], number[]> = {
  winning: [6, 2, -3, -8],
  profit: [20e6, 0, -15e6, -40e6],
  development: [6, 0, -4, -10],
  postseason: [1, 0, -1, -2],
  // a class rank, where lower is better, so the margin is the goal minus the rank
  recruiting: [15, 0, -20, -45],
};

const youngCore = (f: Franchise) =>
  f.rosters[f.teamId].reduce((sum, id) => {
    const p = f.players[id];
    return sum + (p.age <= YOUNG_AGE ? Math.max(0, playerOvr(p) - YOUNG_FLOOR) : 0);
  }, 0);

const wins = (f: Franchise) =>
  f.season.games.filter((g) => g.result && g.kind === "region" && (g.result.home > g.result.away ? g.homeId : g.awayId) === f.teamId).length;

/** What the coach's boss wants from the season ahead. */
export const seasonGoals = (f: Franchise, teams: Team[]): OwnerGoal[] => leagueModule(f.league).goals(f, teams);

/** What the owner wants from the season ahead, from how good the roster is. */
export function proGoals(f: Franchise, teams: Team[]): OwnerGoal[] {
  const rank = (teamSlot(f, f.teamId) - 1) / Math.max(1, teams.length - 1);
  const prestige = teams.find((t) => t.id === f.teamId)?.prestige ?? 0.5;
  return [
    { key: "winning", target: Math.round((LOWEST_SHARE + rank * SHARE_SPREAD) * f.settings.league.gamesPerSeason) },
    { key: "profit", target: Math.round((prestige - 0.5) * PROFIT_PRESTIGE * (f.cap.salaryCap / START_CAP)) },
    { key: "development", target: youngCore(f) + DEVELOPMENT_STEP },
  ];
}

function grade(key: OwnerGoal["key"], margin: number, scale: number): Grade {
  const i = BANDS[key].findIndex((band) => margin >= band * scale);
  return (["A", "B", "C", "D"] as const)[i] ?? "F";
}

export function ownerReview(f: Franchise): OwnerReview {
  const year = f.season.year;
  const goal = (key: OwnerGoal["key"]) => f.job.goals.find((g) => g.key === key);
  const games = f.settings.league.gamesPerSeason / FULL_SEASON;
  const money = f.cap.salaryCap / START_CAP;
  const result = (key: OwnerGoal["key"], actual: number, scale: number): Grade => {
    const g = goal(key);
    return g ? grade(key, actual - g.target, scale) : "C";
  };
  const grades: Record<"winning" | "profit" | "development", Grade> = {
    winning: result("winning", wins(f), games),
    profit: result("profit", f.finance[f.teamId].lastSeason?.profit ?? 0, money),
    development: result("development", youngCore(f), 1),
  };
  const title = f.season.championId === f.teamId ? TITLE_BONUS : 0;
  const change = Math.round((Object.keys(grades) as (keyof typeof grades)[]).reduce((sum, k) => sum + POINTS[grades[k]] * (WEIGHTS[k] ?? 0), 0)) + title;
  const note =
    change > 5
      ? "The owner is thrilled."
      : change >= 0
        ? "The owner is satisfied."
        : change > -10
          ? "The owner is concerned."
          : "The owner is out of patience.";
  return { year, grades, change, note };
}

export function applyReview(f: Franchise, r: OwnerReview): Franchise {
  const security = clamp(f.job.security + r.change, 0, 100);
  const title = f.season.championId === f.teamId ? 1 : 0;
  const w = wins(f);
  const l = f.season.games.filter((g) => g.result && g.kind === "region" && (g.homeId === f.teamId || g.awayId === f.teamId)).length - w;
  const stints = f.job.stints.map((s, i, all) => (i === all.length - 1 ? { ...s, w: s.w + w, l: s.l + l, titles: s.titles + title } : s));
  const fired = security <= 0 && f.job.seasons >= 1 ? { year: r.year, teamId: f.teamId } : undefined;
  return { ...f, job: { ...f.job, security, seasons: f.job.seasons + 1, stints, reviews: [...f.job.reviews, r], ...(fired ? { fired } : {}) } };
}
