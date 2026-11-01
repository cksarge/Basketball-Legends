// Career mode save format. Pure data (JSON-serializable) so it can live in IndexedDB,
// be exported as a .blcareer file, and be used by the engine in tests and workers.
import type { ClassYear, Player, Position, Archetype, Appearance, RatingKey, Ratings, TeamLevel } from "@/engine/types";
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

export type GameKind = "nonregion" | "region" | "tournament" | "playoff" | "scrimmage" | "allstar";

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
  /** Where you're going: chosen before graduation, on scholarship or as a walk-on. */
  college?: { teamId: string; walkOn: boolean; date: IsoDate };
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

/** How the coach uses you: decided by your overall and how much the coach trusts you. */
export type CollegeRole = "starter" | "rotation" | "bench";

export interface NilDeal {
  id: string;
  brand: string;
  kind: "local" | "national" | "community";
  /** Paid once when you sign. */
  amount: number;
  status: "open" | "signed" | "declined";
}

export interface DraftStock {
  /** 1 is the top pick; above 60 means you'd likely go undrafted. */
  pick: number;
  label: string;
  score: number;
}

export interface PortalOffer {
  teamId: string;
  role: string;
  nil: number;
}

export interface CollegeSeason {
  /** Fall year of the season (2030 for 2030-31). */
  year: number;
  classYear: ClassYear;
  teamId: string;
  tier: string;
  walkOn: boolean;
  /** Sits the season out: you practice and develop without using a year of eligibility. */
  redshirt?: boolean;
  /** How much the coach trusts you (0..100). Performance moves it; it sets your role and minutes. */
  trust: number;
  role: CollegeRole;
  /** Your teammates, without your player (added at runtime). */
  roster: Player[];
  /** Every game in your division while the season runs; trimmed to yours and the postseason when it ends. */
  games: ScheduledGame[];
  stats: StatLine & { gp: number; gs: number };
  awards: string[];
  nil: NilDeal[];
  /** Conference tournaments, then the national tournament and the invitational. */
  brackets?: Bracket[];
  /** How your season ended ("Lost in the Regional Final"). */
  finish?: string;
  conferenceTable?: { teamId: string; w: number; l: number; rw: number; rl: number }[];
  /** Your team's final rank in the division. */
  teamRank?: number;
  stock?: DraftStock;
  wrapped?: boolean;
  /** What you decided after the season. */
  decision?: "return" | "portal" | "declare";
  portalOffers?: PortalOffer[];
}

export interface CollegeCareer {
  seasons: CollegeSeason[];
  /** NIL money earned so far. */
  earnings: number;
  /** Where you're playing next, after a transfer. */
  transferTo?: string;
  /** Went to the portal and came back: the coach starts next season trusting you a little less. */
  withdrewPortal?: boolean;
  /** Declared for the draft. */
  declared?: { date: IsoDate; stock: DraftStock };
}

export type AgentId = "shark" | "brand" | "family";

export interface PreDraft {
  year: number;
  agent?: AgentId;
  /** Combine results. */
  combine?: { scores: number[]; bonus: number; verticalIn: number; laneSec: number; threesMade: number };
  /** Teams you've worked out for, and how each one came away feeling (added to its draft board). */
  workouts: { teamId: string; grade: number; note: string }[];
  /** Answers to GM interview questions (index of the answer picked). */
  interviews: number[];
  /** How the pre-draft process has moved your draft stock. */
  stockDelta: number;
}

export interface DraftPick {
  round: 1 | 2;
  /** Overall pick number. */
  pick: number;
  teamId: string;
  /** The team that owned the pick before a draft-night trade. */
  via?: string;
  name: string;
  pos: string;
  ovr: number;
  isUser?: boolean;
}

export interface DraftNight {
  year: number;
  picks: DraftPick[];
  trades: string[];
  /** The team that traded for your rights after picking you. */
  tradedTo?: string;
  /** The team you end up on, or null if you went undrafted. */
  teamId: string | null;
  /** You've watched the night through. */
  seen?: boolean;
}

export type ProRole = "starter" | "sixth" | "rotation" | "bench";

/** A playoff series: best of 7, or a single play-in game. */
export interface ProSeries {
  id: string;
  conf: "East" | "West" | "Finals";
  /** 0 = play-in, 1-3 = conference rounds, 4 = the Finals. */
  round: number;
  label: string;
  high: string;
  low: string;
  bestOf: number;
  start: IsoDate;
  games: string[];
  winner?: string;
}

export interface Endorsement {
  brand: string;
  perYear: number;
  years: number;
}

export interface ContractOffer {
  teamId: string;
  salary: number;
  years: number;
  role: ProRole;
  /** The team promises this role; breaking it frees you to ask out. */
  promise: boolean;
  /** You pushed for more and they walked away. */
  pulled?: boolean;
  /** Already raised once in negotiation. */
  raised?: boolean;
  /** Another year with the development team, not a league contract. */
  dev?: boolean;
}

export interface ProSeason {
  year: number;
  teamId: string;
  status: "standard" | "twoWay" | "dev";
  role: ProRole;
  /** How much the coach trusts you (0..100). */
  trust: number;
  /** How well the team gets along (0..100); adds to the team's strength. */
  chemistry: number;
  roster: Player[];
  /** Every league game while the season runs; trimmed to yours and the playoffs when it ends. */
  games: ScheduledGame[];
  /** Your development league games, if you're there. */
  devGames?: ScheduledGame[];
  stats: StatLine & { gp: number; gs: number };
  playoffStats: StatLine & { gp: number; gs: number };
  awards: string[];
  series: ProSeries[];
  injury?: { name: string; left: number };
  promise?: { role: ProRole; broken?: boolean };
  tradeRequested?: boolean;
  allStar?: { decided: boolean; selected: boolean; threeScore?: number; threeWon?: boolean; mvp?: boolean };
  /** How the season ended ("Lost in the East Semifinals"). */
  finish?: string;
  standings?: { teamId: string; w: number; l: number }[];
  seed?: number;
  wrapped?: boolean;
}

export interface ProCareer {
  preDraft: PreDraft;
  draft?: DraftNight;
  /** Where you stand with the league after the draft. */
  status?: "standard" | "twoWay" | "dev";
  /** Two-way offers if you went undrafted. */
  undraftedOffers?: string[];
  /** Personality from interviews: -1..1. */
  confidence: number;
  teamFirst: number;
  /** After the agent's cut. */
  earnings: number;
  seasons: ProSeason[];
  /** The year your last training camp was for. */
  trainedFor?: number;
  offers?: ContractOffer[];
  endorsements: Endorsement[];
  endorsementOffers?: Endorsement[];
}

/** What one answer or decision does to you. */
export interface StoryEffect {
  /** Humble (-) to confident (+). */
  confident?: number;
  /** Team-first (-) to star (+). */
  star?: number;
  fans?: number;
  media?: number;
  teammates?: number;
  coach?: number;
  /** Legend points for Impact. */
  impact?: number;
  impactText?: string;
}

export interface StoryChoice extends StoryEffect {
  text: string;
  reply: string;
}

/** Something waiting on your answer: a press conference, or a decision. */
export interface StoryEvent {
  id: string;
  date: IsoDate;
  kind: "press" | "choice";
  title: string;
  from?: string;
  body: string;
  choices: StoryChoice[];
}

export interface PhoneText {
  date: IsoDate;
  mine?: boolean;
  text: string;
}

export interface SocialPost {
  date: IsoDate;
  author: string;
  handle: string;
  text: string;
  likes: number;
}

export interface Rival {
  name: string;
  pos: string;
  teamId: string;
  /** Your games against them. */
  wins: number;
  losses: number;
}

export interface StoryState {
  /** Humble (-1) to confident (1). */
  confident: number;
  /** Team-first (-1) to star (1). */
  star: number;
  /** Your standing, 0..100. */
  fans: number;
  media: number;
  teammates: number;
  coach: number;
  mentor: string;
  rival: Rival;
  pending: StoryEvent[];
  threads: Record<string, PhoneText[]>;
  /** Threads with texts you haven't opened. */
  unread: string[];
  feed: SocialPost[];
  impact: { date: IsoDate; text: string; points: number }[];
  /** How far the story has read the career log and your games. */
  logSeen: number;
  gamesSeen: number;
  /** Seasons that have had a media day. */
  mediaDays: string[];
  /** Every event that has been used, so scripted ones happen once and random ones don't repeat too soon. */
  used: string[];
  ticks: number;
}

export interface CareerTotals {
  games: number;
  pts: number;
  reb: number;
  ast: number;
  rings: number;
  mvps: number;
  allStars: number;
}

/** The end of a career: the ceremonies and the verdict. */
export interface Retirement {
  date: IsoDate;
  age: number;
  totals: CareerTotals;
  points: number;
  /** Your final rank; "Legend" only for an Icon past the bar. */
  rank: string;
  legend: boolean;
  hallOfFame: boolean;
  /** Schools and teams that hang your number. */
  jerseys: string[];
  speech: string;
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
  college?: CollegeCareer;
  pro?: ProCareer;
  retirement?: Retirement;
  story?: StoryState;
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
