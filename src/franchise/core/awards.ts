// Stat leaders and the end-of-season awards.
import { standings } from "@/career/hs/sim";
import { fullName } from "@/engine/player";
import type { Team } from "@/engine/types";
import { gameScore, reb } from "@/game/sim/stats";
import type { Award, Franchise, SeasonLine } from "../types";

export type LeaderKey = "ppg" | "rpg" | "apg" | "spg" | "bpg" | "fgPct" | "tpPct" | "ftPct";

/** The share of a season a player has to appear in to qualify, 58 of 82 games. */
const GAMES_SHARE = 58 / 82;
const MIN_ATTEMPTS = { fgPct: 300, tpPct: 82, ftPct: 125 };

const VALUE: Record<LeaderKey, (l: SeasonLine) => number> = {
  ppg: (l) => l.pts / l.gp,
  rpg: (l) => reb(l) / l.gp,
  apg: (l) => l.ast / l.gp,
  spg: (l) => l.stl / l.gp,
  bpg: (l) => l.blk / l.gp,
  fgPct: (l) => l.fgm / l.fga,
  tpPct: (l) => l.tpm / l.tpa,
  ftPct: (l) => l.ftm / l.fta,
};
const ATTEMPTS: Partial<Record<LeaderKey, (l: SeasonLine) => number>> = { fgPct: (l) => l.fga, tpPct: (l) => l.tpa, ftPct: (l) => l.fta };

function gamesNeeded(f: Franchise) {
  const scheduled = f.season.games.filter((g) => g.kind === "region" && (g.homeId === f.teamId || g.awayId === f.teamId)).length;
  return Math.round(scheduled * GAMES_SHARE);
}

export function leaders(f: Franchise, key: LeaderKey, limit = 10) {
  const need = gamesNeeded(f);
  const attempts = ATTEMPTS[key];
  const min = key in MIN_ATTEMPTS ? MIN_ATTEMPTS[key as keyof typeof MIN_ATTEMPTS] : 0;
  return Object.entries(f.season.stats)
    .filter(([, l]) => l.gp >= need && (!attempts || attempts(l) >= min))
    .map(([playerId, l]) => ({ playerId, teamId: f.players[playerId].teamId!, value: VALUE[key](l), gp: l.gp }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

/** A stats row's name and team. A retired player or free agent has no team. */
export function leaderRow(f: Franchise, teams: Team[], id: string) {
  const p = f.players[id];
  return { name: fullName(p), team: teams.find((t) => t.id === p.teamId)?.abbrev ?? "" };
}

const impact = (l: SeasonLine) => (l.pts + reb(l) * 0.7 + l.ast * 0.9 + (l.stl + l.blk) * 1.2) / l.gp;
const defense = (l: SeasonLine) => ((l.stl + l.blk) * 1.5 + reb(l) * 0.3) / l.gp;

export function seasonAwards(f: Franchise, teams: Team[]): Award[] {
  const need = gamesNeeded(f);
  const table = standings(
    f.season.games.filter((g) => g.kind === "region"),
    teams.map((t) => t.id),
  );
  const winPct = (teamId: string) => {
    const s = table.get(teamId);
    return s && s.w + s.l ? s.w / (s.w + s.l) : 0.5;
  };
  // someone let go before the awards has no team to win them for
  const eligible = Object.entries(f.season.stats)
    .filter(([id, l]) => l.gp >= need && f.players[id].teamId)
    .map(([id, l]) => ({ id, l, teamId: f.players[id].teamId! }));
  // winning counts: a big year on a bad team loses to one on a contender
  const value = [...eligible].sort((a, b) => impact(b.l) * (0.8 + winPct(b.teamId) * 0.4) - impact(a.l) * (0.8 + winPct(a.teamId) * 0.4));
  const award = (id: string, label: string, x?: { id: string; teamId: string }): Award[] => (x ? [{ id, label, playerId: x.id, teamId: x.teamId }] : []);
  const teamsOf = (n: number, label: string) => value.slice((n - 1) * 5, n * 5).flatMap((x) => award(`allLeague${n}`, label, x));
  const bench = value.filter((x) => x.l.gs < x.l.gp / 2);
  const stopper = [...eligible].sort((a, b) => defense(b.l) - defense(a.l))[0];
  const champion = f.season.championId;
  const finals = champion
    ? f.rosters[champion]
        .filter((id) => f.season.playoffStats[id])
        .map((id) => ({ id, teamId: champion, score: gameScore(f.season.playoffStats[id]) / f.season.playoffStats[id].gp }))
        .sort((a, b) => b.score - a.score)[0]
    : undefined;
  return [
    ...award("mvp", "Most Valuable Player", value[0]),
    ...award("dpoy", "Defensive Player of the Year", stopper),
    ...award("sixth", "Sixth Man of the Year", bench[0]),
    ...teamsOf(1, "All-League First Team"),
    ...teamsOf(2, "All-League Second Team"),
    ...teamsOf(3, "All-League Third Team"),
    ...award("finalsMvp", "Finals MVP", finals),
  ];
}
