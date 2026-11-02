// Free agency: a moratorium for bids, five rounds of decisions, then an open market that lasts all season.
import { daysBetween, iso } from "@/career/calendar";
import { fullName, generatePlayer, playerOvr } from "@/engine/player";
import { Rng, clamp } from "@/engine/rng";
import type { Contract, Player } from "@/engine/types";
import { clearUndo } from "../core/moves";
import type { Franchise, FreeAgencyState } from "../types";
import { canSign, moneyM, signingRoom, spendException, type SigningVia } from "./cap";
import { decideOptionsFor, pendingOptions } from "./contracts";
import { askingPrice, marketValue, offerScore, type Offer } from "./market";
import { joinTeam, releasePlayer, standardCount } from "./rosterMoves";
import { OFFSEASON_ROSTER_MAX, ROSTER_MAX, ROSTER_MIN, capRules, roundMoney } from "./rules";

export const BIDDING_ROUNDS = 5;
const ROUND_DAYS = [6, 8, 10, 12, 14];
const LAST_ROUND_BAR = 0.62;
const ROUND_BAR_STEP = 0.07;
/** How many of the best players AI teams chase each round. */
const CHASED = 60;
const TEAMS_PER_PLAYER = 8;
const BIDS_PER_TEAM = 2;
const RESIGN_CHANCE = 0.75;
/** A team wants a player who'd be in its top nine. */
const ROTATION = 9;
/** Below this, a team takes depth too. */
const DEPTH_TARGET = 14;
/** Open-market asks fall by this much of the price per day, down to the floor. */
const ASK_FALL_DAYS = 400;
const ASK_FLOOR = 0.5;
const LOWEST_DEAL = 0.5;
const WEEKLY_PLAYERS = 5;
const WEEKLY_TEAMS = 5;
const HURT_TEAM = 3;
const REPLACEMENT_OVR = 62;

const aiTeams = (f: Franchise) => Object.keys(f.rosters).filter((id) => id !== f.teamId);
export const roundBar = (round: number) => LAST_ROUND_BAR + (BIDDING_ROUNDS - round) * ROUND_BAR_STEP;
const ahead = (f: Franchise, p: Player, teamId: string) => f.rosters[teamId].filter((id) => playerOvr(f.players[id]) > playerOvr(p)).length;
const byValue = (f: Franchise, ids: string[]) => [...ids].sort((a, b) => marketValue(f, f.players[b]) - marketValue(f, f.players[a]));
const rosterMax = (f: Franchise) => (f.phase === "offseason" ? OFFSEASON_ROSTER_MAX : ROSTER_MAX);

function dealOf(o: Offer): Contract {
  return { salary: o.salary, years: o.years, ...(o.playerOption ? { playerOption: true } : {}), ...(o.teamOption ? { teamOptionYears: 1 } : {}) };
}

/** Signs a free agent who's already been checked against the cap. */
function sign(f: Franchise, id: string, o: Offer, via: SigningVia): Franchise {
  return {
    ...spendException(f, o.teamId, via, o.salary),
    players: { ...f.players, [id]: joinTeam(f, o.teamId, id, dealOf(o)) },
    rosters: { ...f.rosters, [o.teamId]: [...f.rosters[o.teamId], id] },
    freeAgents: f.freeAgents.filter((x) => x !== id),
  };
}

/** Everything that would stop this offer right now. */
function offerProblem(f: Franchise, id: string, o: Offer): string | null {
  if (standardCount(f, o.teamId) >= rosterMax(f)) return "There's no roster spot for him.";
  const check = canSign(f, o.teamId, f.players[id], o.salary);
  return check.ok ? null : check.reason;
}

export function openFreeAgency(f: Franchise): Franchise {
  const freeAgency: FreeAgencyState = { stage: "moratorium", round: 0, bids: [], signed: [], notices: [] };
  return { ...f, freeAgency };
}

/** The team as it'd be if all its other bids were accepted. */
function withBids(f: Franchise, teamId: string, except: string): Franchise {
  let next = f;
  for (const b of f.freeAgency?.bids ?? []) {
    if (b.teamId !== teamId || b.playerId === except) continue;
    const check = canSign(next, teamId, next.players[b.playerId], b.salary);
    if (check.ok) next = sign(next, b.playerId, b, check.via);
  }
  return next;
}

export type MoveResult = { ok: true; franchise: Franchise } | { ok: false; reason: string };

export function placeBid(f: Franchise, playerId: string, offer: Offer): MoveResult {
  const st = f.freeAgency;
  if (!st || st.stage === "open") return { ok: false, reason: "The bidding rounds are over." };
  if (!f.freeAgents.includes(playerId)) return { ok: false, reason: "He isn't a free agent." };
  const reason = offerProblem(withBids(f, offer.teamId, playerId), playerId, offer);
  if (reason) return { ok: false, reason };
  const bids = [...st.bids.filter((b) => b.playerId !== playerId || b.teamId !== offer.teamId), { ...offer, playerId }];
  return { ok: true, franchise: { ...f, freeAgency: { ...st, bids } } };
}

export function withdrawBid(f: Franchise, playerId: string): Franchise {
  const st = f.freeAgency;
  return st ? { ...f, freeAgency: { ...st, bids: st.bids.filter((b) => b.playerId !== playerId || b.teamId !== f.teamId) } } : f;
}

function aiBids(f: Franchise, rng: Rng): (Offer & { playerId: string })[] {
  const out: (Offer & { playerId: string })[] = [];
  const placed = new Map<string, number>();
  const teams = aiTeams(f);
  for (const playerId of byValue(f, f.freeAgents).slice(0, CHASED)) {
    const p = f.players[playerId];
    for (const teamId of rng.shuffle([...teams]).slice(0, TEAMS_PER_PLAYER)) {
      const count = standardCount(f, teamId);
      const wanted = count < DEPTH_TARGET || (count < ROSTER_MAX && ahead(f, p, teamId) < ROTATION);
      if (!wanted || (placed.get(teamId) ?? 0) >= BIDS_PER_TEAM) continue;
      const ask = askingPrice(f, p, teamId);
      const salary = roundMoney(Math.min(ask.salary * rng.range(0.92, 1.08), signingRoom(f, teamId, p).limit));
      if (salary < ask.salary * LOWEST_DEAL) continue;
      out.push({ playerId, teamId, salary, years: clamp(rng.int(1, 4), 1, ask.years) });
      placed.set(teamId, (placed.get(teamId) ?? 0) + 1);
    }
  }
  return out;
}

/** Each player, best first, looks at his bids and signs if the best one clears the bar for this round. */
function runRound(f: Franchise): Franchise {
  const st = f.freeAgency!;
  const round = st.round + 1;
  const date = iso(+f.date.slice(0, 4), 7, ROUND_DAYS[round - 1]);
  const rng = new Rng(`${f.seed}:bids:${f.cap.year}:${round}`);
  let next: Franchise = { ...f, date: date > f.date ? date : f.date };
  const notices: string[] = [];
  const kept: FreeAgencyState["bids"] = [];
  const all = [...st.bids, ...aiBids(next, rng)];
  const signed = [...st.signed];
  for (const playerId of byValue(next, [...new Set(all.map((b) => b.playerId))])) {
    if (!next.freeAgents.includes(playerId)) continue;
    const p = next.players[playerId];
    const live = all.filter((b) => {
      if (b.playerId !== playerId) return false;
      const reason = offerProblem(next, playerId, b);
      if (reason && b.teamId === f.teamId) notices.push(`Your bid for ${fullName(p)} was dropped. ${reason}`);
      return !reason;
    });
    const scored = live.map((b) => ({ b, score: offerScore(next, p, b) })).sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best || best.score < roundBar(round)) {
      kept.push(...live.filter((b) => b.teamId === f.teamId));
      continue;
    }
    const check = canSign(next, best.b.teamId, p, best.b.salary);
    if (!check.ok) continue;
    next = sign(next, playerId, best.b, check.via);
    signed.push({ playerId, teamId: best.b.teamId, salary: best.b.salary, years: best.b.years, round, via: check.via });
    if (best.b.teamId === f.teamId) notices.push(`${fullName(p)} accepted your offer.`);
    else if (live.some((b) => b.teamId === f.teamId)) notices.push(`${fullName(p)} chose another team.`);
  }
  return { ...next, freeAgency: { stage: round >= BIDDING_ROUNDS ? "open" : "bidding", round, bids: kept, signed, notices } };
}

/** On to the next round. After the moratorium, this is round one. */
export const nextRound = (f: Franchise): Franchise => (!f.freeAgency || f.freeAgency.stage === "open" ? f : clearUndo(runRound(f)));

export function finishBidding(f: Franchise): Franchise {
  let next = f;
  while (next.freeAgency && next.freeAgency.stage !== "open") next = runRound(next);
  return next;
}

/** How far an open-market ask has fallen. */
export function marketFactor(f: Franchise) {
  return clamp(1 - Math.max(0, daysBetween(iso(f.cap.year, 7, ROUND_DAYS[ROUND_DAYS.length - 1]), f.date)) / ASK_FALL_DAYS, ASK_FLOOR, 1);
}

/** Signs a free agent on the spot, once the rounds are done. */
export function signNow(f: Franchise, playerId: string, offer: Offer): MoveResult {
  const stage = f.freeAgency?.stage;
  if (stage === "moratorium") return { ok: false, reason: "Nothing can sign during the moratorium. Place a bid for round one." };
  if (stage === "bidding") return { ok: false, reason: "The bidding rounds are on. Place a bid." };
  if (f.offseason && !stage) return { ok: false, reason: "Free agency opens July 1." };
  if (!f.freeAgents.includes(playerId)) return { ok: false, reason: "He isn't a free agent." };
  const reason = offerProblem(f, playerId, offer);
  if (reason) return { ok: false, reason };
  const p = f.players[playerId];
  const factor = marketFactor(f);
  if (offerScore(f, p, offer) < factor)
    return {
      ok: false,
      reason: `He wants about ${moneyM(askingPrice(f, p, offer.teamId).salary * factor)} for ${askingPrice(f, p, offer.teamId).years} years.`,
    };
  const check = canSign(f, offer.teamId, p, offer.salary);
  return check.ok ? { ok: true, franchise: sign(f, playerId, offer, check.via) } : { ok: false, reason: check.reason };
}

/** Before the market opens, AI teams keep the players they still want. */
export function aiResign(f: Franchise): Franchise {
  let next = f;
  const rng = new Rng(`${f.seed}:resign:${f.cap.year}`);
  for (const id of byValue(f, f.freeAgents)) {
    const p = next.players[id];
    const teamId = p.file?.rightsTeamId;
    if (!teamId || teamId === f.teamId || standardCount(next, teamId) >= ROSTER_MAX || ahead(next, p, teamId) >= ROTATION || !rng.chance(RESIGN_CHANCE))
      continue;
    const ask = askingPrice(next, p, teamId);
    const check = canSign(next, teamId, p, ask.salary);
    if (check.ok) next = sign(next, id, { teamId, ...ask }, check.via);
  }
  return next;
}

const worth = (p: Player) => playerOvr(p) + Math.max(0, p.potential - playerOvr(p)) * 0.15;

/** A team below its minimum with nobody left to sign finds someone from overseas. */
function replacement(f: Franchise, teamId: string): Player {
  const n = Object.keys(f.players).length;
  const rng = new Rng(`${f.seed}:replacement:${f.cap.year}:${teamId}:${n}`);
  const age = rng.int(23, 29);
  const p = generatePlayer(rng, { targetOvr: REPLACEMENT_OVR, age, league: "pro", teamId: null, hometownPool: "intl" });
  return { ...p, id: `fa-${f.cap.year}-${teamId}-${n}`, file: { service: 0, teamSeasons: 0 } };
}

/** Fills one spot with the best free agent the team can afford, for one year. */
function fillSpot(f: Franchise, teamId: string): Franchise {
  const rules = capRules(f.cap);
  for (const id of [...f.freeAgents].sort((a, b) => playerOvr(f.players[b]) - playerOvr(f.players[a]))) {
    const p = f.players[id];
    const value = marketValue(f, p) * marketFactor(f);
    const salary = roundMoney(Math.max(rules.minSalary, Math.min(value, signingRoom(f, teamId, p).limit)));
    if (salary < value * LOWEST_DEAL) continue;
    const check = canSign(f, teamId, p, salary);
    if (check.ok) return sign(f, id, { teamId, salary, years: 1 }, check.via);
  }
  const p = replacement(f, teamId);
  const withPlayer = { ...f, players: { ...f.players, [p.id]: p }, freeAgents: [...f.freeAgents, p.id] };
  return sign(withPlayer, p.id, { teamId, salary: rules.minSalary, years: 1 }, "minimum");
}

/** Cuts the weakest players down to a limit. Their contracts still count. */
export function cutTo(f: Franchise, teamId: string, limit: number): Franchise {
  let next = f;
  const standard = f.rosters[teamId].filter((id) => !f.players[id].contract?.twoWay).sort((a, b) => worth(f.players[a]) - worth(f.players[b]));
  for (const id of standard.slice(0, Math.max(0, standard.length - limit))) next = releasePlayer(next, id);
  return next;
}

/** Brings a team inside the roster limits. */
export function setRoster(f: Franchise, teamId: string): Franchise {
  let next = cutTo(f, teamId, ROSTER_MAX);
  while (standardCount(next, teamId) < ROSTER_MIN) next = fillSpot(next, teamId);
  return next;
}

export const aiFillRosters = (f: Franchise): Franchise => aiTeams(f).reduce(setRoster, f);

/** The user's staff makes the calls for this step. */
export function staffHandles(f: Franchise): Franchise {
  if (f.offseason?.step === "contracts") return pendingOptions(f, f.teamId).reduce((x, p) => decideOptionsFor(x, p.id), f);
  if (f.offseason?.step === "camp") return setRoster(f, f.teamId);
  return f;
}

/** Each week of the season, thin teams fill out and the best unsigned players find deals. */
export function weeklyMarket(f: Franchise): { franchise: Franchise; changedPlayers: string[] } {
  const rng = new Rng(`${f.seed}:market:${f.date}`);
  const before = new Set(f.freeAgents);
  let next = f;
  for (const teamId of aiTeams(f)) {
    const hurt = next.rosters[teamId].filter((id) => next.players[id].injury).length;
    if (standardCount(next, teamId) < ROSTER_MIN) next = setRoster(next, teamId);
    else if (hurt >= HURT_TEAM && standardCount(next, teamId) < ROSTER_MAX) next = fillSpot(next, teamId);
  }
  const factor = marketFactor(next);
  for (const id of byValue(next, next.freeAgents).slice(0, WEEKLY_PLAYERS)) {
    const p = next.players[id];
    const value = marketValue(next, p) * factor;
    for (const teamId of rng.shuffle(aiTeams(next)).slice(0, WEEKLY_TEAMS)) {
      if (standardCount(next, teamId) >= ROSTER_MAX || ahead(next, p, teamId) >= ROTATION) continue;
      const salary = roundMoney(Math.max(capRules(next.cap).minSalary, value));
      const check = canSign(next, teamId, p, salary);
      if (check.ok) {
        next = sign(next, id, { teamId, salary, years: 1 }, check.via);
        break;
      }
    }
  }
  const added = next === f ? [] : Object.keys(next.players).filter((id) => !f.players[id]);
  const signed = [...before].filter((id) => !next.freeAgents.includes(id));
  return { franchise: next, changedPlayers: [...added, ...signed] };
}
