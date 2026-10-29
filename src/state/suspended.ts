"use client";
// One suspended game kept in local storage, so a closed tab or a "save and quit" can be resumed.
import { useMemo, useSyncExternalStore } from "react";
import type { Match } from "@/game/sim/match";
import type { PendingMatch } from "./matchStore";

const KEY = "bl-suspended";

export interface SuspendedGame {
  v: 1;
  savedAt: number;
  pending: PendingMatch;
  match: string;
  summary: { home: string; away: string; homeScore: number; awayScore: number; period: string; clock: string };
}

function periodText(m: Match) {
  const s = m.state,
    per = s.cfg.rules.periods;
  if (s.period > per) return s.period - per > 1 ? `OT${s.period - per}` : "OT";
  return per === 2 ? `${s.period === 1 ? "1st" : "2nd"} half` : `Q${s.period}`;
}

export function saveSuspended(match: Match, pending: PendingMatch) {
  const s = match.state;
  if (s.phase === "final" || s.cfg.practice) return;
  const data: SuspendedGame = {
    v: 1,
    savedAt: Date.now(),
    pending: { ...pending, resume: false },
    match: match.serialize(),
    summary: {
      home: s.teams[0].team.name,
      away: s.teams[1].team.name,
      homeScore: s.teams[0].score,
      awayScore: s.teams[1].score,
      // park games have no clock: the summary names the target instead
      period: s.cfg.park ? (s.cfg.park.game === "21" ? "21" : `Game to ${s.cfg.park.target}`) : periodText(match),
      clock: s.cfg.park ? "no clock" : `${Math.floor(s.clock / 60)}:${String(Math.floor(s.clock % 60)).padStart(2, "0")}`,
    },
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage full or blocked: resuming just isn't offered */
  }
  notify();
}

function parse(raw: string | null): SuspendedGame | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as SuspendedGame;
    return d.v === 1 && d.match && d.pending ? d : null;
  } catch {
    return null;
  }
}

function readRaw(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function loadSuspended(): SuspendedGame | null {
  return parse(readRaw());
}

export function clearSuspended() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  notify();
}

const EVENT = "bl-suspended-change";
function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

/** The suspended game, kept in sync with storage (null while prerendering). */
export function useSuspended(): SuspendedGame | null {
  const raw = useSyncExternalStore(
    (fn) => {
      window.addEventListener(EVENT, fn);
      window.addEventListener("storage", fn);
      return () => {
        window.removeEventListener(EVENT, fn);
        window.removeEventListener("storage", fn);
      };
    },
    readRaw,
    () => null,
  );
  return useMemo(() => parse(raw), [raw]);
}
