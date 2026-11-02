// The Franchise save format: one persistent league, its players and the season in progress.
import type { IsoDate, ProSeries, ScheduledGame } from "@/career/types";
import type { LeagueId, Player, Position, TeamTactics } from "@/engine/types";
import type { Difficulty } from "@/game/sim/state";
import type { BoxScore, StatLine } from "@/game/sim/stats";

export const FRANCHISE_VERSION = 2;

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

export type PracticeFocus = "balanced" | "shooting" | "finishing" | "playmaking" | "defense" | "conditioning";

export interface PlayerPlan {
  /** A training id from career/pro/season.ts. */
  focus: string;
  newPos?: Position;
  posWeeks?: number;
}

export type StaffRole = "assistant" | "development" | "scout" | "trainer";

export interface StaffMember {
  id: string;
  role: StaffRole;
  name: string;
  /** 40..95 */
  rating: number;
  salary: number;
}

/** How the user coaches their team. */
export interface TeamPlan {
  autoRotation: boolean;
  starters: string[];
  /** Per 240-minute game. */
  minutes: Record<string, number>;
  tactics: TeamTactics;
  practice: PracticeFocus;
  playerPlans: Record<string, PlayerPlan>;
  staff: StaffMember[];
}

/** The first part of a game, simulated so the user can play the rest. */
export interface PartialGame {
  home: number;
  away: number;
  box: BoxScore;
  seconds: number;
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
  plan: TeamPlan;
  /** The user's game that's partway through. */
  live?: { gameId: string; partial: PartialGame };
  /** The last day of practice counted. */
  devDate: IsoDate;
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
