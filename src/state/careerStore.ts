"use client";
// The open career: loads it from IndexedDB, applies changes and autosaves after each one.
import { create } from "zustand";
import { loadLeague } from "@/data/leagues";
import type { LeagueId, Team } from "@/engine/types";
import type { Career } from "@/career/types";
import { loadCareer, saveCareer } from "@/career/storage";

/** The team a career player belongs to right now. */
export async function careerTeam(c: Career): Promise<Team | undefined> {
  const id = c.player.teamId;
  if (!id) return undefined;
  const league: LeagueId = id.startsWith("hs-") ? "hs" : id.startsWith("pro-") ? "pro" : "college";
  return (await loadLeague(league)).teams.find((t) => t.id === id);
}

interface CareerStore {
  career: Career | null;
  team: Team | null;
  status: "idle" | "loading" | "ready" | "missing" | "error";
  error: string | null;
  open: (id: string) => Promise<void>;
  /** Replace the open career (after creating or importing one). */
  set: (c: Career) => Promise<void>;
  /** Apply a change and save it. */
  update: (fn: (c: Career) => Career) => Promise<void>;
  close: () => void;
}

export const useCareer = create<CareerStore>((set, get) => ({
  career: null,
  team: null,
  status: "idle",
  error: null,
  open: async (id) => {
    if (get().career?.id === id && get().status === "ready") return;
    set({ status: "loading", error: null });
    try {
      const c = await loadCareer(id);
      if (!c) return set({ status: "missing", career: null, team: null });
      set({ career: c, team: (await careerTeam(c)) ?? null, status: "ready" });
    } catch (e) {
      set({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  },
  set: async (c) => {
    const team = (await careerTeam(c)) ?? null;
    const saved = await saveCareer(c, team ?? undefined);
    set({ career: saved, team, status: "ready", error: null });
  },
  update: async (fn) => {
    const cur = get().career;
    if (!cur) return;
    const next = fn(cur);
    const team = next.player.teamId === get().team?.id ? get().team : ((await careerTeam(next)) ?? null);
    set({ career: next, team });
    const saved = await saveCareer(next, team ?? undefined);
    set({ career: saved });
  },
  close: () => set({ career: null, team: null, status: "idle" }),
}));
