// Career totals, built up one season at a time, and what's kept of a finished season.
import type { Player } from "@/engine/types";
import { reb } from "@/game/sim/stats";
import type { CareerLine, Franchise, LeagueSeason, SeasonLine } from "../types";

const EMPTY: CareerLine = { seasons: 0, gp: 0, min: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, bestSeasonPts: 0 };

/** Adds a finished season, its awards and any title to a player's record. */
export function addSeason(p: Player, line: SeasonLine | undefined, f: Franchise): Player {
  const file = { ...p.file! };
  if (line && line.gp > 0) {
    const c = file.career ?? EMPTY;
    file.career = {
      seasons: c.seasons + 1,
      gp: c.gp + line.gp,
      min: c.min + line.min,
      pts: c.pts + line.pts,
      reb: c.reb + reb(line),
      ast: c.ast + line.ast,
      stl: c.stl + line.stl,
      blk: c.blk + line.blk,
      bestSeasonPts: Math.max(c.bestSeasonPts, line.pts),
    };
  }
  const won = f.season.awards.filter((a) => a.playerId === p.id).length;
  if (won) file.awards = (file.awards ?? 0) + won;
  if (f.season.championRoster?.includes(p.id)) file.titles = (file.titles ?? 0) + 1;
  return { ...p, file };
}

/** Old seasons keep their numbers but not their game lists, which are most of a save. */
export const archiveSeason = (s: LeagueSeason): LeagueSeason => ({ ...s, games: [] });
