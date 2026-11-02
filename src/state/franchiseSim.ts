"use client";
// The hub's running sim. It lives here, not in a component, so leaving the hub and coming back finds it still attached.
import { create } from "zustand";
import type { IsoDate } from "@/career/types";
import type { Team } from "@/engine/types";
import { startSim, type SimHandle } from "@/franchise/simClient";
import type { SimRange } from "@/franchise/simRun";
import { useFranchise } from "./franchiseStore";

export const useFranchiseSim = create<{ running: boolean; date: IsoDate | null }>(() => ({ running: false, date: null }));

export type SimOutcome = "done" | "stopped" | "failed" | "busy";

let handle: SimHandle | null = null;
let stopped = false;

export function stopFranchiseSim() {
  stopped = true;
  handle?.cancel();
}

export async function runFranchiseSim(range: Omit<SimRange, "id">, teams: Team[]): Promise<SimOutcome> {
  const f = useFranchise.getState().franchise;
  if (!f) return "failed";
  if (handle) return "busy";
  stopped = false;
  useFranchiseSim.setState({ running: true, date: f.date });
  handle = startSim({ ...range, id: f.id }, teams, (date) => useFranchiseSim.setState({ date }));
  try {
    await handle.done;
    await useFranchise.getState().refresh();
    return stopped ? "stopped" : "done";
  } catch (e) {
    // the worker passes errors by name
    if (e instanceof Error && e.name === "StaleFranchiseError") useFranchise.setState({ status: "stale" });
    else useFranchise.setState({ status: "error", error: "The sim stopped before finishing. Everything up to the last finished day is saved." });
    return "failed";
  } finally {
    handle = null;
    useFranchiseSim.setState({ running: false, date: null });
  }
}
