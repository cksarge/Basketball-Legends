// The coaching staff: who's available, who's hired, and what a role's rating is worth.
import { FIRST_NAMES, LAST_NAMES } from "@/engine/names";
import { Rng } from "@/engine/rng";
import { STAFF_PAY } from "../club/program";
import type { Franchise, StaffMember, StaffRole } from "../types";

export const STAFF_ROLES: { role: StaffRole; label: string; hint: string }[] = [
  { role: "assistant", label: "Lead assistant", hint: "Helps your team in every game." },
  { role: "development", label: "Development coach", hint: "Players improve faster in practice." },
  { role: "scout", label: "Head scout", hint: "Sharper reads on draft prospects." },
  { role: "trainer", label: "Head trainer", hint: "Hurt players get back sooner." },
];
const POOL_SIZE = 6;
const EMPTY_ROLE = 50;
/** Make rate added at the top assistant rating. */
const MAX_COACH_EDGE = 0.004;
const TOP_RATING = 95;

/** Pro salaries round to $10K. Schools pay a share of that, rounded to $1K. */
function pay(rating: number, league: Franchise["league"]) {
  const pro = Math.round(((rating / 95) ** 3 * 3_000_000) / 10_000) * 10_000;
  return league === "pro" ? pro : Math.round((pro * STAFF_PAY[league]) / 1000) * 1000;
}

export function staffPool(f: Franchise, role: StaffRole): StaffMember[] {
  const rng = new Rng(`${f.seed}:staff:${role}:${f.season.year}`);
  return Array.from({ length: POOL_SIZE }, (_, i) => {
    const rating = rng.int(40, TOP_RATING);
    return {
      id: `${role}-${f.season.year}-${i}`,
      role,
      name: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`,
      rating,
      salary: pay(rating, f.league),
    };
  });
}

export function hireStaff(f: Franchise, who: StaffMember): Franchise {
  return { ...f, plan: { ...f.plan, staff: [...f.plan.staff.filter((s) => s.role !== who.role), who] } };
}

export const staffRating = (f: Franchise, role: StaffRole) => f.plan.staff.find((s) => s.role === role)?.rating ?? EMPTY_ROLE;

/** How long an injury lasts under this trainer: a rating of 90 takes off about a quarter. */
export const trainerGamesOut = (gamesOut: number, rating: number) => Math.max(1, Math.round(gamesOut * (1 - (rating - EMPTY_ROLE) / 160)));

/** What the assistant adds to the team's make rate. */
export const coachEdge = (f: Franchise) => (Math.max(0, staffRating(f, "assistant") - EMPTY_ROLE) / (TOP_RATING - EMPTY_ROLE)) * MAX_COACH_EDGE;
