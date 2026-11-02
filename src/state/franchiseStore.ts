"use client";
// The open franchise: loads it from IndexedDB, applies changes and saves after each one.
import { create } from "zustand";
import { loadLeague } from "@/data/leagues";
import type { Team } from "@/engine/types";
import { StaleFranchiseError, commitFranchise, createFranchiseSave, loadFranchise } from "@/franchise/storage";
import type { Franchise } from "@/franchise/types";

export async function franchiseTeam(f: Franchise): Promise<Team | undefined> {
  return (await loadLeague(f.league)).teams.find((t) => t.id === f.teamId);
}

interface FranchiseStore {
  franchise: Franchise | null;
  team: Team | null;
  status: "idle" | "loading" | "ready" | "missing" | "error" | "stale";
  error: string | null;
  open: (id: string) => Promise<void>;
  /** Pick up changes saved by a sim, without a loading screen. */
  refresh: () => Promise<void>;
  /** Save a new franchise and open it. */
  set: (f: Franchise) => Promise<void>;
  /** Apply a change and save it. False means it wasn't saved, and the status says why. */
  update: (fn: (f: Franchise) => Franchise, changedPlayers?: string[]) => Promise<boolean>;
  close: () => void;
}

/** Saves run one at a time, each building on the last, so quick changes can't look like another tab's. */
let saving: Promise<unknown> = Promise.resolve();

export const useFranchise = create<FranchiseStore>((set, get) => ({
  franchise: null,
  team: null,
  status: "idle",
  error: null,
  open: async (id) => {
    set({ status: "loading", error: null });
    try {
      const f = await loadFranchise(id);
      if (!f) return set({ status: "missing", franchise: null, team: null });
      set({ franchise: f, team: (await franchiseTeam(f)) ?? null, status: "ready" });
    } catch (e) {
      set({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  },
  refresh: async () => {
    const id = get().franchise?.id;
    const f = id ? await loadFranchise(id) : null;
    if (f) set({ franchise: f });
  },
  set: async (f) => {
    const team = (await franchiseTeam(f)) ?? null;
    const saved = await createFranchiseSave(f, team ?? undefined);
    set({ franchise: saved, team, status: "ready", error: null });
  },
  update: (fn, changedPlayers) => {
    const run = async () => {
      const cur = get().franchise;
      if (!cur || get().status !== "ready") return false;
      try {
        const saved = await commitFranchise(fn(cur), get().team ?? undefined, changedPlayers);
        set({ franchise: saved });
        return true;
      } catch (e) {
        if (e instanceof StaleFranchiseError) set({ status: "stale" });
        else set({ status: "error", error: "Couldn't save. Your last change isn't stored." });
        return false;
      }
    };
    const next = saving.then(run);
    saving = next;
    return next;
  },
  close: () => set({ franchise: null, team: null, status: "idle", error: null }),
}));
