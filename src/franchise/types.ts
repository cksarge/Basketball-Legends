// The Franchise save format: one persistent league, its players and the season in progress.
import type { IsoDate, ProSeries, ScheduledGame } from "@/career/types";
import type { LeagueId, Player } from "@/engine/types";
import type { Difficulty } from "@/game/sim/state";
import type { StatLine } from "@/game/sim/stats";

export const FRANCHISE_VERSION = 1;

export type FranchisePhase = "regular" | "playIn" | "playoffs" | "offseason";

export interface FranchiseSettings {
  /** Quarter length in played games. Simulated games always run at the league's full length. */
  quarterMinutes: number;
  difficulty: Difficulty;
  /** "Close games only": the fourth-quarter margin that counts as close. */
  closeGameMargin: number;
}

export interface SeasonLine extends StatLine {
  gp: number;
  gs: number;
}

export interface Award {
  id: string;
  label: string;
  playerId: string;
  teamId: string;
}

export interface LeagueSeason {
  year: number;
  games: ScheduledGame[];
  series: ProSeries[];
  /** Regular season totals by player id. */
  stats: Record<string, SeasonLine>;
  playoffStats: Record<string, SeasonLine>;
  awards: Award[];
  championId?: string;
}

export interface Franchise {
  id: string;
  version: number;
  seed: string;
  /** Goes up with every save, so an older copy can't overwrite newer progress. */
  revision: number;
  createdAt: number;
  updatedAt: number;
  league: LeagueId;
  teamId: string;
  date: IsoDate;
  phase: FranchisePhase;
  settings: FranchiseSettings;
  players: Record<string, Player>;
  /** Team id -> player ids. */
  rosters: Record<string, string[]>;
  season: LeagueSeason;
}

export interface FranchiseSummary {
  id: string;
  teamName: string;
  teamId: string;
  league: LeagueId;
  primary: string;
  year: number;
  date: IsoDate;
  wins: number;
  losses: number;
  createdAt: number;
  updatedAt: number;
}
