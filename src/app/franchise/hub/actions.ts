"use client";
import { useEffect, useRef, useState } from "react";
import type { IsoDate } from "@/career/types";
import { loadLeague } from "@/data/leagues";
import type { Team } from "@/engine/types";
import { applyFinishedFranchiseMatch } from "@/franchise/match";
import { startSim, type SimHandle } from "@/franchise/simClient";
import type { SimRange } from "@/franchise/simRun";
import type { Franchise } from "@/franchise/types";
import { useFranchise } from "@/state/franchiseStore";
import { useMatchStore } from "@/state/matchStore";
import { pruneFranchiseSaves } from "@/state/suspended";

export function useLeagueTeams(f: Franchise | null): Team[] | null {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const league = f?.league;
  useEffect(() => {
    if (league) loadLeague(league).then((d) => setTeams(d.teams));
  }, [league]);
  return teams;
}

/** Records a game that just finished. It runs once; a repeat changes nothing. */
export async function applyLastResult(f: Franchise, teams: Team[]) {
  const res = useMatchStore.getState().lastResult;
  if (!res?.franchise || res.franchise.franchiseId !== f.id) return;
  await useFranchise.getState().update((x) => applyFinishedFranchiseMatch(x, res, teams));
  useMatchStore.getState().setResult(null);
}

/** Only games that are still open can resume. */
export function pruneSaves(f: Franchise) {
  const open = new Set(f.season.games.filter((g) => !g.result).map((g) => g.id));
  pruneFranchiseSaves(f.id, (id) => open.has(id));
}

export interface SimState {
  running: boolean;
  date: IsoDate | null;
}

/** Runs sims from the hub: tracks the day reached, lets you stop, and reloads the save when it ends. */
export function useSim(teams: Team[] | null) {
  const [sim, setSim] = useState<SimState>({ running: false, date: null });
  const handle = useRef<SimHandle | null>(null);
  const run = async (range: Omit<SimRange, "id">) => {
    const f = useFranchise.getState().franchise;
    if (!f || !teams || handle.current) return;
    setSim({ running: true, date: f.date });
    handle.current = startSim({ ...range, id: f.id }, teams, (date) => setSim({ running: true, date }));
    try {
      await handle.current.done;
      await useFranchise.getState().refresh();
    } catch (e) {
      // the worker passes errors by name
      if (e instanceof Error && e.name === "StaleFranchiseError") useFranchise.setState({ status: "stale" });
      else useFranchise.setState({ status: "error", error: "The sim stopped before finishing. Everything up to the last finished day is saved." });
    } finally {
      handle.current = null;
      setSim({ running: false, date: null });
    }
  };
  return { sim, run, stop: () => handle.current?.cancel() };
}
