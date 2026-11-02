// Moves that change a roster without a trade: release, waivers, buyouts, two-way and developmental deals.
import { addDays } from "@/career/calendar";
import type { ScheduledGame } from "@/career/types";
import { fullName } from "@/engine/player";
import type { Contract, Player } from "@/engine/types";
import type { DeadCap, Franchise } from "../types";
import { payroll } from "./cap";
import { freeJersey } from "./draft";
import { marketValue } from "./market";
import { DEV_MAX, OFFSEASON_ROSTER_MAX, ROSTER_MAX, ROSTER_MIN, TWO_WAY_GAMES, TWO_WAY_MAX, capRules, roundMoney } from "./rules";

const WAIVER_DAYS = 2;
const MOST_GIVEN_BACK = 0.4;
const EARNED_ELSEWHERE = 0.5;

const guaranteedYears = (c: Contract) => Math.max(1, c.years - (c.teamOptionYears ?? 0));
export const guaranteed = (c: Contract) => c.salary * guaranteedYears(c);

const isTwoWay = (p: Player) => !!p.contract?.twoWay;
export const standardCount = (f: Franchise, teamId: string) => f.rosters[teamId].filter((id) => !isTwoWay(f.players[id])).length;
const rosterLimit = (f: Franchise) => (f.phase === "offseason" ? OFFSEASON_ROSTER_MAX : ROSTER_MAX);
const fromRoster = (f: Franchise, teamId: string, id: string) => ({ ...f.rosters, [teamId]: f.rosters[teamId].filter((x) => x !== id) });
const addDead = (f: Franchise, teamId: string, dead: DeadCap) => ({ ...f.books, [teamId]: { ...f.books[teamId], dead: [...f.books[teamId].dead, dead] } });

/** Who can play in this game. */
export function activeRoster(f: Franchise, teamId: string, g: ScheduledGame): Player[] {
  const roster = f.rosters[teamId].map((id) => f.players[id]);
  return roster.filter((p) => !isTwoWay(p) || (g.kind !== "playoff" && (f.season.stats[p.id]?.gp ?? 0) < TWO_WAY_GAMES));
}

/** Why the user's team can't take the floor. */
export function rosterProblem(f: Franchise): string | null {
  if (f.phase === "offseason") return null;
  const n = standardCount(f, f.teamId);
  return n >= ROSTER_MIN && n <= ROSTER_MAX
    ? null
    : `You have ${n} players on standard deals, and need ${ROSTER_MIN} to ${ROSTER_MAX} before you can play or sim.`;
}

/** Off the team and onto waivers. Until he clears them, his team still owes his money. */
export function releasePlayer(f: Franchise, id: string): Franchise {
  const p = f.players[id];
  const c = p.contract;
  if (!p.teamId || !c) return f;
  const teamId = p.teamId;
  const rosters = fromRoster(f, teamId, id);
  const devRosters = { ...f.devRosters, [teamId]: f.devRosters[teamId].filter((x) => x !== id) };
  if (c.twoWay || c.dev) return { ...f, rosters, devRosters, ...toMarket(f, p) };
  return {
    ...f,
    rosters,
    players: { ...f.players, [id]: { ...p, teamId: null } },
    books: addDead(f, teamId, { playerId: id, name: fullName(p), salary: c.salary, years: guaranteedYears(c) }),
    waivers: [...f.waivers, { playerId: id, fromTeamId: teamId, until: addDays(f.date, WAIVER_DAYS) }],
  };
}

function toMarket(f: Franchise, p: Player) {
  const out: Player = { ...p, teamId: null, file: { ...p.file!, teamSeasons: 0, lastSalary: p.contract?.salary, rightsTeamId: undefined } };
  delete out.contract;
  return { players: { ...f.players, [p.id]: out }, freeAgents: [...f.freeAgents, p.id] };
}

/** Takes a player and his whole contract off waivers. */
export function claimWaiver(f: Franchise, teamId: string, id: string): Franchise {
  const entry = f.waivers.find((w) => w.playerId === id);
  const p = f.players[id];
  if (!entry || standardCount(f, teamId) >= rosterLimit(f)) return f;
  const rules = capRules(f.cap);
  const salary = p.contract!.salary;
  if (salary > rules.minSalary && salary > rules.salaryCap - payroll(f, teamId)) return f;
  const books = { ...f.books[entry.fromTeamId], dead: f.books[entry.fromTeamId].dead.filter((d) => d.playerId !== id) };
  return {
    ...f,
    players: { ...f.players, [id]: { ...p, teamId, jersey: freeJersey(f, teamId, p.jersey), file: { ...p.file!, teamSeasons: 0 } } },
    rosters: { ...f.rosters, [teamId]: [...f.rosters[teamId], id] },
    books: { ...f.books, [entry.fromTeamId]: books },
    waivers: f.waivers.filter((w) => w.playerId !== id),
  };
}

const wins = (f: Franchise, teamId: string) =>
  f.season.games.filter((g) => g.result && g.kind === "region" && (g.result.home > g.result.away ? g.homeId : g.awayId) === teamId).length;

/** When a player's two days are up, the worst team that wants him gets him. Otherwise he's a free agent. */
export function processWaivers(f: Franchise): { franchise: Franchise; changedPlayers: string[] } {
  const due = f.waivers.filter((w) => w.until <= f.date);
  if (!due.length) return { franchise: f, changedPlayers: [] };
  const claimants = Object.keys(f.rosters)
    .filter((id) => id !== f.teamId)
    .sort((a, b) => wins(f, a) - wins(f, b) || a.localeCompare(b));
  let next = f;
  for (const w of due) {
    const p = next.players[w.playerId];
    if (marketValue(next, p) >= p.contract!.salary)
      for (const teamId of claimants) {
        if (standardCount(next, teamId) >= ROSTER_MAX) continue;
        const claimed = claimWaiver(next, teamId, w.playerId);
        if (claimed !== next) {
          next = claimed;
          break;
        }
      }
    if (next.waivers.includes(w)) next = { ...next, ...toMarket(next, p), waivers: next.waivers.filter((x) => x !== w) };
  }
  return { franchise: next, changedPlayers: due.map((w) => w.playerId) };
}

/** What he'll accept to leave: he gives back part of what he can earn elsewhere. */
export function buyoutAsk(f: Franchise, id: string): number {
  const p = f.players[id];
  const c = p.contract!;
  const owed = guaranteed(c);
  return roundMoney(owed - Math.min(owed * MOST_GIVEN_BACK, marketValue(f, p) * guaranteedYears(c) * EARNED_ELSEWHERE));
}

export function buyOut(f: Franchise, id: string, amount: number): Franchise {
  const p = f.players[id];
  const c = p.contract;
  if (!p.teamId || !c || c.twoWay || c.dev || amount < buyoutAsk(f, id)) return f;
  const years = guaranteedYears(c);
  return {
    ...f,
    rosters: fromRoster(f, p.teamId, id),
    books: addDead(f, p.teamId, { playerId: id, name: fullName(p), salary: amount / years, years }),
    ...toMarket(f, p),
  };
}

export function joinTeam(f: Franchise, teamId: string, id: string, contract: Contract) {
  const p = f.players[id];
  return {
    ...p,
    teamId,
    contract,
    jersey: freeJersey(f, teamId, p.jersey),
    file: { ...p.file!, rightsTeamId: undefined, teamSeasons: p.file?.rightsTeamId === teamId ? p.file.teamSeasons : 0 },
  };
}

export function signTwoWay(f: Franchise, teamId: string, id: string): Franchise {
  if (!f.freeAgents.includes(id) || f.rosters[teamId].filter((x) => isTwoWay(f.players[x])).length >= TWO_WAY_MAX) return f;
  const player = joinTeam(f, teamId, id, { salary: capRules(f.cap).twoWaySalary, years: 1, twoWay: true });
  return {
    ...f,
    players: { ...f.players, [id]: player },
    rosters: { ...f.rosters, [teamId]: [...f.rosters[teamId], id] },
    freeAgents: f.freeAgents.filter((x) => x !== id),
  };
}

export function signDev(f: Franchise, teamId: string, id: string): Franchise {
  if (!f.freeAgents.includes(id) || f.devRosters[teamId].length >= DEV_MAX) return f;
  const player = joinTeam(f, teamId, id, { salary: capRules(f.cap).devSalary, years: 1, dev: true });
  return {
    ...f,
    players: { ...f.players, [id]: player },
    devRosters: { ...f.devRosters, [teamId]: [...f.devRosters[teamId], id] },
    freeAgents: f.freeAgents.filter((x) => x !== id),
  };
}

/** A two-way or developmental player moves up to a standard minimum deal. */
export function callUp(f: Franchise, id: string): Franchise {
  const p = f.players[id];
  if (!p.teamId || !(p.contract?.dev || p.contract?.twoWay) || standardCount(f, p.teamId) >= rosterLimit(f)) return f;
  const teamId = p.teamId;
  const onRoster = f.rosters[teamId].includes(id);
  return {
    ...f,
    players: { ...f.players, [id]: { ...p, contract: { salary: capRules(f.cap).minSalary, years: 1 } } },
    rosters: onRoster ? f.rosters : { ...f.rosters, [teamId]: [...f.rosters[teamId], id] },
    devRosters: { ...f.devRosters, [teamId]: f.devRosters[teamId].filter((x) => x !== id) },
  };
}
