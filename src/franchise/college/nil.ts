// NIL: each program's yearly budget for name, image and likeness deals. Deals last a season. Money promised to
// recruits, transfers and returning players comes out of next season's budget.
import { playerOvr } from "@/engine/player";
import type { CollegeDivision, Player, Team } from "@/engine/types";
import type { Franchise, NilBook } from "../types";
import { NIL_DIVISION, recruitNilAsk } from "./recruiting";

const NIL_BASE = 400_000;
const NIL_PRESTIGE = 9_600_000;
/** Overalls a returning player needs to ask like a 5-, 4- or 3-star recruit, by division. */
const STAR_OVERALLS: Record<CollegeDivision, [number, number, number]> = { D1: [76, 70, 62], D2: [66, 60, 54], D3: [61, 55, 49] };

export const nilBudget = (team: Team, division: CollegeDivision) => Math.round((NIL_BASE + team.prestige ** 2 * NIL_PRESTIGE) * NIL_DIVISION[division]);

/** What a player expects for a season. Recruits go by their stars, everyone else by how good he is. */
export function nilAsk(p: Player, division: CollegeDivision, stars?: number): number {
  if (stars) return recruitNilAsk(stars, division);
  const ovr = playerOvr(p);
  const [five, four, three] = STAR_OVERALLS[division];
  return recruitNilAsk(ovr >= five ? 5 : ovr >= four ? 4 : ovr >= three ? 3 : 2, division);
}

export const newBook = (team: Team, division: CollegeDivision): NilBook => ({
  now: { budget: nilBudget(team, division), deals: {} },
  next: { budget: nilBudget(team, division), deals: {} },
});

const book = (f: Franchise, teamId: string): NilBook => f.college!.nil[teamId] ?? { now: { budget: 0, deals: {} }, next: { budget: 0, deals: {} } };
const sum = (deals: Record<string, number>) => Object.values(deals).reduce((a, b) => a + b, 0);

/** Next season's money still free. */
export const nilRoom = (f: Franchise, teamId: string) => book(f, teamId).next.budget - sum(book(f, teamId).next.deals);

/** Sets what a team promises a player for next season, replacing any earlier promise. */
export function promiseNil(f: Franchise, teamId: string, playerId: string, amount: number): Franchise | { error: string } {
  const b = book(f, teamId);
  const was = b.next.deals[playerId] ?? 0;
  const value = Math.max(0, Math.round(amount));
  if (value - was > nilRoom(f, teamId)) return { error: "That's more NIL than you have left for next season." };
  const deals = { ...b.next.deals };
  if (value > 0) deals[playerId] = value;
  else delete deals[playerId];
  return { ...f, college: { ...f.college!, nil: { ...f.college!.nil, [teamId]: { ...b, next: { ...b.next, deals } } } } };
}

/** Drops a team's promise to a player, as when an offer is pulled or he goes elsewhere. */
export function releaseNil(f: Franchise, teamId: string, playerId: string): Franchise {
  const b = f.college!.nil[teamId];
  if (!b || !(playerId in b.next.deals)) return f;
  const deals = { ...b.next.deals };
  delete deals[playerId];
  return { ...f, college: { ...f.college!, nil: { ...f.college!.nil, [teamId]: { ...b, next: { ...b.next, deals } } } } };
}

/** The user's promise to a player on the roster, to keep him from leaving. */
export function retain(f: Franchise, playerId: string, amount: number): Franchise | { error: string } {
  if (!f.rosters[f.teamId].includes(playerId)) return { error: "He isn't on your roster." };
  return promiseNil(f, f.teamId, playerId, amount);
}

/** At camp, next season becomes this one. Promises to players who didn't end up on the roster lapse. */
export function rollNil(f: Franchise, teams: Team[]): Franchise {
  const c = f.college!;
  const nil = Object.fromEntries(
    teams.map((t) => {
      const b = book(f, t.id);
      const roster = new Set(f.rosters[t.id] ?? []);
      const deals = Object.fromEntries(Object.entries(b.next.deals).filter(([id]) => roster.has(id)));
      return [t.id, { now: { budget: b.next.budget, deals }, next: { budget: nilBudget(t, c.division), deals: {} } }];
    }),
  );
  return { ...f, college: { ...c, nil } };
}
