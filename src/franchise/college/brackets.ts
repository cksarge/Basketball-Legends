// A division's postseason: conference tournaments (or regular-season champions), then the national tournament and,
// in Division I, the invitational. It only creates games. Whoever runs the division decides them.
import { advanceCollegeBracket, conferenceBrackets, selectFields } from "@/career/college/postseason";
import { standings } from "@/career/hs/sim";
import type { Bracket, ScheduledGame } from "@/career/types";
import type { Team } from "@/engine/types";
import type { LeagueSettings } from "../types";

export interface DivisionPost {
  year: number;
  teams: Team[];
  games: ScheduledGame[];
  brackets: Bracket[];
  format: LeagueSettings["playoffFormat"];
  names?: Record<string, { name: string; short: string }>;
  /** Added to the national and invitational ids, so other divisions' brackets don't clash. */
  tag?: string;
}

const isConference = (b: Bracket) => b.id.startsWith("conf-");

/** Each conference's best regular-season record takes its automatic bid when there are no tournaments. */
function regularSeasonChampions(teams: Team[], games: ScheduledGame[], names: DivisionPost["names"]): Bracket[] {
  const groups = new Map<string, string[]>();
  for (const t of teams) groups.set(t.conferenceId, [...(groups.get(t.conferenceId) ?? []), t.id]);
  const out: Bracket[] = [];
  for (const [conf, ids] of groups) {
    if (ids.length < 2) continue;
    const table = standings(games, ids);
    const best = [...ids].sort(
      (a, b) => table.get(b)!.rw - table.get(b)!.rl - (table.get(a)!.rw - table.get(a)!.rl) || table.get(b)!.w - table.get(a)!.w || a.localeCompare(b),
    )[0];
    out.push({
      id: `conf-${conf}`,
      name: `${names?.[conf]?.short ?? "Conference"} Regular-Season Champion`,
      seeds: [best],
      playIn: false,
      rounds: [],
      champion: best,
    });
  }
  return out;
}

/** Creates whatever postseason games are due. Returns the same lists when nothing changed. */
export function advanceDivision(o: DivisionPost): { games: ScheduledGame[]; brackets: Bracket[]; changed: boolean } {
  const ids = new Set(o.teams.map((t) => t.id));
  const mine = (g: ScheduledGame) => ids.has(g.homeId) && ids.has(g.awayId);
  if (o.games.some((g) => g.kind !== "playoff" && !g.result && mine(g))) return { games: o.games, brackets: o.brackets, changed: false };
  const own = o.brackets.filter((b) => b.seeds.some((id) => ids.has(id)));
  const others = o.brackets.filter((b) => !own.includes(b));
  const regular = o.games.filter((g) => g.kind !== "playoff" && mine(g));
  const names = o.names ? new Map(Object.entries(o.names)) : undefined;
  let changed = false;
  let brackets = own.map((b) => ({ ...b, rounds: b.rounds.map((r) => [...r]) }));
  if (!brackets.length) {
    brackets = o.format.conferenceTournaments === false ? regularSeasonChampions(o.teams, regular, o.names) : conferenceBrackets(o.teams, regular, names);
    changed = true;
  }
  const games = [...o.games];
  const byId = new Map(games.map((g) => [g.id, g]));
  for (let guard = 0; guard < 16; guard++) {
    let moved = false;
    const conference = brackets.filter(isConference);
    if (brackets.length === conference.length && conference.every((b) => b.champion)) {
      const field = o.teams[0].tier === "D1" ? (o.format.nationalField ?? 68) : 64;
      const picked = selectFields(o.teams, regular, conference, field).map((b) => (o.tag ? { ...b, id: `${b.id}:${o.tag}` } : b));
      brackets.push(...picked);
      moved = true;
    }
    for (const b of brackets) {
      const open = !b.champion;
      const fresh = advanceCollegeBracket(b, byId, o.year);
      for (const g of fresh) {
        games.push(g);
        byId.set(g.id, g);
      }
      if (fresh.length || (open && b.champion)) moved = true;
    }
    if (!moved) break;
    changed = true;
  }
  return { games, brackets: [...others, ...brackets], changed };
}
