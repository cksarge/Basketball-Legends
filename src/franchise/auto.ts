// Auto-manage: the user's team on the same paths AI teams use, one system at a time.
import { TRAINING } from "@/career/pro/season";
import { playerOvr } from "@/engine/player";
import type { Team } from "@/engine/types";
import { aiTactics } from "./coaching/aiPlan";
import { attendance } from "./club/finance";
import { advanceOffseason, canAdvance } from "./core/offseason";
import { rightsLimit } from "./pro/cap";
import { expiring, extendContract } from "./pro/contracts";
import { boardScore, currentPick, simDraftToEnd } from "./pro/draft";
import { setRoster, staffHandles } from "./pro/freeAgency";
import { askingPrice } from "./pro/market";
import { ticketBase } from "./pro/rules";
import { MAX_ASSIGNED } from "./pro/scouting";
import type { AutoKey, Franchise, PracticeFocus } from "./types";

export const AUTO_KEYS: { key: AutoKey; label: string; hint: string }[] = [
  { key: "tactics", label: "Tactics and playbook", hint: "Your staff picks a system that fits the roster." },
  { key: "practice", label: "Practice", hint: "Team practice works on your weakest area." },
  { key: "scouting", label: "Scouting", hint: "Your scouts choose who to follow." },
  { key: "draft", label: "Draft", hint: "Your staff makes every pick." },
  { key: "contracts", label: "Contracts", hint: "Options are decided and valued players re-sign." },
  { key: "freeAgency", label: "Free agency", hint: "Your team bids in every round." },
  { key: "trades", label: "Trades", hint: "Your team makes deals. Mark players untouchable on the Roster tab." },
  { key: "finances", label: "Finances", hint: "Ticket prices are set each season." },
  { key: "roster", label: "Roster limits", hint: "Your team signs or cuts to stay between 13 and 15." },
];

const ROTATION = 8;
const KEEP_RANK = 9;
const PRACTICE: PracticeFocus[] = ["shooting", "finishing", "playmaking", "defense"];
const PRICE_STEPS = 20;
const LOW_PRICE = 0.6;
const PRICE_STEP = 0.1;

const topPlayers = (f: Franchise) =>
  f.rosters[f.teamId]
    .map((id) => f.players[id])
    .sort((a, b) => playerOvr(b) - playerOvr(a))
    .slice(0, ROTATION);

function autoTactics(f: Franchise): Franchise {
  const { system, plays } = aiTactics(
    f.rosters[f.teamId].map((id) => f.players[id]),
    `${f.seed}:${f.season.year}:${f.teamId}`,
  );
  if (f.plan.tactics.system === system) return f;
  return { ...f, plan: { ...f.plan, tactics: { ...f.plan.tactics, system, plays } } };
}

function autoPractice(f: Franchise): Franchise {
  const top = topPlayers(f);
  const average = (focus: PracticeFocus) => {
    const keys = TRAINING.find((t) => t.id === focus)!.keys;
    return top.reduce((sum, p) => sum + keys.reduce((n, k) => n + p.ratings[k], 0) / keys.length, 0);
  };
  const practice = [...PRACTICE].sort((a, b) => average(a) - average(b))[0];
  return practice === f.plan.practice ? f : { ...f, plan: { ...f.plan, practice } };
}

function autoScouting(f: Franchise): Franchise {
  if (f.draft.assigned.length >= MAX_ASSIGNED || f.draft.order) return f;
  const assigned = [...f.draft.prospects]
    .sort((a, b) => boardScore(f, b) - boardScore(f, a))
    .slice(0, MAX_ASSIGNED)
    .map((p) => p.id);
  return { ...f, draft: { ...f.draft, assigned } };
}

/** Options go as an AI team's would, and the top of the roster re-signs at his price. */
function autoContracts(f: Franchise): Franchise {
  let next = staffHandles(f);
  const best = new Set(topPlayers(next).map((p) => p.id));
  const ranked = [...next.rosters[next.teamId]].sort((a, b) => playerOvr(next.players[b]) - playerOvr(next.players[a])).slice(0, KEEP_RANK);
  for (const id of ranked) best.add(id);
  for (const p of expiring(next, next.teamId)) {
    if (!best.has(p.id)) continue;
    const ask = askingPrice(next, p, next.teamId);
    const limit = rightsLimit(next, p, next.teamId);
    if (limit >= ask.salary) next = extendContract(next, p.id, ask.salary, ask.years);
  }
  return next;
}

/** Runs whatever's switched on for this moment. Returns the same franchise if there was nothing to do. */
export function autoStep(f: Franchise): Franchise {
  const { auto } = f.settings;
  let next = f;
  if (auto.tactics) next = autoTactics(next);
  if (auto.practice) next = autoPractice(next);
  if (auto.scouting) next = autoScouting(next);
  const step = next.offseason?.step;
  if (auto.draft && step === "draft" && currentPick(next)) next = simDraftToEnd(next);
  if (auto.contracts && step === "contracts") next = autoContracts(next);
  if (auto.roster && step === "camp") next = setRoster(next, next.teamId);
  return next;
}

export const setUntouchable = (f: Franchise, id: string, on: boolean): Franchise => ({
  ...f,
  players: { ...f.players, [id]: { ...f.players[id], file: { ...f.players[id].file!, untouchable: on } } },
});

export const setAuto = (f: Franchise, key: AutoKey, on: boolean): Franchise =>
  autoStep({ ...f, settings: { ...f.settings, auto: { ...f.settings.auto, [key]: on } } });

/** The price that brings in the most at the gate, from a normal price up. */
export function autoFinances(f: Franchise, teams: Team[]): Franchise {
  if (!f.settings.auto.finances) return f;
  const team = teams.find((t) => t.id === f.teamId)!;
  const base = ticketBase(f.cap);
  const options = Array.from({ length: PRICE_STEPS }, (_, i) => Math.round(base * (LOW_PRICE + i * PRICE_STEP)));
  const gate = (ticketPrice: number) =>
    attendance({ ...f, finance: { ...f.finance, [f.teamId]: { ...f.finance[f.teamId], ticketPrice } } }, f.teamId, team.arena.capacity) * ticketPrice;
  const ticketPrice = options.reduce((a, b) => (gate(b) > gate(a) ? b : a));
  return { ...f, finance: { ...f.finance, [f.teamId]: { ...f.finance[f.teamId], ticketPrice } } };
}

/** Runs the summer until it's done, or until something needs the user. */
export function simOffseason(f: Franchise, teams: Team[]): Franchise {
  if (f.job.fired) return f;
  let next = f;
  while (next.offseason) {
    const ready = autoStep(next);
    if (!canAdvance(ready).ok) return ready;
    next = advanceOffseason(ready, teams);
  }
  return next;
}
