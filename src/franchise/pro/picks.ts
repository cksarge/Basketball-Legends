// Draft picks: every team's picks exist four drafts ahead, and they trade separately from the team that made them.
import type { Team } from "@/engine/types";
import type { DraftPick, Franchise } from "../types";

export const PICK_YEARS = 4;

const makePick = (teamId: string, year: number, round: 1 | 2): DraftPick => ({
  id: `pick-${year}-${round}-${teamId}`,
  year,
  round,
  originalTeamId: teamId,
  ownerId: teamId,
});

export function futurePicks(teamIds: string[], fromYear: number, count: number): DraftPick[] {
  return Array.from({ length: count }, (_, i) => teamIds.flatMap((id) => [makePick(id, fromYear + i, 1), makePick(id, fromYear + i, 2)])).flat();
}

/** This season's draft comes the June after it starts. */
export const draftYearOf = (f: Pick<Franchise, "season">) => f.season.year + 1;

/** Drops used drafts and adds the one that's now in range. Ownership carries over. */
export function rollPicks(f: Franchise, teams: Team[]): DraftPick[] {
  const first = draftYearOf(f);
  const kept = f.picks.filter((p) => p.year >= first);
  const have = new Set(kept.map((p) => p.id));
  const ids = teams.map((t) => t.id);
  return [...kept, ...futurePicks(ids, first, PICK_YEARS).filter((p) => !have.has(p.id))];
}
