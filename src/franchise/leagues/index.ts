// What a league has to provide to run in Franchise: its calendar and rules, and hooks for the systems only it has.
import type { IsoDate, ScheduledGame } from "@/career/types";
import type { LeagueId, Team } from "@/engine/types";
import type { Award, Franchise, LeagueSettings, OffseasonStep, OwnerGoal } from "../types";
import { collegeLeague } from "./college";
import { proLeague } from "./pro";

export interface DayResult {
  franchise: Franchise;
  changedPlayers: string[];
}

export type SettingsField = "playoffFormat" | "tradeDifficulty" | "conferenceTournaments" | "nationalField" | "openDivision";

export interface LeagueModule {
  id: LeagueId;
  calendar(year: number): { opening: IsoDate; lastGame: IsoDate; seasonEnd: IsoDate };
  quarterMinutes: number;
  periods: number;
  /** "4th quarter" or "2nd half", for the play-the-end controls. */
  lastPeriodLabel: string;
  arena: "pro" | "college" | "gym";
  /** Who sets the coach's goals. */
  boss: "owner" | "athletic director" | "principal";
  roster: { min: number; max: number; campMin: number };
  /** Tabs and systems that exist in this league. */
  systems: { cap: boolean; trades: boolean; freeAgency: boolean; draft: boolean; finances: boolean; recruiting: boolean; squads: boolean };
  /** `trimSeed` picks which games a shorter season drops. It defaults to the seed. */
  schedule(teams: Team[], year: number, seed: string, settings: LeagueSettings, trimSeed?: string): ScheduledGame[];
  /** Creates the postseason games that are due and advances series or brackets. */
  postseason(f: Franchise, teams: Team[]): Franchise;
  /** The summer, in order. */
  offseasonSteps: OffseasonStep[];
  /** When a step happens, for the season starting in this year. */
  offseasonDate(step: OffseasonStep, year: number): IsoDate | null;
  /** League-specific state for a brand new franchise. */
  setup(f: Franchise, teams: Team[]): Franchise;
  /** What happens on arriving at a step. */
  enterStep(f: Franchise, step: OffseasonStep, teams: Team[]): Franchise;
  /** What the league needs from the user before the summer moves on. Firing is checked by the caller. */
  canAdvance(f: Franchise): { ok: true } | { ok: false; reason: string };
  /** Why the user's roster can't play today, if it can't. */
  rosterProblem(f: Franchise): string | null;
  /** Auto-manage's fix for a roster that can't play. */
  fixRoster(f: Franchise): Franchise;
  /** Once a week during the season, after practice. */
  weekly(f: Franchise, teams: Team[], date: IsoDate): DayResult;
  /** Every day, after games and the weekly work. */
  daily(f: Franchise, teams: Team[], weekDone: boolean): DayResult;
  /** Runs before the shared rollover to a new season, on the new opening day. */
  beforeNewSeason(f: Franchise, date: IsoDate): Franchise;
  /** The new season's league-specific state, after the shared rollover. */
  newSeason(f: Franchise, teams: Team[]): Franchise;
  /** Takes in a finished game's gate, before the postseason moves on. */
  gates(f: Franchise, teams: Team[]): Franchise;
  /** Closes the season's books once the champion is crowned. */
  closeSeason(f: Franchise, teams: Team[]): Franchise;
  awards(f: Franchise, teams: Team[]): Award[];
  goals(f: Franchise, teams: Team[]): OwnerGoal[];
  settingsOptions: { games: number[]; fields: SettingsField[] };
}

export function leagueModule(id: LeagueId): LeagueModule {
  if (id === "pro") return proLeague;
  if (id === "college") return collegeLeague;
  throw new Error(`Franchise doesn't support the ${id} league yet.`);
}

const LEAGUE_MINUTES: Record<LeagueId, number> = { pro: 12 * 4, college: 20 * 2, hs: 8 * 4 };

/** Player minutes in a full game: five players for the whole game. */
export const totalMinutes = (f: Pick<Franchise, "league">) => LEAGUE_MINUTES[f.league] * 5;
