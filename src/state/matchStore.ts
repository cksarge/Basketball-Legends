"use client";
import { create } from "zustand";
import type { LeagueId, Player, Team, TeamTactics } from "@/engine/types";
import type { UniformStyle } from "@/game3d/character/uniformTexture";
import type { ArenaKind } from "@/game3d/Arena";
import type { BoxScore } from "@/game/sim/stats";
import type { InjuryRecord, MatchState } from "@/game/sim/match";

export type MatchMode = "quick" | "career" | "franchise" | "practice" | "online";

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
    try { if (pending) sessionStorage.setItem("bl-pending", JSON.stringify(pending)); } catch { /* ignore */ }
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
  homeScore: number; awayScore: number;
  period: number; periods: number; clock: number; shotClock: number | null;
  phase: string;
  homeFouls: number; awayFouls: number;
  homeTimeouts: number; awayTimeouts: number;
  possession: 0 | 1;
  bonus: [boolean, boolean];
  meter: { active: boolean; fill: number; ideal: number; result: "green" | "good" | "early" | "late" | null; side: 0 | 1 } | null;
  controlled: { name: string; number: number; stamina: number; team: 0 | 1 } | null;
}

export interface PlayBanner { id: number; title: string; sub?: string; color: string; accent: string }

export const useHud = create<{
  hud: HudSnapshot | null;
  feed: { id: number; text: string; team: number | null }[];
  banner: PlayBanner | null;
  set: (h: HudSnapshot) => void;
  pushFeed: (text: string, team: number | null) => void;
  showBanner: (b: Omit<PlayBanner, "id">) => void;
}>((set) => ({
  hud: null,
  feed: [],
  banner: null,
  set: (hud) => set({ hud }),
  pushFeed: (text, team) => set((s) => ({ feed: [...s.feed.slice(-5), { id: Date.now() + Math.random(), text, team }] })),
  showBanner: (b) => set({ banner: { ...b, id: Date.now() + Math.random() } }),
}));
