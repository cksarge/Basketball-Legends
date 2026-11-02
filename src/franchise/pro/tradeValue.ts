// What an asset is worth to a team. Stars cost far more than depth, and a team's direction shifts what it pays for.
import { playerOvr } from "@/engine/player";
import type { Player } from "@/engine/types";
import type { DraftPick, Franchise } from "../types";
import { marketValue, winShare } from "./market";
import { draftYearOf } from "./picks";
import { guaranteed } from "./rosterMoves";

export type TeamDirection = "contending" | "neutral" | "rebuilding";

/** Each overall point multiplies value by this, so several good players never add up to a star. */
const RATING_CURVE = 1.16;
const RATING_FLOOR = 60;
const NOW_SHARE: Record<TeamDirection, number> = { contending: 0.85, neutral: 0.6, rebuilding: 0.35 };
/** Value units per $1M of surplus contract. */
const CONTRACT_UNITS = 0.25;
const OLD_AGE = 30;
const OLD_DISCOUNT = 3;
const WIN_LINE = 0.08;
const STRENGTH_POINTS = 25;
const TOP_PICK = 30;
const PICK_FALLOFF = 8;
const PICK_FLOOR = 2;
const SECOND_ROUND = 1.2;
const YEAR_DISCOUNT = 0.9;
const PICK_TASTE: Record<TeamDirection, number> = { contending: 0.8, neutral: 1, rebuilding: 1.25 };

const topEight = (f: Franchise, teamId: string) => {
  const ovrs = f.rosters[teamId].map((id) => playerOvr(f.players[id])).sort((a, b) => b - a);
  const top = ovrs.slice(0, 8);
  return top.reduce((a, b) => a + b, 0) / Math.max(1, top.length);
};

interface TeamRead {
  direction: Record<string, TeamDirection>;
  /** Team id -> 1 for the weakest team. */
  slot: Record<string, number>;
}
const reads = new WeakMap<object, WeakMap<object, TeamRead>>();

/** Every team read once per league state, since trade searches ask constantly. The key has to change with anything the read uses, or a reloaded save would decide differently. */
function teamRead(f: Franchise): TeamRead {
  const hit = reads.get(f.players)?.get(f.season.games);
  if (hit) return hit;
  const ids = Object.keys(f.rosters);
  const strength = Object.fromEntries(ids.map((id) => [id, topEight(f, id)]));
  const average = ids.reduce((a, id) => a + strength[id], 0) / ids.length;
  const score = (id: string) => winShare(f, id) - 0.5 + (strength[id] - average) / STRENGTH_POINTS;
  const direction = Object.fromEntries(
    ids.map((id): [string, TeamDirection] => [id, score(id) > WIN_LINE ? "contending" : score(id) < -WIN_LINE ? "rebuilding" : "neutral"]),
  );
  const order = [...ids].sort((a, b) => score(a) - score(b));
  const read = { direction, slot: Object.fromEntries(order.map((id, i) => [id, i + 1])) };
  if (!reads.has(f.players)) reads.set(f.players, new WeakMap());
  reads.get(f.players)!.set(f.season.games, read);
  return read;
}

/** 1 for the league's weakest team. */
export const teamSlot = (f: Franchise, teamId: string) => teamRead(f).slot[teamId];

export const teamDirection = (f: Franchise, teamId: string) => teamRead(f).direction[teamId];

/** Value as a roster piece, before the contract. */
function talentValue(p: Player, direction: TeamDirection) {
  const now = NOW_SHARE[direction];
  const ovr = playerOvr(p);
  const rating = ovr * now + Math.max(ovr, p.potential) * (1 - now) - (direction === "rebuilding" && p.age >= OLD_AGE ? OLD_DISCOUNT : 0);
  return RATING_CURVE ** (rating - RATING_FLOOR);
}

export function playerTradeValue(f: Franchise, p: Player, teamId: string): number {
  const talent = talentValue(p, teamDirection(f, teamId));
  if (!p.contract) return talent;
  const years = guaranteed(p.contract) / p.contract.salary;
  return talent + ((marketValue(f, p) - p.contract.salary) * years * CONTRACT_UNITS) / 1e6;
}

export function pickTradeValue(f: Franchise, pick: DraftPick, teamId: string): number {
  const read = teamRead(f);
  // once the order's set, a pick is worth its real slot
  const drawn = f.draft.order?.indexOf(pick.id) ?? -1;
  const slot = drawn >= 0 ? drawn + 1 : read.slot[pick.originalTeamId];
  const base = pick.round === 1 ? TOP_PICK * Math.exp(-slot / PICK_FALLOFF) + PICK_FLOOR : SECOND_ROUND;
  return base * YEAR_DISCOUNT ** Math.max(0, pick.year - draftYearOf(f)) * PICK_TASTE[read.direction[teamId]];
}
