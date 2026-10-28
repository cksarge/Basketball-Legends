// AIA-style state playoffs: an Open Division for the best 6A-4A teams, then a 16-team bracket per class
// (6A-3A) and 24-team brackets with a play-in round for 2A and 1A. Seeds come from the power rankings.
import type { Team } from "@/engine/types";
import { hsCalendar } from "../calendar";
import type { Bracket, ScheduledGame } from "../types";
import { ranked } from "./sim";

export const OPEN_CLASSES = ["6A", "5A", "4A"];
export const OPEN_SIZE = 16;
const PLAY_IN_CLASSES = ["2A", "1A"];
/** Bracket order for 16 seeds (1-based): 1v16, 8v9, 5v12, 4v13, 6v11, 3v14, 7v10, 2v15. */
const ORDER_16 = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15];

export const roundName = (teamsLeft: number) =>
  teamsLeft === 2 ? "State Championship" : teamsLeft === 4 ? "Semifinal" : teamsLeft === 8 ? "Quarterfinal" : "First round";

export function winnerOf(g: ScheduledGame): string | null {
  if (!g.result) return null;
  return g.result.home > g.result.away ? g.homeId : g.awayId;
}

/** Creates the brackets once every regular-season game in the classification has a result. */
export function createBrackets(teams: Team[], games: ScheduledGame[]): Bracket[] {
  const regular = games.filter((g) => g.kind !== "playoff");
  const brackets: Bracket[] = [];
  const open = ranked(
    regular,
    teams.filter((t) => OPEN_CLASSES.includes(t.tier!)).map((t) => t.id),
  ).slice(0, OPEN_SIZE);
  if (open.length === OPEN_SIZE) brackets.push({ id: "open", name: "Open Division", seeds: open, playIn: false, rounds: [] });
  const inOpen = new Set(open);
  for (const cls of ["6A", "5A", "4A", "3A", "2A", "1A"]) {
    const ids = teams.filter((t) => t.tier === cls && !inOpen.has(t.id)).map((t) => t.id);
    if (ids.length < 2) continue;
    const playIn = PLAY_IN_CLASSES.includes(cls) && ids.length >= 24;
    const size = playIn ? 24 : Math.min(16, 2 ** Math.floor(Math.log2(ids.length)));
    brackets.push({ id: cls.toLowerCase(), name: `${cls} State`, seeds: ranked(regular, ids).slice(0, size), playIn, rounds: [] });
  }
  return brackets;
}

/** Pairs a list of slots (seed order positions) into bracket games; the better seed hosts. */
function pairUp(slots: string[], seeds: string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i < slots.length; i += 2) {
    const [a, b] = [slots[i], slots[i + 1]];
    pairs.push(seeds.indexOf(a) <= seeds.indexOf(b) ? [a, b] : [b, a]);
  }
  return pairs;
}

/**
 * Creates the next round of a bracket when the current one is finished (or the first round when none exists).
 * Returns the new games; the bracket is updated in place with their ids (and its champion at the end).
 */
export function advanceBracket(b: Bracket, gamesById: Map<string, ScheduledGame>, year: number): ScheduledGame[] {
  if (b.champion) return [];
  const cal = hsCalendar(year);
  const make = (pairs: [string, string][], date: string, label: string, neutral = false): ScheduledGame[] => {
    const games = pairs.map(([h, a], i) => ({
      id: `${b.id}-${year}-r${b.rounds.length}-${i}`,
      date,
      level: "varsity" as const,
      homeId: h,
      awayId: a,
      kind: "playoff" as const,
      label: `${b.name} ${label}`,
      ...(neutral ? { neutral: true } : {}),
    }));
    b.rounds.push(games.map((g) => g.id));
    return games;
  };
  const mainRounds = b.rounds.length - (b.playIn ? 1 : 0); // rounds of the 16-team (or smaller) bracket so far
  const size16 = Math.min(16, b.playIn ? 16 : b.seeds.length);
  const order = ORDER_16.filter((s) => s <= size16);
  if (b.rounds.length === 0) {
    if (b.playIn) {
      // seeds 9-24: 9 v 24, 10 v 23 … 16 v 17
      const pairs: [string, string][] = Array.from({ length: 8 }, (_, i) => [b.seeds[8 + i], b.seeds[23 - i]]);
      return make(pairs, cal.playIn, "play-in");
    }
    const slots = order.map((s) => b.seeds[s - 1]);
    return make(pairUp(slots, b.seeds), cal.playoffRounds[0], roundName(size16));
  }
  const last = b.rounds[b.rounds.length - 1].map((id) => gamesById.get(id)!);
  if (last.some((g) => !g?.result)) return [];
  const winners = last.map((g) => winnerOf(g)!);
  if (b.playIn && b.rounds.length === 1) {
    // play-in winners take seeds 9-16
    const field = [...b.seeds.slice(0, 8), ...winners];
    const slots = ORDER_16.map((s) => field[s - 1]);
    return make(pairUp(slots, b.seeds), cal.playoffRounds[0], roundName(16));
  }
  if (winners.length === 1) {
    b.champion = winners[0];
    return [];
  }
  const left = winners.length;
  const date = cal.playoffRounds[Math.min(cal.playoffRounds.length - 1, mainRounds + (4 - Math.log2(size16)))];
  return make(pairUp(winners, b.seeds), date, roundName(left), left === 2);
}

/** The bracket a team is in, if any. */
export const bracketFor = (brackets: Bracket[] | undefined, teamId: string) => brackets?.find((b) => b.seeds.includes(teamId));
