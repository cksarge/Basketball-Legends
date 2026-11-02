"use client";
// Saved games in local storage: an autosave (kept every few seconds, so a closed tab can be resumed) and
// slots you save to on purpose. Each group of modes has its own three slots, so they never overwrite each other.
import { useMemo, useSyncExternalStore } from "react";
import type { Match } from "@/game/sim/match";
import { parkById } from "@/game/park/parks";
import type { PendingMatch } from "./matchStore";

export type SlotNumber = 1 | 2 | 3;
export type SaveSlot = "auto" | SlotNumber;
export const SLOTS: SlotNumber[] = [1, 2, 3];
/** Three slots each: Quick Play and the park share "play"; Career and Franchise have their own. */
export type SaveGroup = "play" | "career" | "franchise";
const ALL: { slot: SaveSlot; group: SaveGroup }[] = [
  { slot: "auto", group: "play" },
  ...(["play", "career", "franchise"] as const).flatMap((group) => SLOTS.map((slot) => ({ slot, group }))),
];

/** The autosave and Quick Play slots keep their original keys, so older saves still resume. */
const PREFIX: Record<SaveGroup, string> = { play: "bl-save", career: "bl-career-save", franchise: "bl-franchise-save" };
const keyFor = (slot: SaveSlot, group: SaveGroup) => (slot === "auto" ? "bl-suspended" : `${PREFIX[group]}-${slot}`);

export const saveGroupOf = (p: Pick<PendingMatch, "mode">): SaveGroup => (p.mode === "career" || p.mode === "franchise" ? p.mode : "play");

/** The name of a save in the lists ("Autosave", "Slot 2", "Legend slot 2"). */
export function slotLabel(slot: SaveSlot, group: SaveGroup) {
  if (slot === "auto") return "Autosave";
  return group === "play" ? `Slot ${slot}` : `${group === "career" ? "Legend" : "Franchise"} slot ${slot}`;
}

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
  return p.mode === "career" ? "Road to Legend" : p.mode === "franchise" ? "Franchise" : "Quick Play";
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
    localStorage.setItem(keyFor(slot, saveGroupOf(pending)), JSON.stringify(data));
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

function readRaw(slot: SaveSlot, group: SaveGroup): string | null {
  try {
    return localStorage.getItem(keyFor(slot, group));
  } catch {
    return null;
  }
}

export function loadSuspended(slot: SaveSlot = "auto", group: SaveGroup = "play"): SuspendedGame | null {
  return parse(readRaw(slot, group));
}

export function clearSuspended(slot: SaveSlot = "auto", group: SaveGroup = "play") {
  try {
    localStorage.removeItem(keyFor(slot, group));
  } catch {
    /* ignore */
  }
  notify();
}

/** The match setup that continues a save. A slot's game keeps saving back to that slot; the autosave remembers its slot. */
export function resumePending(slot: SaveSlot, game: SuspendedGame): PendingMatch {
  return { ...game.pending, resume: true, resumeFrom: slot, saveSlot: slot === "auto" ? game.pending.saveSlot : slot };
}

/** The autosave and every Career slot, with whatever is in them. */
const careerSaves = () =>
  (["auto", ...SLOTS] as SaveSlot[]).map((slot) => ({ slot, game: loadSuspended(slot, "career") })).filter((x) => x.game?.pending.career);

/** The newest save of one career game, wherever it is, ready to resume. */
export function findCareerSave(careerId: string, gameId: string) {
  const found = careerSaves()
    .filter((x) => x.game!.pending.career!.careerId === careerId && x.game!.pending.career!.gameId === gameId)
    .sort((a, b) => b.game!.savedAt - a.game!.savedAt)[0];
  return found ? { pending: resumePending(found.slot, found.game!), summary: found.game!.summary } : null;
}

/** Drops a career's saved games that can no longer be played (simmed since, or the career was deleted). */
export function pruneCareerSaves(careerId: string, playable: (gameId: string) => boolean) {
  for (const { slot, game } of careerSaves()) {
    const ref = game!.pending.career!;
    if (ref.careerId === careerId && !playable(ref.gameId)) clearSuspended(slot, "career");
  }
}

/** The autosave and every Franchise slot, with whatever is in them. */
const franchiseSaves = () =>
  (["auto", ...SLOTS] as SaveSlot[]).map((slot) => ({ slot, game: loadSuspended(slot, "franchise") })).filter((x) => x.game?.pending.franchise);

/** The newest save of one franchise game, wherever it is, ready to resume. */
export function findFranchiseSave(franchiseId: string, gameId: string) {
  const found = franchiseSaves()
    .filter((x) => x.game!.pending.franchise!.franchiseId === franchiseId && x.game!.pending.franchise!.gameId === gameId)
    .sort((a, b) => b.game!.savedAt - a.game!.savedAt)[0];
  return found ? { pending: resumePending(found.slot, found.game!), summary: found.game!.summary } : null;
}

/** Drops a franchise's saved games that can no longer be played (simmed since, or the franchise was deleted). */
export function pruneFranchiseSaves(franchiseId: string, keep: (gameId: string) => boolean) {
  for (const { slot, game } of franchiseSaves()) {
    const ref = game!.pending.franchise!;
    if (ref.franchiseId === franchiseId && !keep(ref.gameId)) clearSuspended(slot, "franchise");
  }
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

export type SavedEntry = { slot: SaveSlot; group: SaveGroup; game: SuspendedGame };

/** Every saved game (the autosave first, then the slots), kept in sync with storage; empty while prerendering. */
export function useSaves(): SavedEntry[] {
  // one string snapshot of every key keeps useSyncExternalStore stable between changes
  const raw = useSyncExternalStore(
    subscribe,
    () => ALL.map((s) => readRaw(s.slot, s.group) ?? "").join("\u0000"),
    () => "",
  );
  return useMemo(() => {
    if (!raw) return [];
    const parts = raw.split("\u0000");
    return ALL.map((s, i) => ({ ...s, game: parse(parts[i] || null) })).filter((x): x is SavedEntry => x.game !== null);
  }, [raw]);
}
