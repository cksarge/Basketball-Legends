// Runs the league one day at a time. Each game gets its own seed, so a run that's interrupted replays the same way.
import { addDays } from "@/career/calendar";
import type { IsoDate, ScheduledGame } from "@/career/types";
import type { Player, Team } from "@/engine/types";
import { addLine, emptyLine, type StatLine } from "@/game/sim/stats";
import { resolveLineup } from "../coaching/plan";
import { simBox, type BoxInput, type BoxResult, type BoxSide } from "../boxsim";
import { seasonAwards } from "./awards";
import { leagueModule } from "../leagues";
import { conferenceSeeds } from "../leagues/pro";
import { defaultRotation } from "../rotation";
import type { Franchise, SeasonLine } from "../types";

export { conferenceSeeds };

export type FranchiseEvent = { kind: "game"; date: IsoDate; game: ScheduledGame } | { kind: "day"; date: IsoDate } | { kind: "seasonEnd"; date: IsoDate };

const isUsers = (f: Franchise, g: ScheduledGame) => g.homeId === f.teamId || g.awayId === f.teamId;

export function nextFranchiseEvent(f: Franchise): FranchiseEvent {
  if (f.phase === "offseason") return { kind: "seasonEnd", date: f.date };
  const open = f.season.games.filter((g) => !g.result && isUsers(f, g)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))[0];
  return open ? { kind: "game", date: open.date, game: open } : { kind: "day", date: f.date };
}

/** The user's game, if it's ready to play today. */
export function dueGame(f: Franchise): ScheduledGame | null {
  const ev = nextFranchiseEvent(f);
  return ev.kind === "game" && ev.date <= f.date ? ev.game : null;
}

function boxSide(f: Franchise, teamId: string): BoxSide {
  const roster = f.rosters[teamId].map((id) => f.players[id]);
  if (teamId === f.teamId) return { teamId, roster, ...resolveLineup(f.plan, roster, leagueTotalMinutes(f)), tactics: f.plan.tactics };
  const rotation = defaultRotation(roster, leagueTotalMinutes(f));
  return { teamId, roster, rotation, starters: Object.keys(rotation).slice(0, 5) };
}

function leagueTotalMinutes(f: Franchise) {
  const m = leagueModule(f.league);
  return m.quarterMinutes * m.periods * 5;
}

function boxInput(f: Franchise, g: ScheduledGame): BoxInput {
  const m = leagueModule(f.league);
  return {
    league: f.league,
    quarterMinutes: m.quarterMinutes,
    periods: m.periods,
    home: boxSide(f, g.homeId),
    away: boxSide(f, g.awayId),
    neutral: g.neutral,
    seed: `${f.seed}:${g.id}`,
  };
}

/** One game's effect on the working copy of a season. Callers own these objects and replace them when done. */
interface Working {
  f: Franchise;
  games: ScheduledGame[];
  index: Map<string, number>;
  stats: Record<string, SeasonLine>;
  playoffStats: Record<string, SeasonLine>;
  players: Record<string, Player>;
  changed: Set<string>;
}

const working = (f: Franchise): Working => ({
  f,
  games: [...f.season.games],
  index: new Map(f.season.games.map((g, i) => [g.id, i])),
  stats: { ...f.season.stats },
  playoffStats: { ...f.season.playoffStats },
  players: { ...f.players },
  changed: new Set(),
});

/** A line scaled up to full game length, for a played game with shorter quarters. */
function fullLength(line: StatLine, scale: number): StatLine {
  if (scale === 1) return line;
  return Object.fromEntries(Object.entries(line).map(([k, v]) => [k, Math.round(v * scale)])) as unknown as StatLine;
}

function record(w: Working, g: ScheduledGame, r: BoxResult, played: boolean, starters: Set<string>, statScale = 1) {
  const mine = w.f.rosters[w.f.teamId];
  const box = isUsers(w.f, g) ? Object.fromEntries(Object.entries(r.box).filter(([id]) => mine.includes(id))) : undefined;
  w.games[w.index.get(g.id)!] = {
    ...g,
    result: { home: r.home, away: r.away, played, overtimes: r.overtimes, playerOfGame: r.playerOfGame, ...(box ? { box } : {}) },
  };
  const table = g.kind === "playoff" ? w.playoffStats : w.stats;
  for (const [id, line] of Object.entries(r.box)) {
    if (line.min <= 0) continue;
    const prev = table[id] ?? { ...emptyLine(), gp: 0, gs: 0 };
    table[id] = { ...addLine(prev, fullLength(line, statScale)), gp: prev.gp + 1, gs: prev.gs + (starters.has(id) ? 1 : 0) };
  }
  // every team game takes one off an injury, then this game's new ones land
  for (const id of [...w.f.rosters[g.homeId], ...w.f.rosters[g.awayId]]) {
    const p = w.players[id];
    if (!p.injury) continue;
    const left = p.injury.gamesOut - 1;
    const { injury, ...healed } = p;
    w.players[id] = left > 0 ? { ...p, injury: { ...injury, gamesOut: left } } : healed;
    w.changed.add(id);
  }
  for (const x of r.injuries) {
    w.players[x.playerId] = { ...w.players[x.playerId], injury: { name: x.name, gamesOut: x.gamesOut } };
    w.changed.add(x.playerId);
  }
}

const finish = (w: Working): Franchise => ({
  ...w.f,
  players: w.players,
  season: { ...w.f.season, games: w.games, stats: w.stats, playoffStats: w.playoffStats },
});

/** Records one game. A game that already has a result stays as it is. */
export function applyGame(f: Franchise, gameId: string, r: BoxResult, played: boolean, starters: string[] = [], statScale = 1): Franchise {
  const g = f.season.games.find((x) => x.id === gameId);
  if (!g || g.result) return f;
  const w = working(f);
  record(w, g, r, played, new Set(starters), statScale);
  return finish(w);
}

/** Creates the postseason games that are due; the awards land the moment the league's champion is decided. */
export function advancePostseason(f: Franchise, teams: Team[]): Franchise {
  const next = leagueModule(f.league).postseason(f, teams);
  if (next.phase !== "offseason" || f.phase === "offseason") return next;
  return { ...next, season: { ...next.season, awards: seasonAwards(next, teams) } };
}

export interface SimDayResult {
  franchise: Franchise;
  changedPlayers: string[];
  /** The day can't finish until the user's game is played. */
  blocked: boolean;
}

/** Sims the day's games and moves to the next day, unless the user's game is still open. */
export function simDay(f: Franchise, teams: Team[], opts: { includeUser: boolean }): SimDayResult {
  if (f.phase === "offseason") return { franchise: f, changedPlayers: [], blocked: false };
  const today = f.season.games.filter((g) => g.date <= f.date && !g.result);
  const w = working(f);
  let blocked = false;
  for (const g of today) {
    if (isUsers(f, g) && !opts.includeUser) {
      blocked = true;
      continue;
    }
    // hurt players are read from the working copy, in case an earlier game changed them
    const input = boxInput({ ...f, players: w.players }, g);
    record(w, g, simBox(input), false, new Set([...input.home.starters, ...input.away.starters]));
  }
  const done = finish(w);
  const changedPlayers = [...w.changed];
  if (blocked) return { franchise: done, changedPlayers, blocked };
  const next = advancePostseason(done, teams);
  return { franchise: { ...next, date: next.phase === "offseason" ? next.date : addDays(next.date, 1) }, changedPlayers, blocked };
}
