"use client";
import { create } from "zustand";
import type { LeagueId, Player, Team, TeamTactics } from "@/engine/types";
import type { UniformStyle } from "@/game3d/character/uniformTexture";
import type { ArenaKind } from "@/game3d/Arena";
import type { BoxScore } from "@/game/sim/stats";
import type { InjuryRecord, MatchState } from "@/game/sim/match";
import type { Difficulty, ParkRules } from "@/game/sim/state";

/** Links a match to a career game so the result can be recorded when it ends. */
export interface CareerGameRef {
  careerId: string;
  gameId: string;
}

export type MatchMode = "quick" | "career" | "franchise" | "practice" | "online" | "park";

/** A Play in the Park game: which park, what's being played, and everyone's street clothes. */
export interface ParkSession {
  parkId: string;
  mode: "pickup" | "line" | "21" | "horse" | "three";
  /** Team games and 21. */
  rules?: ParkRules;
  /** HORSE: the word to spell (HORSE or PIG). */
  word?: string;
  /** Shirt and shorts colors per player id. */
  outfits: Record<string, { shirt: string; shorts: string }>;
  /** Team games: everyone on a side wears that side's shirt color. */
  sideShirts?: [string, string];
  /** 3-point contest: rivals whose rounds are simulated. */
  rivals?: Player[];
}

export interface SideSetup {
  team: Team;
  roster: Player[];
  uniform: UniformStyle;
  tactics?: Partial<TeamTactics>;
  /** Controller devices assigned to this side ("keyboard", "pad0", ...). */
  controllers: string[];
  starters?: string[];
}

export interface PendingMatch {
  mode: MatchMode;
  league: LeagueId;
  home: SideSetup;
  away: SideSetup;
  arena: ArenaKind;
  quarterMinutes: number;
  /** For career mode: lock control to this player id. */
  lockPlayerId?: string;
  /** Where to go after the game. */
  returnTo: string;
  seed: number;
  /** Optional label shown in the intro ("Region final", "Game 7"). */
  occasion?: string;
  /** Shootaround with no opponent or clock. */
  practice?: boolean;
  /** Continue the suspended game saved in local storage instead of starting fresh. */
  resume?: boolean;
  /** Guided controls tutorial (runs on top of a practice session). */
  tutorial?: boolean;
  /** Career game this match belongs to. */
  career?: CareerGameRef;
  /** Overrides the difficulty from Settings (careers have their own). */
  difficulty?: Difficulty;
  /** Career: what to do when the locked player goes to the bench. */
  bench?: "ask" | "watch" | "skip" | "sim";
  /** Play in the Park (arena "park"). */
  park?: ParkSession;
}

export interface MatchResult {
  mode: MatchMode;
  homeId: string;
  awayId: string;
  homeScore: number;
  awayScore: number;
  box: BoxScore;
  periods: number;
  playByPlay: MatchState["playByPlay"];
  playerOfGame: string | null;
  quarterMinutes: number;
  simulated: boolean;
  injuries: InjuryRecord[];
  career?: CareerGameRef;
  /** Park games: who won (for the next-game-up line) and the results shown on the park screen. */
  park?: { youWon: boolean; title: string; lines: { name: string; value: string; you?: boolean }[] };
}

interface MatchStore {
  pending: PendingMatch | null;
  lastResult: MatchResult | null;
  setPending: (p: PendingMatch | null) => void;
  setResult: (r: MatchResult | null) => void;
}

export const useMatchStore = create<MatchStore>((set) => ({
  pending: null,
  lastResult: null,
  setPending: (pending) => {
    set({ pending });
    try {
      if (pending) sessionStorage.setItem("bl-pending", JSON.stringify(pending));
    } catch {
      /* ignore */
    }
  },
  setResult: (lastResult) => set({ lastResult }),
}));

/** Restore a pending match after a page reload (session only). */
export function restorePending(): PendingMatch | null {
  try {
    const raw = sessionStorage.getItem("bl-pending");
    return raw ? (JSON.parse(raw) as PendingMatch) : null;
  } catch {
    return null;
  }
}

/** Snapshot of the live game for the DOM HUD (updated from the render loop). */
export interface HudSnapshot {
  homeScore: number;
  awayScore: number;
  period: number;
  periods: number;
  clock: number;
  shotClock: number | null;
  phase: string;
  homeFouls: number;
  awayFouls: number;
  homeTimeouts: number;
  awayTimeouts: number;
  possession: 0 | 1;
  bonus: [boolean, boolean];
  /** `green` is the half-height of the green band, in fill units (it matches the engine's window). */
  meter: { active: boolean; fill: number; ideal: number; green: number; result: "green" | "good" | "early" | "late" | null; side: 0 | 1 } | null;
  controlled: { name: string; number: number; stamina: number; team: 0 | 1 } | null;
}

export interface PlayBanner {
  id: number;
  title: string;
  sub?: string;
  color: string;
  accent: string;
}

/** Broadcast lower-third stat card ("SHEPHERD 18 PTS · 7/10 FG"). */
export interface StatOverlay {
  id: number;
  jersey: number;
  name: string;
  team: string;
  color: string;
  accent: string;
  lines: string[];
}

export const useHud = create<{
  hud: HudSnapshot | null;
  feed: { id: number; text: string; team: number | null }[];
  banner: PlayBanner | null;
  overlay: StatOverlay | null;
  set: (h: HudSnapshot) => void;
  showOverlay: (o: Omit<StatOverlay, "id">) => void;
  pushFeed: (text: string, team: number | null) => void;
  showBanner: (b: Omit<PlayBanner, "id">) => void;
}>((set) => ({
  hud: null,
  feed: [],
  banner: null,
  overlay: null,
  set: (hud) => set({ hud }),
  showOverlay: (o) => set({ overlay: { ...o, id: Date.now() + Math.random() } }),
  pushFeed: (text, team) => set((s) => ({ feed: [...s.feed.slice(-5), { id: Date.now() + Math.random(), text, team }] })),
  showBanner: (b) => set({ banner: { ...b, id: Date.now() + Math.random() } }),
}));
