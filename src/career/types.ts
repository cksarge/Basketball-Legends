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
  /** Natural development has been applied up to this date. */
  devDate?: IsoDate;
  /** Aptitude in the classroom (0..1), set in the creator. */
  academics: number;
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
  /** Played at a neutral site (state championship games). */
  neutral?: boolean;
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
  /** Semester GPAs (0-4.0), set at finals. */
  grades: { fall?: number; spring?: number };
  /** How you split your time: 0 = all basketball, 1 = all school. Shapes practice XP and grades. */
  focus: number;
  /** Fall grades below 2.0 keep you out of games from this date until spring grades. */
  ineligibleFrom?: IsoDate;
  /** Summer after the season: the camp you went to and your AAU showcase games. */
  summer?: SummerPlan;
  /** Recruiting snapshot, refreshed after each season and summer event. */
  ranking?: RecruitRanking;
  /** Awards handed out and the season trimmed; the summer comes next. */
  wrapped?: boolean;
  /** State playoff brackets (Open Division and each class), created when the regular season ends. */
  playoffs?: Bracket[];
  /** Final region table, kept when a finished season is trimmed to your school's games. */
  regionTable?: { teamId: string; w: number; l: number; rw: number; rl: number }[];
}

export interface SummerPlan {
  camp?: { id: string; name: string; boosts: Partial<Record<RatingKey, number>>; exposure: number };
  /** AAU club you play for and its showcase games (synthetic teams, see hs/summer.ts). */
  club?: { name: string; elite: boolean };
  showcase?: ScheduledGame[];
  done?: boolean;
}

export interface RecruitRanking {
  date: IsoDate;
  /** 1-5; 0 = not rated. */
  stars: number;
  /** National rank in your class, or null when unranked. */
  national: number | null;
  state: number | null;
  /** The score scouts rank on (projected senior overall + production + exposure). */
  score: number;
  /** Exposure from camps and showcases (0..4). */
  exposure: number;
}

export type OfferStatus = "interested" | "offered" | "committed" | "signed" | "withdrawn";

export interface Offer {
  teamId: string;
  /** When the program first reached out. */
  date: IsoDate;
  status: OfferStatus;
  /** How much the program wants you (0..100). */
  interest: number;
  /** How much you like the program (0..100); visits and your choices move it. */
  myInterest: number;
  /** Projected NIL value per year, in dollars (D1 only). */
  nil: number;
  /** What the coaches pitch for your first season. */
  role: string;
  visited?: boolean;
  /** Your own shortlist. */
  favorite?: boolean;
}

export interface Recruiting {
  offers: Offer[];
  visitsUsed: number;
  /** Official visits allowed (NCAA: five). */
  visitsAllowed: number;
  committedTo?: string;
  commitDate?: IsoDate;
  signedDate?: IsoDate;
  /** Graduating a year early (skips senior year). */
  reclassified?: boolean;
  /** Last date offers were refreshed. */
  updated?: IsoDate;
}

export interface Bracket {
  id: string;
  name: string;
  /** Teams in seed order (best first). With a play-in, seeds 9-24 play in for the last eight spots. */
  seeds: string[];
  playIn: boolean;
  /** Game ids per round, in bracket order. */
  rounds: string[][];
  champion?: string;
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
  /** College recruiting, from the summer after sophomore year until you sign. */
  recruiting?: Recruiting;
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
  /** Classroom aptitude 0..1 (struggling 0.3, average 0.6, honor roll 0.85). */
  academics?: number;
  settings: CareerSettings;
  startYear: number;
}
