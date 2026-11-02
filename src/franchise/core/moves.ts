// User roster moves: one level of undo, and a coaching plan that keeps up with the roster.
import { playerOvr } from "@/engine/player";
import type { Player } from "@/engine/types";
import type { Franchise, TeamPlan, UndoRecord } from "../types";

const UNDO_FIELDS = ["rosters", "devRosters", "picks", "books", "freeAgents", "waivers", "plan", "draft", "freeAgency"] as const;

/** Why a roster move has to wait. */
export function moveLock(f: Franchise, suspendedGameId?: string | null): string | null {
  if (suspendedGameId) return "You have a saved game in progress. Finish it first.";
  return f.live ? "Finish the game in progress first." : null;
}

/** Keeps the plan to players who are still here, and matchups to players who are still on the other side. */
export function prunePlan(f: Franchise): Franchise {
  const mine = f.rosters[f.teamId];
  const here = new Set(mine);
  const { plan } = f;
  const kept = plan.starters.filter((id) => here.has(id));
  const bench = mine.filter((id) => !kept.includes(id)).sort((a, b) => playerOvr(f.players[b]) - playerOvr(f.players[a]));
  const starters = plan.starters.map((id) => (here.has(id) ? id : bench.shift()!));
  const minutes = Object.fromEntries(Object.entries(plan.minutes).filter(([id]) => here.has(id)));
  const playerPlans = Object.fromEntries(Object.entries(plan.playerPlans).filter(([id]) => here.has(id)));
  const tactics = { ...plan.tactics };
  let tacticsChanged = false;
  if (tactics.matchups) {
    const matchups = Object.fromEntries(Object.entries(tactics.matchups).filter(([id, target]) => here.has(id) && !here.has(target)));
    if (Object.keys(matchups).length !== Object.keys(tactics.matchups).length) {
      tactics.matchups = matchups;
      tacticsChanged = true;
    }
  }
  if (tactics.doubleTarget && here.has(tactics.doubleTarget)) {
    delete tactics.doubleTarget;
    tacticsChanged = true;
  }
  const same =
    !tacticsChanged &&
    starters.every((id, i) => id === plan.starters[i]) &&
    Object.keys(minutes).length === Object.keys(plan.minutes).length &&
    Object.keys(playerPlans).length === Object.keys(plan.playerPlans).length;
  if (same) return f;
  const next: TeamPlan = { ...plan, starters, minutes, playerPlans, tactics };
  return { ...f, plan: next };
}

function changedPlayers(before: Franchise, after: Franchise) {
  const changed: Record<string, Player | null> = {};
  for (const [id, p] of Object.entries(after.players)) if (before.players[id] !== p) changed[id] = before.players[id] ?? null;
  for (const [id, p] of Object.entries(before.players)) if (!after.players[id]) changed[id] = p;
  return changed;
}

export function applyMove(f: Franchise, label: string, move: (f: Franchise) => Franchise): Franchise {
  const moved = move(f);
  if (moved === f) return f;
  const next = prunePlan(moved);
  const before: Partial<Franchise> = {};
  const save = <K extends (typeof UNDO_FIELDS)[number]>(k: K) => {
    if (f[k] !== next[k]) before[k] = f[k];
  };
  UNDO_FIELDS.forEach(save);
  const undo: UndoRecord = { label, before, players: changedPlayers(f, next) };
  return { ...next, undo };
}

export function undoMove(f: Franchise): Franchise {
  if (!f.undo || f.live) return f;
  const players = { ...f.players };
  for (const [id, p] of Object.entries(f.undo.players)) {
    if (p) players[id] = p;
    else delete players[id];
  }
  const next: Franchise = { ...f, ...f.undo.before, players };
  delete next.undo;
  return next;
}

export function clearUndo(f: Franchise): Franchise {
  if (!f.undo) return f;
  const next = { ...f };
  delete next.undo;
  return next;
}
