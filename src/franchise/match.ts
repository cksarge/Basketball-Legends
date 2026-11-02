// Turning a franchise game into a 3D match, and the finished match back into league results.
import { playerOvr } from "@/engine/player";
import type { Player, Team } from "@/engine/types";
import { emptyLine, type BoxScore, type StatLine } from "@/game/sim/stats";
import { uniformColors } from "@/game3d/character/uniformTexture";
import type { MatchResult, PendingMatch } from "@/state/matchStore";
import type { BoxResult } from "./boxsim";
import type { ScheduledGame } from "@/career/types";
import { resolveLineup } from "./coaching/plan";
import { advancePostseason, applyGame } from "./core/season";
import { seedNumber } from "./create";
import { leagueModule } from "./leagues";
import { defaultRotation } from "./rotation";
import type { Franchise } from "./types";

/** Who dresses: hurt players stay home unless the team can't field five. */
function dressed(f: Franchise, teamId: string): Player[] {
  const m = leagueModule(f.league);
  const roster = f.rosters[teamId].map((id) => f.players[id]);
  const healthy = roster.filter((p) => !p.injury);
  if (healthy.length >= 5) return healthy;
  const rotation = defaultRotation(roster, m.quarterMinutes * m.periods * 5);
  return roster.filter((p) => rotation[p.id] > 0);
}

const startersOf = (roster: Player[]) =>
  [...roster]
    .sort((a, b) => playerOvr(b) - playerOvr(a))
    .slice(0, 5)
    .map((p) => p.id);

export function franchisePending(f: Franchise, game: ScheduledGame, teams: Team[], controller: string): PendingMatch {
  const find = (id: string) => teams.find((t) => t.id === id)!;
  const home = find(game.homeId),
    away = find(game.awayId);
  const homeIsUs = home.id === f.teamId;
  const homeRoster = dressed(f, home.id),
    awayRoster = dressed(f, away.id);
  const coached = (roster: Player[]) => {
    if (f.plan.autoRotation) return { starters: startersOf(roster), tactics: f.plan.tactics };
    const m = leagueModule(f.league);
    return { ...resolveLineup(f.plan, roster, m.quarterMinutes * m.periods * 5), tactics: f.plan.tactics };
  };
  const awayUniform = uniformColors(home, "home").base.toLowerCase() === uniformColors(away, "away").base.toLowerCase() ? "alt" : "away";
  return {
    mode: "franchise",
    league: f.league,
    arena: "pro",
    home: {
      team: home,
      roster: homeRoster,
      uniform: "home",
      controllers: homeIsUs ? [controller] : [],
      ...(homeIsUs ? coached(homeRoster) : { starters: startersOf(homeRoster) }),
    },
    away: {
      team: away,
      roster: awayRoster,
      uniform: awayUniform,
      controllers: homeIsUs ? [] : [controller],
      ...(homeIsUs ? { starters: startersOf(awayRoster) } : coached(awayRoster)),
    },
    quarterMinutes: f.settings.quarterMinutes,
    returnTo: `/franchise/hub/?id=${encodeURIComponent(f.id)}`,
    seed: seedNumber(`${f.seed}:${game.id}`),
    occasion: game.label,
    franchise: { franchiseId: f.id, gameId: game.id },
    difficulty: f.settings.difficulty,
    resume: false,
  };
}

/** The last period of a game simulated this far. */
export function fourthPending(f: Franchise, game: ScheduledGame, teams: Team[], controller: string): PendingMatch {
  const { partial } = f.live!;
  return {
    ...franchisePending(f, game, teams, controller),
    startFrom: { period: leagueModule(f.league).periods, homeScore: partial.home, awayScore: partial.away, box: partial.box },
    occasion: "Last period",
  };
}

export function resultToBox(r: MatchResult, regulationPeriods: number): BoxResult {
  return {
    home: r.homeScore,
    away: r.awayScore,
    overtimes: Math.max(0, r.periods - regulationPeriods),
    box: r.box,
    playerOfGame: r.playerOfGame,
    injuries: r.injuries.map((x) => ({ playerId: x.playerId, name: x.name, gamesOut: x.gamesOut })),
  };
}

/** Season stats for a game finished from a partial: the simulated part counts as it is, and only what was played scales up. */
function lastPeriodScaled(box: BoxScore, earlier: BoxScore, scale: number): BoxScore {
  return Object.fromEntries(
    Object.entries(box).map(([id, line]) => {
      const before = earlier[id] ?? emptyLine();
      const merged = Object.fromEntries((Object.keys(line) as (keyof StatLine)[]).map((k) => [k, before[k] + Math.round((line[k] - before[k]) * scale)]));
      return [id, merged as unknown as StatLine];
    }),
  );
}

/** Records a finished match. Stats count at full game length, so a short played game doesn't sink a player's averages. */
export function applyFinishedFranchiseMatch(f: Franchise, r: MatchResult, teams: Team[]): Franchise {
  if (r.franchise?.franchiseId !== f.id) return f;
  const m = leagueModule(f.league);
  const g = f.season.games.find((x) => x.id === r.franchise!.gameId);
  if (!g || g.result) return f;
  const lineupOf = (id: string) => {
    if (id !== f.teamId || f.plan.autoRotation) return startersOf(dressed(f, id));
    return resolveLineup(f.plan, dressed(f, id), m.quarterMinutes * m.periods * 5).starters;
  };
  const starters = [...lineupOf(g.homeId), ...lineupOf(g.awayId)];
  const scale = m.quarterMinutes / r.quarterMinutes;
  const earlier = f.live?.gameId === g.id ? f.live.partial.box : undefined;
  const next = applyGame(f, g.id, resultToBox(r, m.periods), !r.simulated, starters, scale, earlier && lastPeriodScaled(r.box, earlier, scale));
  const done = { ...next };
  delete done.live;
  return advancePostseason(done, teams);
}
