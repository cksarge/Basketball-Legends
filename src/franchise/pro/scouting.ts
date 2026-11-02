// What a team knows about a prospect: a range around the truth that narrows, and stays uncertain until he's played.
import { playerOvr } from "@/engine/player";
import { Rng, clamp } from "@/engine/rng";
import type { Player } from "@/engine/types";
import { staffRating } from "../coaching/staff";
import type { Franchise } from "../types";

export const MAX_ASSIGNED = 12;
const ASSIGNED_WEEK = 3;
const GENERAL_WEEK = 0.4;
const WIDEST = 10;
const NARROWEST = 1;
const POINTS_SCALE = 6;
/** How far off center the truth can sit, as a share of the half-width. Under 1, so it's always in range and ranges nest. */
const MAX_OFFSET = 0.7;
const AVERAGE_SCOUT = 70;

export type Range = [number, number];

/** M8 adds the scouting budget here. */
export const scoutMultiplier = (f: Franchise) => staffRating(f, "scout") / AVERAGE_SCOUT;

function around(truth: number, offset: number, half: number): Range {
  const center = truth + offset * half;
  return [Math.round(clamp(center - half, 25, truth)), Math.round(clamp(center + half, truth, 99))];
}

/** A read of a prospect with this much scouting. The errors are fixed per prospect, so more scouting only narrows it. */
export function readProspect(seed: string, p: Player, points: number, multiplier: number): { ovr: Range; pot: Range } {
  const half = Math.max(NARROWEST, WIDEST / Math.sqrt(1 + (points * multiplier) / POINTS_SCALE));
  const rng = new Rng(`${seed}:scout:${p.id}`);
  const offset = () => rng.range(-MAX_OFFSET, MAX_OFFSET);
  return { ovr: around(playerOvr(p), offset(), half), pot: around(p.potential, offset(), half) };
}

export const prospectRange = (f: Franchise, p: Player) => readProspect(f.seed, p, f.draft.scouting[p.id] ?? 0, scoutMultiplier(f));

export function assignScout(f: Franchise, id: string, on: boolean): Franchise {
  const assigned = f.draft.assigned.filter((x) => x !== id);
  if (on) {
    if (f.draft.assigned.includes(id) || f.draft.assigned.length >= MAX_ASSIGNED) return f;
    assigned.push(id);
  }
  return { ...f, draft: { ...f.draft, assigned } };
}

export function weeklyScouting(f: Franchise): Franchise {
  const scouting = { ...f.draft.scouting };
  const assigned = new Set(f.draft.assigned);
  for (const p of f.draft.prospects) scouting[p.id] = (scouting[p.id] ?? 0) + (assigned.has(p.id) ? ASSIGNED_WEEK : GENERAL_WEEK);
  return { ...f, draft: { ...f.draft, scouting } };
}

export const isUnknown = (p: Player) => !!p.file?.range;
export const shownOvr = (p: Player) => (p.file?.range ? p.file.range.ovr.join("-") : String(playerOvr(p)));
