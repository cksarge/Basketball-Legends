// League records: the best seasons and careers, and the user's best single games.
import type { ScheduledGame } from "@/career/types";
import { fullName } from "@/engine/player";
import { reb, type BoxScore } from "@/game/sim/stats";
import type { Franchise, LeagueRecord } from "../types";

/** The share of a season needed for a per-game record, as for stat titles. */
const GAMES_SHARE = 58 / 82;

type Holder = Omit<LeagueRecord, "key" | "label">;

function keepBest(records: LeagueRecord[], key: string, label: string, holder: Holder): LeagueRecord[] {
  const was = records.find((r) => r.key === key);
  if (was && was.value >= holder.value) return records;
  return [...records.filter((r) => r.key !== key), { key, label, ...holder }];
}

/** Everything a finished season can change. Run while its players are still in the league. */
export function updateRecords(f: Franchise): Franchise {
  let records = f.records;
  const year = f.season.year;
  const need = f.settings.league.gamesPerSeason * GAMES_SHARE;
  for (const [id, l] of Object.entries(f.season.stats)) {
    const p = f.players[id];
    if (!p || l.gp <= 0) continue;
    const name = fullName(p);
    const at = (value: number): Holder => ({ value, playerId: id, name, year });
    records = keepBest(records, "seasonPts", "Most points in a season", at(l.pts));
    records = keepBest(records, "seasonReb", "Most rebounds in a season", at(reb(l)));
    records = keepBest(records, "seasonAst", "Most assists in a season", at(l.ast));
    if (l.gp >= need) records = keepBest(records, "seasonPpg", "Best scoring average", at(+(l.pts / l.gp).toFixed(1)));
  }
  const careers = [
    ...f.retired.map((r) => ({ id: r.id, name: r.name, career: r.career })),
    ...Object.values(f.players).map((p) => ({ id: p.id, name: fullName(p), career: p.file?.career })),
  ];
  for (const { id, name, career } of careers) {
    if (!career) continue;
    const at = (value: number): Holder => ({ value, playerId: id, name, year });
    records = keepBest(records, "careerPts", "Most career points", at(career.pts));
    records = keepBest(records, "careerReb", "Most career rebounds", at(career.reb));
    records = keepBest(records, "careerAst", "Most career assists", at(career.ast));
    records = keepBest(records, "careerGp", "Most career games", at(career.gp));
  }
  return records === f.records ? f : { ...f, records };
}

/** The user's team is the only one with box scores kept, so game records are the club's own. */
export function gameRecords(f: Franchise, g: ScheduledGame, box: BoxScore): Franchise {
  if (g.homeId !== f.teamId && g.awayId !== f.teamId) return f;
  let records = f.records;
  for (const id of f.rosters[f.teamId]) {
    const l = box[id];
    if (!l) continue;
    const at = (value: number): Holder => ({ value, playerId: id, name: fullName(f.players[id]), year: f.season.year });
    records = keepBest(records, "gamePts", "Your most points in a game", at(l.pts));
    records = keepBest(records, "gameReb", "Your most rebounds in a game", at(reb(l)));
    records = keepBest(records, "gameAst", "Your most assists in a game", at(l.ast));
  }
  return records === f.records ? f : { ...f, records };
}
