// The user's coaching plan, and turning it into the lineup for a game. A plan is never changed by who's available:
// the game works around injuries, and the plan is still there when a player comes back.
import { playerOvr } from "@/engine/player";
import { POSITIONS, type Player, type Position } from "@/engine/types";
import { DEFAULT_TACTICS } from "@/game/sim/match";
import { defaultRotation, spreadMinutes } from "../rotation";
import type { TeamPlan } from "../types";

const FATIGUE_MINUTES = 38;
/** Nobody starts and sits: the least a starter plays, per 240 minutes. */
const STARTER_MINUTES = 18;
/** A rotation shorter than this leaves a healthy player's zero minutes worth a warning. */
const THIN_ROTATION = 8;

export function defaultPlan(): TeamPlan {
  return { autoRotation: true, starters: [], minutes: {}, tactics: { ...DEFAULT_TACTICS }, practice: "balanced", playerPlans: {}, staff: [] };
}

export interface Lineup {
  starters: string[];
  rotation: Record<string, number>;
}

function automatic(roster: Player[], totalMinutes: number): Lineup {
  const rotation = defaultRotation(roster, totalMinutes);
  return { starters: Object.keys(rotation).slice(0, 5), rotation };
}

const plays = (p: Player, pos: Position) => p.pos === pos || p.secondaryPos === pos;

/** The game's lineup: the plan, minus anyone who can't play, always adding up to a full game. */
export function resolveLineup(plan: TeamPlan, roster: Player[], totalMinutes: number): Lineup {
  const healthy = roster.filter((p) => !p.injury);
  if (plan.autoRotation || plan.starters.length < 5 || healthy.length < 5) return automatic(roster, totalMinutes);
  const byId = new Map(roster.map((p) => [p.id, p]));
  const isHealthy = new Set(healthy.map((p) => p.id));
  const kept = new Set(plan.starters.filter((id) => isHealthy.has(id)));
  const bench = healthy.filter((p) => !kept.has(p.id)).sort((a, b) => playerOvr(b) - playerOvr(a));
  const starters = plan.starters.map((id, slot) => {
    if (kept.has(id)) return id;
    const pos = byId.get(id)?.pos ?? POSITIONS[slot];
    const next = bench.find((p) => plays(p, pos)) ?? bench[0];
    bench.splice(bench.indexOf(next), 1);
    return next.id;
  });
  const wanted = healthy.filter((p) => starters.includes(p.id) || plan.minutes[p.id] > 0);
  if (!wanted.some((p) => plan.minutes[p.id] > 0)) return { starters, rotation: orderFirst(starters, defaultRotation(healthy, totalMinutes)) };
  // someone filling in takes on the minutes of the starter he replaced
  const stoodInFor = new Map(starters.map((id, i) => [id, plan.starters[i]]));
  const weight = (p: Player) => {
    const planned = plan.minutes[p.id] || plan.minutes[stoodInFor.get(p.id) ?? ""] || 0;
    return starters.includes(p.id) ? Math.max(planned, (STARTER_MINUTES * totalMinutes) / 240) : planned;
  };
  const minutes = spreadMinutes(wanted.map(weight), totalMinutes);
  return { starters, rotation: orderFirst(starters, Object.fromEntries(wanted.map((p, i) => [p.id, minutes[i]]))) };
}

function orderFirst(starters: string[], rotation: Record<string, number>) {
  const rest = Object.keys(rotation).filter((id) => !starters.includes(id));
  return Object.fromEntries([...starters, ...rest].filter((id) => rotation[id] > 0).map((id) => [id, rotation[id]]));
}

export type DepthWarning = { playerId: string; kind: "fatigue" | "position" | "hurt" | "unused" };

export function depthWarnings(plan: TeamPlan, roster: Player[]): DepthWarning[] {
  if (plan.autoRotation) return [];
  const out: DepthWarning[] = [];
  const inPlan = (p: Player) => plan.starters.includes(p.id) || plan.minutes[p.id] > 0;
  for (const p of roster) {
    if ((plan.minutes[p.id] ?? 0) > FATIGUE_MINUTES) out.push({ playerId: p.id, kind: "fatigue" });
    if (p.injury && inPlan(p)) out.push({ playerId: p.id, kind: "hurt" });
  }
  plan.starters.forEach((id, slot) => {
    const p = roster.find((x) => x.id === id);
    if (p && !plays(p, POSITIONS[slot])) out.push({ playerId: id, kind: "position" });
  });
  const used = roster.filter((p) => plan.minutes[p.id] > 0).length;
  if (used < THIN_ROTATION) for (const p of roster) if (!p.injury && !inPlan(p)) out.push({ playerId: p.id, kind: "unused" });
  return out;
}
