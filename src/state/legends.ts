"use client";
// Your Legends: careers that earned the title live on outside Road to Legend, in local storage.
import type { Player } from "@/engine/types";
import { parkById } from "@/game/park/parks";

/** Hometown courts take a Legend's name. */
export const LEGEND_PARK = "copper-flats";
const KEY = "bl-legends";

export interface LegendEntry {
  careerId: string;
  player: Player;
}

export function loadLegends(): LegendEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function saveLegend(entry: LegendEntry) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...loadLegends().filter((l) => l.careerId !== entry.careerId), entry]));
  } catch {
    /* storage full or blocked: the career still has the title */
  }
}

/** The name on the sign: your latest Legend's hometown courts carry their name. */
export function parkName(parkId: string, legends: LegendEntry[]) {
  const latest = legends.at(-1);
  return latest && parkId === LEGEND_PARK ? `${latest.player.firstName} ${latest.player.lastName} Courts` : parkById(parkId).name;
}
