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
  /** Save a new franchise and open it. */
  set: (f: Franchise) => Promise<void>;
  /** Apply a change and save it. */
  update: (fn: (f: Franchise) => Franchise, changedPlayers?: string[]) => Promise<void>;
  close: () => void;
}

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
  set: async (f) => {
    const team = (await franchiseTeam(f)) ?? null;
    const saved = await createFranchiseSave(f, team ?? undefined);
    set({ franchise: saved, team, status: "ready", error: null });
  },
  update: async (fn, changedPlayers) => {
    const cur = get().franchise;
    if (!cur || get().status !== "ready") return;
    try {
      const saved = await commitFranchise(fn(cur), get().team ?? undefined, changedPlayers);
      set({ franchise: saved });
    } catch (e) {
      if (e instanceof StaleFranchiseError) set({ status: "stale" });
      else set({ status: "error", error: "Couldn't save. Your last change isn't stored." });
    }
  },
  close: () => set({ franchise: null, team: null, status: "idle", error: null }),
}));
