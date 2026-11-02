// Runs the league one day at a time. Each game gets its own seed, so a run that's interrupted replays the same way.
import { addDays } from "@/career/calendar";
import type { IsoDate, ScheduledGame } from "@/career/types";
import type { Player, Team } from "@/engine/types";
import { addLine, emptyLine, type BoxScore, type StatLine } from "@/game/sim/stats";
import { weeklyDevelopment } from "../coaching/development";
import { resolveLineup } from "../coaching/plan";
import { coachEdge, staffRating, trainerGamesOut } from "../coaching/staff";
import { finishBox, simBox, simQuarters, type BoxInput, type BoxResult, type BoxSide } from "../boxsim";
import { seasonAwards } from "./awards";
import { leagueModule } from "../leagues";
import { activeRoster, processWaivers, rosterProblem } from "../pro/rosterMoves";
import { weeklyScouting } from "../pro/scouting";
import { conferenceSeeds } from "../leagues/pro";
import { defaultRotation } from "../rotation";
import type { Franchise, PartialGame, SeasonLine } from "../types";

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

function boxSide(f: Franchise, teamId: string, g: ScheduledGame): BoxSide {
  const roster = activeRoster(f, teamId, g);
  if (teamId === f.teamId) return { teamId, roster, ...resolveLineup(f.plan, roster, leagueTotalMinutes(f)), tactics: f.plan.tactics, coachEdge: coachEdge(f) };
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
    home: boxSide(f, g.homeId, g),
    away: boxSide(f, g.awayId, g),
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
  /** The user's game was decided, so its matchups are done. */
  userPlayed: boolean;
}

const working = (f: Franchise): Working => ({
  f,
  games: [...f.season.games],
  index: new Map(f.season.games.map((g, i) => [g.id, i])),
  stats: { ...f.season.stats },
  playoffStats: { ...f.season.playoffStats },
  players: { ...f.players },
  changed: new Set(),
  userPlayed: false,
});

/** A line scaled up to full game length, for a played game with shorter quarters. */
function fullLength(line: StatLine, scale: number): StatLine {
  if (scale === 1) return line;
  return Object.fromEntries(Object.entries(line).map(([k, v]) => [k, Math.round(v * scale)])) as unknown as StatLine;
}

function record(w: Working, g: ScheduledGame, r: BoxResult, played: boolean, starters: Set<string>, statScale = 1, statBox?: BoxScore) {
  if (isUsers(w.f, g)) w.userPlayed = true;
  const roster = w.f.rosters[w.f.teamId];
  const box = isUsers(w.f, g) ? Object.fromEntries(Object.entries(r.box).filter(([id]) => roster.includes(id))) : undefined;
  w.games[w.index.get(g.id)!] = {
    ...g,
    result: { home: r.home, away: r.away, played, overtimes: r.overtimes, playerOfGame: r.playerOfGame, ...(box ? { box } : {}) },
  };
  const table = g.kind === "playoff" ? w.playoffStats : w.stats;
  for (const [id, line] of Object.entries(statBox ?? r.box)) {
    if (line.min <= 0) continue;
    const prev = table[id] ?? { ...emptyLine(), gp: 0, gs: 0 };
    table[id] = { ...addLine(prev, statBox ? line : fullLength(line, statScale)), gp: prev.gp + 1, gs: prev.gs + (starters.has(id) ? 1 : 0) };
    // once he's played, everyone can see what he is
    const file = w.players[id]?.file;
    if (file?.range) {
      const known = { ...file };
      delete known.range;
      w.players[id] = { ...w.players[id], file: known };
      w.changed.add(id);
    }
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
    const gamesOut = roster.includes(x.playerId) ? trainerGamesOut(x.gamesOut, staffRating(w.f, "trainer")) : x.gamesOut;
    w.players[x.playerId] = { ...w.players[x.playerId], injury: { name: x.name, gamesOut } };
    w.changed.add(x.playerId);
  }
}

function finish(w: Working): Franchise {
  const tactics = { ...w.f.plan.tactics };
  delete tactics.matchups;
  delete tactics.doubleTarget;
  return {
    ...w.f,
    plan: w.userPlayed ? { ...w.f.plan, tactics } : w.f.plan,
    players: w.players,
    season: { ...w.f.season, games: w.games, stats: w.stats, playoffStats: w.playoffStats },
  };
}

/** Records one game. A game that already has a result stays as it is. */
export function applyGame(f: Franchise, gameId: string, r: BoxResult, played: boolean, starters: string[] = [], statScale = 1, statBox?: BoxScore): Franchise {
  const g = f.season.games.find((x) => x.id === gameId);
  if (!g || g.result) return f;
  const w = working(f);
  record(w, g, r, played, new Set(starters), statScale, statBox);
  return finish(w);
}

/** Creates the postseason games that are due; the awards land the moment the league's champion is decided. */
export function advancePostseason(f: Franchise, teams: Team[]): Franchise {
  const next = leagueModule(f.league).postseason(f, teams);
  if (next.phase !== "offseason" || f.phase === "offseason") return next;
  return { ...next, offseason: { step: "review", report: null }, season: { ...next.season, awards: seasonAwards(next, teams) } };
}

/** Is a game close enough after three quarters to ask the user to finish it? */
export const isClose = (p: PartialGame, margin: number) => Math.abs(p.home - p.away) <= margin;

/** Sims all but the last period of the user's game. The result is saved, so reopening the game gets the same score. */
export function startFourth(f: Franchise, game: ScheduledGame): Franchise {
  if (f.live?.gameId === game.id) return f;
  return { ...f, live: { gameId: game.id, partial: simQuarters(boxInput(f, game), leagueModule(f.league).periods - 1) } };
}

/** Sims the rest of a game that's partway through. */
export function finishPartial(f: Franchise, gameId: string, teams: Team[]): Franchise {
  const g = f.season.games.find((x) => x.id === gameId);
  if (!g || g.result || f.live?.gameId !== gameId) return f;
  const input = boxInput(f, g);
  const next = applyGame(f, gameId, finishBox(input, f.live.partial), false, [...input.home.starters, ...input.away.starters]);
  const done = { ...next };
  delete done.live;
  return advancePostseason(done, teams);
}

export interface SimDayResult {
  franchise: Franchise;
  changedPlayers: string[];
  /** The day can't finish until the user's game is played. */
  blocked: boolean;
}

/** Sims the day's games and moves to the next day, unless the user's game is still open. */
export function simDay(f: Franchise, teams: Team[], opts: { includeUser: boolean; simLive?: boolean }): SimDayResult {
  if (f.phase === "offseason") return { franchise: f, changedPlayers: [], blocked: false };
  if (rosterProblem(f)) return { franchise: f, changedPlayers: [], blocked: true };
  const today = f.season.games.filter((g) => g.date <= f.date && !g.result);
  const w = working(f);
  let blocked = false;
  for (const g of today) {
    if (isUsers(f, g) && !opts.includeUser) {
      blocked = true;
      continue;
    }
    if (isUsers(f, g) && (f.live?.gameId === g.id || f.settings.closeGamesOnly)) {
      const started = startFourth({ ...f, players: w.players }, g);
      const partial = started.live!.partial;
      if (!opts.simLive && f.settings.closeGamesOnly && isClose(partial, f.settings.closeGameMargin)) {
        w.f = { ...w.f, live: started.live };
        blocked = true;
        continue;
      }
      const input = boxInput({ ...f, players: w.players }, g);
      record(w, g, finishBox(input, partial), false, new Set([...input.home.starters, ...input.away.starters]));
      w.f = { ...w.f };
      delete w.f.live;
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
  const dated = { ...next, date: next.phase === "offseason" ? next.date : addDays(next.date, 1) };
  const practice = weeklyDevelopment(dated);
  const weekDone = practice.franchise.devDate !== dated.devDate;
  return {
    franchise: weekDone ? weeklyScouting(practice.franchise) : practice.franchise,
    changedPlayers: [...new Set([...changedPlayers, ...practice.changedPlayers])],
    blocked,
  };
}
