"use client";
// Saved games in local storage: an autosave (kept every few seconds, so a closed tab can be resumed) and
// three slots you save to on purpose, so a Quick Play game and a park game never overwrite each other.
import { useMemo, useSyncExternalStore } from "react";
import type { Match } from "@/game/sim/match";
import { parkById } from "@/game/park/parks";
import type { PendingMatch } from "./matchStore";

export type SlotNumber = 1 | 2 | 3;
export type SaveSlot = "auto" | SlotNumber;
export const SLOTS: SlotNumber[] = [1, 2, 3];
const ALL: SaveSlot[] = ["auto", ...SLOTS];

/** The autosave keeps the original key, so games saved before slots existed still resume. */
const keyFor = (slot: SaveSlot) => (slot === "auto" ? "bl-suspended" : `bl-save-${slot}`);

export interface SuspendedGame {
  v: 1;
  savedAt: number;
  pending: PendingMatch;
  match: string;
  summary: { home: string; away: string; homeScore: number; awayScore: number; period: string; clock: string; mode?: string };
}

function periodText(m: Match) {
  const s = m.state,
    per = s.cfg.rules.periods;
  if (s.period > per) return s.period - per > 1 ? `OT${s.period - per}` : "OT";
  return per === 2 ? `${s.period === 1 ? "1st" : "2nd"} half` : `Q${s.period}`;
}

/** What kind of game this is, for the save lists ("Quick Play", "Play in the Park · Ironside Cage"). */
export function modeLabel(p: PendingMatch) {
  if (p.park) return `Play in the Park · ${parkById(p.park.parkId).name}`;
  return p.mode === "career" ? "Career" : p.mode === "franchise" ? "Franchise" : "Quick Play";
}

/** A one-line description of where a saved game stands. */
export function whereText(g: SuspendedGame) {
  return g.summary.clock === "no clock" ? g.summary.period : `${g.summary.period}, ${g.summary.clock} left`;
}

export function saveSuspended(match: Match, pending: PendingMatch, slot: SaveSlot = "auto") {
  const s = match.state;
  if (s.phase === "final" || s.cfg.practice) return false;
  const data: SuspendedGame = {
    v: 1,
    savedAt: Date.now(),
    pending: { ...pending, resume: false, resumeFrom: undefined, saveSlot: slot === "auto" ? pending.saveSlot : slot },
    match: match.serialize(),
    summary: {
      home: s.teams[0].team.name,
      away: s.teams[1].team.name,
      homeScore: s.teams[0].score,
      awayScore: s.teams[1].score,
      // park games have no clock: the summary names the target instead
      period: s.cfg.park ? (s.cfg.park.game === "21" ? "21" : `Game to ${s.cfg.park.target}`) : periodText(match),
      clock: s.cfg.park ? "no clock" : `${Math.floor(s.clock / 60)}:${String(Math.floor(s.clock % 60)).padStart(2, "0")}`,
      mode: modeLabel(pending),
    },
  };
  try {
    localStorage.setItem(keyFor(slot), JSON.stringify(data));
  } catch {
    /* storage full or blocked: resuming just isn't offered */
    return false;
  }
  notify();
  return true;
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

function readRaw(slot: SaveSlot): string | null {
  try {
    return localStorage.getItem(keyFor(slot));
  } catch {
    return null;
  }
}

export function loadSuspended(slot: SaveSlot = "auto"): SuspendedGame | null {
  return parse(readRaw(slot));
}

export function clearSuspended(slot: SaveSlot = "auto") {
  try {
    localStorage.removeItem(keyFor(slot));
  } catch {
    /* ignore */
  }
  notify();
}

const EVENT = "bl-suspended-change";
function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

function subscribe(fn: () => void) {
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", fn);
  };
}

/** Every saved game (the autosave first, then the slots), kept in sync with storage; empty while prerendering. */
export function useSaves(): { slot: SaveSlot; game: SuspendedGame }[] {
  // one string snapshot of all four keys keeps useSyncExternalStore stable between changes
  const raw = useSyncExternalStore(
    subscribe,
    () => ALL.map((s) => readRaw(s) ?? "").join("\u0000"),
    () => "",
  );
  return useMemo(() => {
    if (!raw) return [];
    const parts = raw.split("\u0000");
    return ALL.map((slot, i) => ({ slot, game: parse(parts[i] || null) })).filter((x): x is { slot: SaveSlot; game: SuspendedGame } => x.game !== null);
  }, [raw]);
}
