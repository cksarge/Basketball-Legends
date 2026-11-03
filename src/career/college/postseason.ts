// College postseason: conference tournaments, then a 68-team national tournament (64 in Divisions II and III)
// and, in Division I, a 32-team invitational for the best teams that missed it.
import type { Team } from "@/engine/types";
import { collegeCalendar } from "../calendar";
import { winnerOf } from "../hs/playoffs";
import { ranked, standings } from "../hs/sim";
import type { Bracket, ScheduledGame } from "../types";

export const NATIONAL_ID = "national";
export const INVITATIONAL_ID = "invitational";
export const MAX_CONFERENCE_FIELD = 8;

/** Bracket positions for 2^k seeds, so the top seeds only meet late: [1, 8, 4, 5, 2, 7, 3, 6] for 8. */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2 + 1;
    order = order.flatMap((s) => [s, n - s]);
  }
  return order;
}

/** League play decides the seeds; each conference sends up to eight teams. */
export function conferenceBrackets(teams: Team[], games: ScheduledGame[], names: Map<string, { name: string; short?: string }> | undefined): Bracket[] {
  const groups = new Map<string, string[]>();
  for (const t of teams) groups.set(t.conferenceId, [...(groups.get(t.conferenceId) ?? []), t.id]);
  const out: Bracket[] = [];
  for (const [conf, ids] of groups) {
    if (ids.length < 2) continue;
    const table = standings(games, ids);
    const size = Math.min(MAX_CONFERENCE_FIELD, 2 ** Math.floor(Math.log2(ids.length)));
    const seeds = [...ids].sort(
      (a, b) => table.get(b)!.rw - table.get(b)!.rl - (table.get(a)!.rw - table.get(a)!.rl) || table.get(b)!.w - table.get(a)!.w || a.localeCompare(b),
    );
    out.push({ id: `conf-${conf}`, name: `${names?.get(conf)?.short ?? "Conference"} Tournament`, seeds: seeds.slice(0, size), playIn: false, rounds: [] });
  }
  return out;
}

const fieldSize = (tier: string) => (tier === "D1" ? 68 : 64);

/**
 * Selection Sunday: conference tournament winners get in automatically, the best remaining teams fill the field,
 * and Division I's last eight play opening-round games. The next 32 go to the invitational.
 */
export function selectFields(teams: Team[], games: ScheduledGame[], conference: Bracket[], fieldLimit = fieldSize(teams[0].tier!)): Bracket[] {
  const tier = teams[0].tier!;
  const label = tier === "D1" ? "National Tournament" : `Division ${tier === "D2" ? "II" : "III"} National Tournament`;
  const order = ranked(
    games.filter((g) => g.kind !== "playoff"),
    teams.map((t) => t.id),
  );
  const size = Math.min(fieldLimit, 2 ** Math.floor(Math.log2(teams.length)) + (fieldLimit === 68 ? 4 : 0));
  const auto = new Set(conference.map((b) => b.champion!));
  const field = new Set(auto);
  for (const id of order) {
    if (field.size >= size) break;
    field.add(id);
  }
  const seeds = order.filter((id) => field.has(id));
  const out: Bracket[] = [{ id: NATIONAL_ID, name: label, seeds, playIn: seeds.length === 68, rounds: [] }];
  if (tier === "D1")
    out.push({ id: INVITATIONAL_ID, name: "National Invitational", seeds: order.filter((id) => !field.has(id)).slice(0, 32), playIn: false, rounds: [] });
  return out;
}

export const nationalRound = (left: number) =>
  left === 2 ? "Championship" : left === 4 ? "National Semifinal" : left === 8 ? "Regional Final" : left === 16 ? "Regional Semifinal" : `Round of ${left}`;
const conferenceRound = (left: number) => (left === 2 ? "Final" : left === 4 ? "Semifinal" : "Quarterfinal");
const invitationalRound = (left: number) => (left === 2 ? "Final" : left === 4 ? "Semifinal" : left === 8 ? "Quarterfinal" : `Round of ${left}`);

/** Pairs positions in order; the better seed is listed as the home side. */
function pairUp(slots: string[], seeds: string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i < slots.length; i += 2)
    pairs.push(seeds.indexOf(slots[i]) <= seeds.indexOf(slots[i + 1]) ? [slots[i], slots[i + 1]] : [slots[i + 1], slots[i]]);
  return pairs;
}

/** Creates a bracket's next round once the last one is finished (or names the champion). Updates the bracket in place. */
export function advanceCollegeBracket(b: Bracket, byId: Map<string, ScheduledGame>, year: number): ScheduledGame[] {
  if (b.champion) return [];
  const cal = collegeCalendar(year);
  // Franchise tags the brackets of other divisions, as in "national:D2"
  const kind = b.id.split(":")[0];
  const national = kind === NATIONAL_ID;
  const make = (pairs: [string, string][], round: string): ScheduledGame[] => {
    const totalRounds = b.playIn ? 7 : Math.ceil(Math.log2(b.seeds.length));
    const dates = national ? cal.national : kind === INVITATIONAL_ID ? cal.invitational : cal.conferenceTournament;
    // brackets without an opening round line up with the last dates on their calendar
    const date = dates[dates.length - totalRounds + b.rounds.length];
    const games = pairs.map(([h, a], i) => ({
      id: `${b.id}-${year}-r${b.rounds.length}-${i}`,
      date,
      level: "college" as const,
      homeId: h,
      awayId: a,
      kind: "playoff" as const,
      label: `${b.name} ${round}`,
      neutral: true,
    }));
    b.rounds.push(games.map((g) => g.id));
    return games;
  };
  const roundName = national ? nationalRound : kind === INVITATIONAL_ID ? invitationalRound : conferenceRound;
  if (b.rounds.length === 0) {
    if (b.playIn)
      return make(
        [0, 1, 2, 3].map((i) => [b.seeds[60 + i], b.seeds[67 - i]]),
        "Opening Round",
      );
    return make(
      pairUp(
        seedOrder(b.seeds.length).map((s) => b.seeds[s - 1]),
        b.seeds,
      ),
      roundName(b.seeds.length),
    );
  }
  const last = b.rounds[b.rounds.length - 1].map((id) => byId.get(id)!);
  if (last.some((g) => !g?.result)) return [];
  const winners = last.map((g) => winnerOf(g)!);
  if (b.playIn && b.rounds.length === 1) {
    // opening-round winners take the last four spots in the field of 64
    const field = [...b.seeds.slice(0, 60), ...winners];
    return make(
      pairUp(
        seedOrder(64).map((s) => field[s - 1]),
        b.seeds,
      ),
      roundName(64),
    );
  }
  if (winners.length === 1) {
    b.champion = winners[0];
    return [];
  }
  return make(pairUp(winners, b.seeds), roundName(winners.length));
}
