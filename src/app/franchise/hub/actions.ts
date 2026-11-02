"use client";
import { useEffect, useState } from "react";
import { loadLeague } from "@/data/leagues";
import type { Team } from "@/engine/types";
import type { Franchise } from "@/franchise/types";
import { useFranchise } from "@/state/franchiseStore";
import { pruneFranchiseSaves } from "@/state/suspended";

export function useLeagueTeams(f: Franchise | null): Team[] | null {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const league = f?.league;
  useEffect(() => {
    if (league) loadLeague(league).then((d) => setTeams(d.teams));
  }, [league]);
  return teams;
}

/** Only games that are still open can resume. */
export function pruneSaves(f: Franchise) {
  const open = new Set(f.season.games.filter((g) => !g.result).map((g) => g.id));
  pruneFranchiseSaves(f.id, (id) => open.has(id));
}

/** Every user roster move goes through here. */
export function useRosterMove() {
  const update = useFranchise((s) => s.update);
  return (label: string, move: (f: Franchise) => Franchise) => update(move);
}
