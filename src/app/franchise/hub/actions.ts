"use client";
import { useEffect, useState } from "react";
import { loadLeague } from "@/data/leagues";
import type { Team } from "@/engine/types";
import { applyMove, moveLock } from "@/franchise/core/moves";
import { nextFranchiseEvent } from "@/franchise/core/season";
import type { Franchise } from "@/franchise/types";
import { useFranchise } from "@/state/franchiseStore";
import { findFranchiseSave, pruneFranchiseSaves } from "@/state/suspended";
import { toast } from "@/ui/Toaster";

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

/** The user's game that's open right now, if it's saved partway through. */
function suspendedGame(f: Franchise) {
  const ev = nextFranchiseEvent(f);
  return ev.kind === "game" && findFranchiseSave(f.id, ev.game.id) ? ev.game.id : null;
}

/** Every user roster move goes through here. With no label, a change can't be undone. */
export function useRosterMove() {
  const update = useFranchise((s) => s.update);
  return (label: string | null, move: (f: Franchise) => Franchise) => {
    const f = useFranchise.getState().franchise;
    const lock = f && moveLock(f, suspendedGame(f));
    if (lock) {
      toast(lock, "bad");
      return Promise.resolve(false);
    }
    return update((x) => (label ? applyMove(x, label, move) : move(x)));
  };
}
