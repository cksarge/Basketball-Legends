// Semantic game events emitted by the match for commentary, audio, HUD and stats.
import type { ShotKind, TeamIdx } from "./state";

export type GameEvent =
  | { t: "jumpball"; winner: TeamIdx }
  | { t: "shot"; shooter: number; kind: ShotKind; points: number; distance: number; contested: number }
  | { t: "make"; shooter: number; kind: ShotKind; points: number; assist: number | null; andOne: boolean; distance: number; swish: boolean }
  | { t: "miss"; shooter: number; kind: ShotKind; points: number; distance: number }
  | { t: "block"; blocker: number; shooter: number }
  | { t: "rebound"; player: number; offensive: boolean }
  | { t: "steal"; player: number; from: number }
  | { t: "turnover"; player: number; reason: TurnoverReason }
  | { t: "foul"; player: number; on: number; kind: FoulKind; shooting: boolean; fts: number }
  | { t: "freeThrow"; shooter: number; made: boolean; attempt: number; total: number }
  | { t: "violation"; team: TeamIdx; kind: ViolationKind; player: number | null }
  | { t: "pass"; from: number; to: number; kind: string }
  | { t: "dribbleMove"; player: number; move: string; broke: number | null }
  | { t: "sub"; team: TeamIdx; in: string; out: string }
  | { t: "timeout"; team: TeamIdx; remaining: number }
  | { t: "periodStart"; period: number }
  | { t: "periodEnd"; period: number }
  | { t: "final"; winner: TeamIdx }
  | { t: "rimHit"; speed: number }
  | { t: "boardHit"; speed: number }
  | { t: "floorBounce"; speed: number }
  | { t: "swish" }
  | { t: "buzzer"; kind: "shotClock" | "period" }
  | { t: "crowd"; level: number }
  | { t: "injury"; player: number; name: string; games: number }
  | { t: "foulOut"; player: number };

export type TurnoverReason = "steal" | "badPass" | "outOfBounds" | "travel" | "offensiveFoul" | "shotClock" | "threeSeconds" | "backcourt" | "tenSeconds" | "fiveSeconds" | "lostBall";
export type FoulKind = "shooting" | "reach" | "blocking" | "charge" | "loose" | "intentional";
export type ViolationKind = "shotClock" | "threeSeconds" | "backcourt" | "tenSeconds" | "eightSeconds" | "fiveSeconds" | "outOfBounds" | "travel" | "goaltending" | "laneViolation";
