// Running a school's program: what the athletic director or principal expects, and what the staff can cost.
import type { LeagueId, Team } from "@/engine/types";
import type { Franchise, OwnerGoal, StaffMember } from "../types";

/** Staff pay by league, against pro salaries. */
export const STAFF_PAY: Record<LeagueId, number> = { pro: 1, college: 0.25, hs: 0.01 };
const COLLEGE_STAFF = { base: 600_000, prestige: 2_400_000 };
const DIVISION_STAFF: Record<string, number> = { D1: 1, D2: 0.25, D3: 0.1 };
const HS_STAFF = { base: 20_000, prestige: 40_000 };
const WIN_FLOOR = 0.3;
const WIN_SPREAD = 0.45;
const BEST_CLASS = 10;
const CLASS_SPREAD = 0.85;

/** What a school can spend on its staff in a year. Pro clubs pay from their books instead. */
export function staffBudget(team: Team, league: LeagueId): number {
  if (league === "college") return Math.round((COLLEGE_STAFF.base + team.prestige * COLLEGE_STAFF.prestige) * (DIVISION_STAFF[team.tier ?? "D1"] ?? 1));
  if (league === "hs") return Math.round(HS_STAFF.base + team.prestige * HS_STAFF.prestige);
  return Infinity;
}

/** Hires someone, if the school can pay him alongside the rest of the staff. */
export function tryHireStaff(f: Franchise, who: StaffMember, team: Team): Franchise | { error: string } {
  const others = f.plan.staff.filter((s) => s.role !== who.role).reduce((sum, s) => sum + s.salary, 0);
  if (f.league !== "pro" && others + who.salary > staffBudget(team, f.league)) return { error: "That's more than your staff budget." };
  return { ...f, plan: { ...f.plan, staff: [...f.plan.staff.filter((s) => s.role !== who.role), who] } };
}

/** How far a program went: -1 nowhere, 0 its conference tournament, 1 the national tournament, 2 its second weekend, 3 the final four. */
export function postseasonReached(f: Franchise, teamId: string): number {
  const games = f.season.games.filter((g) => g.kind === "playoff" && (g.homeId === teamId || g.awayId === teamId));
  const national = games.filter((g) => /National Tournament/.test(g.label ?? ""));
  if (national.some((g) => /National Semifinal|Championship/.test(g.label ?? ""))) return 3;
  if (national.some((g) => /Regional/.test(g.label ?? ""))) return 2;
  if (f.season.brackets.find((b) => b.id === "national")?.seeds.includes(teamId)) return 1;
  if (f.season.brackets.some((b) => b.id.startsWith("conf-") && b.seeds.includes(teamId))) return 0;
  return -1;
}

/** 0 for the least prestigious program in the world, 1 for the most. */
function standing(f: Franchise, teams: Team[]) {
  const order = [...teams].sort((a, b) => b.prestige - a.prestige || a.id.localeCompare(b.id));
  return 1 - order.findIndex((t) => t.id === f.teamId) / Math.max(1, order.length - 1);
}

const scheduled = (f: Franchise) => f.season.games.filter((g) => g.kind !== "playoff" && (g.homeId === f.teamId || g.awayId === f.teamId)).length;

/** The athletic director wants wins, a deep run and a good class, more of each at a bigger program. */
export function adGoals(f: Franchise, teams: Team[]): OwnerGoal[] {
  const p = standing(f, teams);
  const n = teams.length;
  return [
    { key: "winning", target: Math.round((WIN_FLOOR + p * WIN_SPREAD) * scheduled(f)) },
    { key: "postseason", target: p >= 0.9 ? 2 : p >= 0.7 ? 1 : 0 },
    { key: "recruiting", target: Math.min(n, Math.round(BEST_CLASS + (1 - p) * (n - BEST_CLASS) * CLASS_SPREAD)) },
  ];
}
