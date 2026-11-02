// What a league has to provide to run in Franchise. College and high school add their own later.
import type { IsoDate, ScheduledGame } from "@/career/types";
import type { LeagueId, Team } from "@/engine/types";
import type { Franchise } from "../types";
import { proLeague } from "./pro";

export interface LeagueModule {
  id: LeagueId;
  calendar(year: number): { opening: IsoDate; lastGame: IsoDate; seasonEnd: IsoDate };
  quarterMinutes: number;
  periods: number;
  schedule(teams: Team[], year: number, seed: string): ScheduledGame[];
  /** Creates the postseason games that are due and advances series. */
  postseason(f: Franchise, teams: Team[]): Franchise;
}

export function leagueModule(id: LeagueId): LeagueModule {
  if (id === "pro") return proLeague;
  throw new Error(`Franchise doesn't support the ${id} league yet.`);
}
