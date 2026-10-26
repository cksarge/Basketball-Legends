// Match state shared by the simulation, AI, renderer and HUD.
import type { BallPhys } from "../ball";
import type { CourtSpec } from "../court";
import type { V2 } from "../vec";
import type { LeagueRules, Player, Team, TeamTactics } from "@/engine/types";

export type TeamIdx = 0 | 1;

export type ActionKind =
  | "idle" | "move" | "stance"
  | "dribbleMove" | "gather" | "jumper" | "layup" | "dunk" | "floater" | "hook" | "fadeaway"
  | "pass" | "catch" | "block" | "steal" | "rebound" | "post" | "screen" | "fall"
  | "celebrate" | "inbound" | "freeThrow" | "jumpball" | "dejected" | "bench";

export type DribbleMoveKind = "crossover" | "behindBack" | "spin" | "hesitation" | "stepback" | "betweenLegs";
export type ShotKind = "jumper" | "layup" | "dunk" | "floater" | "hook" | "fadeaway" | "freeThrow" | "tip";

export interface ActionState {
  kind: ActionKind;
  t: number; // elapsed
  dur: number; // total duration (0 = indefinite)
  /** Free-form per-action data (shot meter, move direction, target, ...). */
  data: Record<string, number | string | boolean | undefined>;
}

export interface Agent {
  /** Index 0..9 (team0: 0-4, team1: 5-9 are the on-court slots). */
  idx: number;
  team: TeamIdx;
  player: Player;
  pos: V2;
  vel: V2;
  facing: number; // radians, 0 = +Z
  y: number; // feet height above floor (jumping)
  vy: number;
  action: ActionState;
  stamina: number; // 0..1
  fatigueDebt: number; // accumulated over the game, recovers on bench
  /** Desired movement (set by AI/human each frame). */
  intent: AgentIntent;
  /** Seconds standing in the offensive lane (3-second rule). */
  laneTime: number;
  /** For defense: index of agent being guarded. */
  guarding: number | null;
  /** Human controller index (0..3) or null for AI. */
  human: number | null;
  /** Visual-only: last dribble hand (1 = right, -1 = left). */
  hand: 1 | -1;
  /** Seconds the ball handler has been holding without dribbling (5-sec / pickup). */
  holdTime: number;
  /** True after picking up the dribble (can't dribble again until pass/shot). */
  pickedUp: boolean;
  /** Momentum stun after being crossed (ankle breaker), seconds. */
  stun: number;
  /** Hot/cold streak modifier, -1..1. */
  heat: number;
  /** In-game gameplan role for AI. */
  role: "ball" | "wing" | "corner" | "post" | "slot";
}

export interface AgentIntent {
  moveX: number; // -1..1 world space desired direction
  moveZ: number;
  sprint: boolean;
  /** Face this point if set (else movement direction). */
  faceX?: number;
  faceZ?: number;
  /** Discrete action requested this frame (consumed by the sim). */
  act?: IntentAct;
}

export type IntentAct =
  | { type: "shoot"; phase: "press" | "release" }
  | { type: "pass"; to: number; kind: "chest" | "bounce" | "lob" | "alley" }
  | { type: "dribbleMove"; move: DribbleMoveKind; dir: number }
  | { type: "steal" }
  | { type: "block" }
  | { type: "rebound" }
  | { type: "post"; on: boolean }
  | { type: "callScreen" }
  | { type: "drive" }
  | { type: "pumpFake" }
  | { type: "takeCharge" };

export type BallMode = "held" | "dribble" | "shot" | "pass" | "loose" | "dead" | "ft";

export interface ShotInfo {
  shooter: number;
  team: TeamIdx;
  kind: ShotKind;
  points: 2 | 3 | 1;
  willMake: boolean;
  contest: number; // 0..1
  quality: number; // timing quality -1..1 (0 perfect) or NaN for AI
  fouled: boolean;
  fromX: number;
  fromZ: number;
  blocked: boolean;
  assistFrom: number | null;
  releaseTime: number;
  side: 1 | -1;
}

export interface PassInfo {
  from: number;
  to: number;
  kind: "chest" | "bounce" | "lob" | "alley";
  target: V2;
  t: number;
  dur: number;
  /** Defenders that already had their interception roll. */
  rolled: number[];
}

export interface BallState {
  phys: BallPhys;
  mode: BallMode;
  owner: number | null;
  /** Team that last had possession / touched (for out of bounds). */
  lastTouch: TeamIdx;
  lastToucher: number | null;
  shot: ShotInfo | null;
  pass: PassInfo | null;
  /** Dribble animation phase 0..1. */
  dribblePhase: number;
  /** Agent who threw the last completed pass (for assists) and when. */
  lastPasser: number | null;
  lastPassTime: number;
  /** Why the ball last became loose (diagnostics / commentary). */
  looseCause?: string;
}

export type Phase =
  | "pregame" | "jumpball" | "live" | "deadball" | "inbound" | "freethrows"
  | "timeout" | "periodEnd" | "halftime" | "final";

export interface FreeThrowState {
  shooter: number;
  team: TeamIdx;
  total: number;
  made: number;
  attempt: number; // 1-based current attempt
  oneAndOne: boolean;
  /** After FTs, does the shooting team keep possession (e.g. flagrant)? */
  keepPossession: boolean;
}

export interface InboundState {
  team: TeamIdx;
  spot: V2;
  inbounder: number;
  timer: number; // 5-second count
  afterScore: boolean;
  backcourt: boolean;
}

export interface TeamGameState {
  team: Team;
  roster: Player[];
  /** Player ids currently on court in slot order. */
  onCourt: string[];
  score: number;
  periodScores: number[];
  fouls: number; // team fouls this period (or half for college)
  timeouts: number;
  tactics: TeamTactics;
  /** Basket this team attacks in the current half. */
  attackSide: 1 | -1;
  humanControlled: boolean;
  /** Seconds on court for fatigue per player id. */
  minutes: Record<string, number>;
  /** Coach-set rotation: target minutes per player id. */
  rotation: Record<string, number>;
  playCall: string | null;
}

export interface MatchConfig {
  league: import("@/engine/types").LeagueId;
  rules: LeagueRules;
  court: CourtSpec;
  quarterMinutes: number;
  difficulty: Difficulty;
  shotMeter: boolean;
  fatigue: boolean;
  injuries: boolean;
  fouls: boolean;
  /** 0..2 slider multipliers. */
  sliders: GameplaySliders;
  seed: number;
  /** If true the sim runs without presentation pauses (headless / instant). */
  fast: boolean;
  /** Keep human ball handlers from accidentally stepping out of bounds. */
  boundaryAssist: boolean;
}

export type Difficulty = "rookie" | "pro" | "allstar" | "superstar" | "hof" | "legend";

export interface GameplaySliders {
  shotSuccess: number;
  threeSuccess: number;
  layupSuccess: number;
  passAccuracy: number;
  stealSuccess: number;
  blockSuccess: number;
  foulFrequency: number;
  speed: number;
  injuryRate: number;
  aiAggression: number;
}

export const DEFAULT_SLIDERS: GameplaySliders = {
  shotSuccess: 1, threeSuccess: 1, layupSuccess: 1, passAccuracy: 1, stealSuccess: 1,
  blockSuccess: 1, foulFrequency: 1, speed: 1, injuryRate: 1, aiAggression: 1,
};

export const DIFFICULTY_LEVELS: { id: Difficulty; label: string; user: number; cpu: number }[] = [
  { id: "rookie", label: "Rookie", user: 1.18, cpu: 0.82 },
  { id: "pro", label: "Pro", user: 1.08, cpu: 0.92 },
  { id: "allstar", label: "All-Star", user: 1.0, cpu: 1.0 },
  { id: "superstar", label: "Superstar", user: 0.95, cpu: 1.05 },
  { id: "hof", label: "Hall of Fame", user: 0.9, cpu: 1.1 },
  { id: "legend", label: "Legend", user: 0.85, cpu: 1.15 },
];
