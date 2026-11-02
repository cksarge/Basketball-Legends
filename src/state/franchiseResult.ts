"use client";
// A finished franchise game is kept in local storage until the hub has saved it, so a reload or closed tab can't lose it.
import type { Team } from "@/engine/types";
import { applyFinishedFranchiseMatch } from "@/franchise/match";
import type { Franchise } from "@/franchise/types";
import { useFranchise } from "./franchiseStore";
import { useMatchStore, type MatchResult } from "./matchStore";

const KEY = "bl-franchise-result";

export function storeFranchiseResult(r: MatchResult) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...r, playByPlay: [] }));
  } catch {
    /* storage full or blocked: the copy in memory still reaches the hub */
  }
}

export function loadFranchiseResult(franchiseId: string): MatchResult | null {
  try {
    const raw = localStorage.getItem(KEY);
    const r = raw ? (JSON.parse(raw) as MatchResult) : null;
    return r?.franchise?.franchiseId === franchiseId ? r : null;
  } catch {
    return null;
  }
}

function clearFranchiseResult() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* blocked: nothing was stored */
  }
}

export type ResultOutcome = "none" | "applied" | "unused" | "failed";

/** Records the game that just finished. The result stays stored until the save succeeds, and a repeat changes nothing. */
export async function applyFranchiseResult(f: Franchise, teams: Team[]): Promise<ResultOutcome> {
  const last = useMatchStore.getState().lastResult;
  const res = last?.franchise?.franchiseId === f.id ? last : loadFranchiseResult(f.id);
  if (!res?.franchise) return "none";
  const game = f.season.games.find((g) => g.id === res.franchise!.gameId);
  const open = !!game && !game.result;
  if (open && !(await useFranchise.getState().update((x) => applyFinishedFranchiseMatch(x, res, teams)))) return "failed";
  clearFranchiseResult();
  useMatchStore.setState({ lastResult: null, pending: null });
  return open ? "applied" : "unused";
}
