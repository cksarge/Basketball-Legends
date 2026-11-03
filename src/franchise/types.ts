// The Franchise save format: one persistent league, its players and the season in progress.
import type { Bracket, IsoDate, ProSeries, ScheduledGame } from "@/career/types";
import type { CareerLine, CollegeDivision, LeagueId, Player, PlayerFile, Position, TeamTactics } from "@/engine/types";
import type { Difficulty } from "@/game/sim/state";
import type { BoxScore, StatLine } from "@/game/sim/stats";
import type { SigningVia } from "./pro/cap";
import type { Offer } from "./pro/market";
import type { TradeOffer } from "./pro/tradeAi";
import type { TradeAsset } from "./pro/trades";

export const FRANCHISE_VERSION = 5;

export type { CareerLine, PlayerFile };

export type FranchisePhase = "regular" | "playIn" | "playoffs" | "offseason";

export interface FranchiseSettings {
  /** Quarter length in played games. Simulated games always run at the league's full length. */
  quarterMinutes: number;
  difficulty: Difficulty;
  /** "Close games only": the fourth-quarter margin that counts as close. */
  closeGameMargin: number;
  /** Sims the user's games to the last period, and stops only if they're close. */
  closeGamesOnly: boolean;
  /** Systems that run themselves. */
  auto: Record<AutoKey, boolean>;
  league: LeagueSettings;
  /** League changes that wait for next season. */
  pendingLeague?: LeagueSettings;
}

export type AutoKey = "tactics" | "practice" | "scouting" | "draft" | "contracts" | "freeAgency" | "trades" | "finances" | "roster" | "recruiting" | "squads";

export interface LeagueSettings {
  /** The choices come from the league module. */
  gamesPerSeason: number;
  playoffFormat: {
    firstRoundBestOf: 5 | 7;
    playIn: boolean;
    conferenceTournaments?: boolean;
    nationalField?: 68 | 64;
    openDivision?: boolean;
  };
  tradeDifficulty: "easy" | "normal" | "hard";
  injuries: "off" | "fewer" | "normal" | "more";
  progression: "slow" | "normal" | "fast";
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
  /** College and high school tournaments. Pro uses series. */
  brackets: Bracket[];
  /** Teams outside the user's world, decided on team strength. */
  outside?: OutsideSeason;
  /** Regular season totals by player id. */
  stats: Record<string, SeasonLine>;
  playoffStats: Record<string, SeasonLine>;
  awards: Award[];
  championId?: string;
  /** Who was on the champion when the title was won. */
  championRoster?: string[];
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

export interface DraftPick {
  id: string;
  /** The June the draft happens. */
  year: number;
  round: 1 | 2;
  originalTeamId: string;
  ownerId: string;
}

/** Money still owed to a player who's gone. */
export interface DeadCap {
  playerId: string;
  name: string;
  salary: number;
  years: number;
}

export interface CapState {
  year: number;
  salaryCap: number;
}

export interface TeamBooks {
  dead: DeadCap[];
  midLevelUsed: number;
  biannualYear?: number;
}

export type OffseasonStep =
  "review" | "progress" | "lottery" | "draft" | "contracts" | "freeAgency" | "camp" | "declarations" | "portal" | "signing" | "tryouts";

export interface ProgressReport {
  retired: string[];
  /** Where each retired player finished. */
  lastTeams: Record<string, string | null>;
  changes: { id: string; before: number; after: number }[];
}

export interface OffseasonState {
  step: OffseasonStep;
  report: ProgressReport | null;
}

export interface DraftState {
  year: number;
  prospects: Player[];
  /** Scouting points per prospect. */
  scouting: Record<string, number>;
  assigned: string[];
  /** Pick ids in draft order. */
  order?: string[];
  lottery?: { teamId: string; from: number; to: number }[];
  results: { pickId: string; playerId: string; teamId: string }[];
}

export interface WaiverEntry {
  playerId: string;
  fromTeamId: string;
  until: IsoDate;
}

export interface FreeAgencyState {
  stage: "moratorium" | "bidding" | "open";
  round: number;
  /** The user's bids that are still alive. */
  bids: (Offer & { playerId: string })[];
  signed: { playerId: string; teamId: string; salary: number; years: number; round: number; via: SigningVia }[];
  /** What happened to the user's bids in the last round. */
  notices: string[];
}

/** What it takes to reverse the last roster move. */
export interface UndoRecord {
  label: string;
  before: Partial<Franchise>;
  players: Record<string, Player | null>;
}

export interface RetiredPlayer {
  id: string;
  name: string;
  pos: Position;
  year: number;
  age: number;
  peak: number;
  lastTeamId: string | null;
  career?: CareerLine;
  awards?: number;
  titles?: number;
}

export type BudgetKey = "coaching" | "scouting" | "facilities";

export interface TeamFinance {
  ticketPrice: number;
  budgets: Record<BudgetKey, number>;
  /** 0..100, built slowly by the facilities budget. */
  facilities: number;
  /** 0..100, fan interest. */
  hype: number;
  balance: number;
  season: { revenue: number; expenses: number; attendance: number; homeGames: number };
  lastSeason?: { revenue: number; expenses: number; profit: number; attendance: number };
}

export interface OwnerGoal {
  key: "winning" | "profit" | "development" | "postseason" | "recruiting";
  target: number;
}

export type Grade = "A" | "B" | "C" | "D" | "F";

export interface OwnerReview {
  year: number;
  grades: Partial<Record<OwnerGoal["key"], Grade>>;
  change: number;
  note: string;
}

export interface JobStint {
  teamId: string;
  league: LeagueId;
  division?: CollegeDivision;
  from: number;
  to?: number;
  w: number;
  l: number;
  titles: number;
}

export interface JobState {
  security: number;
  goals: OwnerGoal[];
  /** Seasons finished for this owner. */
  seasons: number;
  reviews: OwnerReview[];
  stints: JobStint[];
  fired?: { year: number; teamId: string };
}

export interface NewsItem {
  id: string;
  date: IsoDate;
  kind: "trade" | "signing" | "injury" | "milestone" | "upset" | "award" | "draft" | "retirement" | "job";
  text: string;
  teamIds: string[];
}

export interface HallEntry {
  id: string;
  name: string;
  pos: Position;
  year: number;
  score: number;
  career: CareerLine;
  awards: number;
  titles: number;
  lastTeamId: string | null;
}

export interface LeagueRecord {
  key: string;
  label: string;
  value: number;
  playerId: string;
  name: string;
  year: number;
}

export interface SeasonSummary {
  year: number;
  championId?: string;
  record: { w: number; l: number };
  awards: (Award & { name: string })[];
}

/** Games and brackets for teams outside the user's world. */
export interface OutsideSeason {
  games: ScheduledGame[];
  brackets: Bracket[];
}

/** Which league, and in college which division, the save is running. */
export interface WorldRef {
  league: LeagueId;
  division?: CollegeDivision;
}

/** A league the coach worked in before, kept for history. */
export interface FormerWorld extends WorldRef {
  from: number;
  to: number;
  teamIds: string[];
  history: SeasonSummary[];
  hall: HallEntry[];
  records: LeagueRecord[];
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
  world: WorldRef;
  formerWorlds: FormerWorld[];
  /** Conference names, for college and high school tournaments. */
  conferences?: Record<string, { name: string; short: string }>;
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
  cap: CapState;
  picks: DraftPick[];
  books: Record<string, TeamBooks>;
  freeAgents: string[];
  /** Team id -> developmental players, who are outside the roster. */
  devRosters: Record<string, string[]>;
  waivers: WaiverEntry[];
  draft: DraftState;
  /** Set during the offseason. */
  offseason?: OffseasonState;
  freeAgency?: FreeAgencyState;
  undo?: UndoRecord;
  tradeBlock: string[];
  tradeOffers: TradeOffer[];
  /** Trades around the league. */
  tradeLog: { date: IsoDate; teams: string[]; assets: TradeAsset[] }[];
  finance: Record<string, TeamFinance>;
  job: JobState;
  news: NewsItem[];
  hall: HallEntry[];
  records: LeagueRecord[];
  /** Team id -> power rank a week ago. */
  powerLast: Record<string, number>;
  /** Each AI team's system for the season. */
  aiTactics: Record<string, TeamTactics>;
  /** League revenue per cap dollar last season. */
  revenueBase?: number;
  /** How that changed, which sets the next cap. */
  revenueGrowth?: number;
  /** Player id -> tries used in contract talks this year. */
  talks: Record<string, number>;
  retired: RetiredPlayer[];
  history: SeasonSummary[];
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
