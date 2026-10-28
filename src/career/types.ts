// Career mode save format. Pure data (JSON-serializable) so it can live in IndexedDB,
// be exported as a .blcareer file, and be used by the engine in tests and workers.
import type { Player, Position, Archetype, Appearance, RatingKey, Ratings, TeamLevel } from "@/engine/types";
import type { StatLine } from "@/game/sim/stats";
import type { Difficulty } from "@/game/sim/state";

export const CAREER_VERSION = 1;

/** Calendar date as "YYYY-MM-DD". */
export type IsoDate = string;

export type CareerStage = "hs" | "college" | "pro" | "retired";
/** The level a high school player is on. */
export type HsLevel = Exclude<TeamLevel, "jv2">;

export type BenchChoice = "ask" | "watch" | "skip" | "sim";

export interface CareerSettings {
  difficulty: Difficulty;
  /** Quarter length for played games, in minutes (sims always use full league rules). */
  quarterMinutes: number;
  /** What to do when your player goes to the bench in a played game. */
  bench: BenchChoice;
  /** How often story events, texts and media moments show up. */
  storyFrequency: "low" | "normal" | "high";
}

/** The body choices made in the creator. Adult height is what the player grows into by 18. */
export interface BodySpec {
  adultHeightIn: number;
  weightLb: number;
  wingspanIn: number;
}

export interface CareerPlayer extends Player {
  isUser: true;
  body: BodySpec;
  /** Highest value each rating can ever reach, set by position, archetype and body. */
  caps: Ratings;
  /** Unspent skill points earned from XP. */
  skillPoints: number;
  /** XP toward the next skill point. */
  xp: number;
  /** Age in years on the career start date. */
  birthYear: number;
}

export type GameKind = "nonregion" | "region" | "tournament" | "playoff" | "scrimmage";

export interface ScheduledGame {
  id: string;
  date: IsoDate;
  level: HsLevel | "college" | "pro";
  homeId: string;
  awayId: string;
  kind: GameKind;
  /** Bracket or tournament round label ("Quarterfinal", "Holiday Classic, game 2"). */
  label?: string;
  result?: GameResult;
}

export interface GameResult {
  home: number;
  away: number;
  /** Played in 3D (true) or simulated. */
  played: boolean;
  overtimes: number;
  /** Your player's line, when the game involved your team. */
  userLine?: StatLine;
  /** Your player did not play (bench, injury, not on this level's roster yet). */
  dnp?: boolean;
  /** Box score for your team only (player id -> line), kept for the game log. */
  box?: Record<string, StatLine>;
  playerOfGame?: string | null;
}

export interface TryoutResult {
  date: IsoDate;
  /** 0..100 tryout score from the drills. */
  score: number;
  level: HsLevel;
  /** Coach's note shown in the hub. */
  note: string;
}

export interface LevelMove {
  date: IsoDate;
  from: HsLevel;
  to: HsLevel;
  reason: string;
}

export interface HsSeason {
  /** Fall year of the school year (2026 for 2026-27). */
  year: number;
  grade: 9 | 10 | 11 | 12;
  schoolId: string;
  level: HsLevel;
  tryout?: TryoutResult;
  moves: LevelMove[];
  /** Your school's rosters by level, without your player (added at runtime). */
  rosters: Partial<Record<HsLevel, Player[]>>;
  /** Your school's games at every level it fields, plus every varsity game in the classification for standings. */
  games: ScheduledGame[];
  /** Totals for your player at each level this season. */
  stats: Partial<Record<HsLevel, StatLine & { gp: number; gs: number }>>;
  awards: string[];
  gpa?: number;
}

export interface InboxMessage {
  id: string;
  date: IsoDate;
  from: string;
  subject: string;
  body: string;
  read: boolean;
}

export interface CareerLogEntry {
  date: IsoDate;
  text: string;
  kind: "milestone" | "award" | "move" | "game" | "story";
}

export interface Career {
  version: typeof CAREER_VERSION;
  id: string;
  createdAt: number;
  updatedAt: number;
  seed: number;
  stage: CareerStage;
  date: IsoDate;
  /** Fall year of freshman year. */
  startYear: number;
  player: CareerPlayer;
  settings: CareerSettings;
  hs: { schoolId: string; seasons: HsSeason[] };
  inbox: InboxMessage[];
  log: CareerLogEntry[];
}

/** What the career select screen shows without loading the whole save. */
export interface CareerSummary {
  id: string;
  name: string;
  updatedAt: number;
  createdAt: number;
  stage: CareerStage;
  date: IsoDate;
  teamName: string;
  pos: Position;
  archetype: Archetype;
  ovr: number;
  jersey: number;
  appearance: Appearance;
  primary: string;
}

export interface CreatorInput {
  firstName: string;
  lastName: string;
  pos: Position;
  archetype: Archetype;
  body: BodySpec;
  appearance: Appearance;
  jersey: number;
  hometown: string;
  schoolId: string;
  /** Starting skill points the player spent in the creator. */
  allocation: Partial<Record<RatingKey, number>>;
  settings: CareerSettings;
  startYear: number;
}
