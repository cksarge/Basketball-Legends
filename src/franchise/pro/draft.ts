// Running the draft: each pick in order, AI boards, rookie deals and the players nobody took.
import type { Contract, Player } from "@/engine/types";
import type { DraftPick, Franchise } from "../types";
import { capRules, roundMoney, type CapRules } from "./rules";
import { prospectRange, readProspect } from "./scouting";

const FIRST_PICK_SALARY = 12_500_000;
const SCALE_DROP = 0.937;
const SECOND_ROUND_SALARY = 1_300_000;
const SECOND_ROUND_STEP = 4_000;
const BASE_CAP = 140_000_000;
const FIRST_ROUND = 30;
/** How much scouting an AI team has on everyone. */
const AI_POINTS = 12;
const NEED_BONUS = 2;
const POSITION_DEPTH = 2;

export function rookieDeal(pick: number, rules: CapRules): Contract {
  const scale = rules.salaryCap / BASE_CAP;
  if (pick <= FIRST_ROUND) return { salary: roundMoney(FIRST_PICK_SALARY * SCALE_DROP ** (pick - 1) * scale), years: 4, teamOptionYears: 2, rookie: true };
  const salary = roundMoney((SECOND_ROUND_SALARY - (pick - FIRST_ROUND - 1) * SECOND_ROUND_STEP) * scale);
  return { salary: Math.max(rules.minSalary, salary), years: 3, teamOptionYears: 1, rookie: true };
}

export function currentPick(f: Franchise): DraftPick | null {
  const id = f.draft.order?.[f.draft.results.length];
  return (id && f.picks.find((p) => p.id === id)) || null;
}

const taken = (f: Franchise) => new Set(f.draft.results.map((r) => r.playerId));
const available = (f: Franchise) => {
  const gone = taken(f);
  return f.draft.prospects.filter((p) => !gone.has(p.id));
};

const aiRead = (f: Franchise, p: Player) => readProspect(f.seed, p, AI_POINTS, 1);
const middle = (r: [number, number]) => (r[0] + r[1]) / 2;

/** How an AI team rates a prospect before its needs. */
export function boardScore(f: Franchise, p: Player) {
  const read = aiRead(f, p);
  return (middle(read.ovr) + middle(read.pot)) / 2;
}

export function aiChoice(f: Franchise, teamId: string): string {
  const roster = f.rosters[teamId].map((id) => f.players[id]);
  const score = (p: Player) => boardScore(f, p) + (roster.filter((x) => x.pos === p.pos).length < POSITION_DEPTH ? NEED_BONUS : 0);
  return available(f).reduce((a, b) => (score(b) > score(a) ? b : a)).id;
}

export function freeJersey(f: Franchise, teamId: string, wanted: number) {
  const used = new Set(f.rosters[teamId].map((id) => f.players[id].jersey));
  let n = wanted;
  while (used.has(n)) n = (n + 1) % 100;
  return n;
}

/** Whoever's left goes to free agency, still a mystery until they play. */
function closeDraft(f: Franchise): Franchise {
  const left = available(f);
  const players = { ...f.players };
  for (const p of left) players[p.id] = { ...p, file: { ...p.file!, range: aiRead(f, p) } };
  return { ...f, players, freeAgents: [...f.freeAgents, ...left.map((p) => p.id)] };
}

function select(f: Franchise, pick: DraftPick, prospectId: string): Franchise {
  const p = f.draft.prospects.find((x) => x.id === prospectId)!;
  const number = f.draft.results.length + 1;
  const teamId = pick.ownerId;
  const range = teamId === f.teamId ? prospectRange(f, p) : aiRead(f, p);
  const drafted: Player = {
    ...p,
    teamId,
    jersey: freeJersey(f, teamId, p.jersey),
    contract: rookieDeal(number, capRules(f.cap)),
    file: { service: 0, teamSeasons: 0, draft: { year: f.draft.year, pick: number, teamId }, range },
  };
  const next: Franchise = {
    ...f,
    players: { ...f.players, [p.id]: drafted },
    rosters: { ...f.rosters, [teamId]: [...f.rosters[teamId], p.id] },
    draft: { ...f.draft, results: [...f.draft.results, { pickId: pick.id, playerId: p.id, teamId }] },
  };
  return currentPick(next) ? next : closeDraft(next);
}

/** The user's own pick. Anything out of turn changes nothing. */
export function makePick(f: Franchise, prospectId: string): Franchise {
  const pick = currentPick(f);
  if (pick?.ownerId !== f.teamId || !available(f).some((p) => p.id === prospectId)) return f;
  return select(f, pick, prospectId);
}

/** AI teams pick until it's the user's turn, or for a set number of picks. */
export function simToUserPick(f: Franchise, limit = Infinity): Franchise {
  let next = f;
  for (let i = 0; i < limit; i++) {
    const pick = currentPick(next);
    if (!pick || pick.ownerId === next.teamId) break;
    next = select(next, pick, aiChoice(next, pick.ownerId));
  }
  return next;
}

/** Finishes the draft, with the user's staff making any picks left. */
export function simDraftToEnd(f: Franchise): Franchise {
  let next = f;
  for (let pick = currentPick(next); pick; pick = currentPick(next)) next = select(next, pick, aiChoice(next, pick.ownerId));
  return next;
}
