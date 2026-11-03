// A contract's life: options, extensions and the turn of the contract year.
import type { Contract, Player } from "@/engine/types";
import type { Franchise, TeamBooks } from "../types";
import { marketValue } from "./market";
import { nextCap } from "./rules";

/** An AI team keeps an option if the player's worth at least this share of it. */
const KEEP_OPTION = 0.8;

const rosterOf = (f: Franchise, teamId: string) => f.rosters[teamId].map((id) => f.players[id]);
const withContract = (f: Franchise, id: string, contract: Contract): Franchise => ({ ...f, players: { ...f.players, [id]: { ...f.players[id], contract } } });

/** Next year is a team option that hasn't been decided. */
const optionDue = (c?: Contract) => !!c?.teamOptionYears && c.years - 1 === c.teamOptionYears;

export const pendingOptions = (f: Franchise, teamId: string): Player[] => rosterOf(f, teamId).filter((p) => optionDue(p.contract));

export function setTeamOption(f: Franchise, id: string, exercise: boolean): Franchise {
  const c = f.players[id].contract;
  if (!optionDue(c)) return f;
  const opts = c!.teamOptionYears!;
  return withContract(f, id, exercise ? { ...c!, teamOptionYears: opts - 1 } : { ...c!, years: c!.years - opts, teamOptionYears: 0 });
}

/** True when the player stays on his option year. */
export const playerOptionChoice = (f: Franchise, p: Player) => p.contract!.salary >= marketValue(f, p);

export const expiring = (f: Franchise, teamId: string): Player[] => rosterOf(f, teamId).filter((p) => p.contract?.years === 1 && !p.contract.extension);

export function extendContract(
  f: Franchise,
  id: string,
  salary: number,
  years: number,
  options: { playerOption?: boolean; teamOption?: boolean } = {},
): Franchise {
  const c = f.players[id].contract;
  if (c?.years !== 1) return f;
  return withContract(f, id, { ...c, extension: { salary, years, ...(years > 1 ? options : {}) } });
}

/** The call an AI front office makes on a team option. */
export const decideOptionsFor = (f: Franchise, id: string) =>
  setTeamOption(f, id, marketValue(f, f.players[id]) >= f.players[id].contract!.salary * KEEP_OPTION);

/** Everyone but the user's front office decides: players on their options, AI teams on theirs. */
export function decideOptions(f: Franchise): Franchise {
  let next = f;
  for (const [teamId, ids] of Object.entries(f.rosters))
    for (const id of ids) {
      const p = next.players[id];
      if (teamId !== f.teamId && optionDue(p.contract)) next = decideOptionsFor(next, id);
      const c = next.players[id].contract;
      if (c?.playerOption && c.years === 2)
        next = withContract(next, id, playerOptionChoice(next, next.players[id]) ? { ...c, playerOption: false } : { ...c, years: 1 });
    }
  return next;
}

function nextDeal(c: Contract): Contract | undefined {
  if (c.extension) {
    const { salary, years, playerOption, teamOption } = c.extension;
    return { salary, years, ...(playerOption ? { playerOption } : {}), ...(teamOption ? { teamOptionYears: 1 } : {}) };
  }
  const deal = { ...c, years: c.years - 1 };
  return deal.years > 0 ? deal : undefined;
}

/** The first of July: every deal loses a year, extensions start, and expired players reach the market. */
export function rollContracts(f: Franchise): Franchise {
  const players = { ...f.players };
  const rosters = { ...f.rosters };
  const devRosters = { ...f.devRosters };
  const freeAgents = [...f.freeAgents];
  // sorted, because a loaded save lists players in a different order than a running one
  for (const id of Object.keys(f.players).sort()) {
    const p = f.players[id];
    if (!p.teamId || !p.contract) continue;
    if (p.contract.startsNext) {
      const contract = { ...p.contract };
      delete contract.startsNext;
      players[id] = { ...p, contract };
      continue;
    }
    const teamId = p.teamId;
    const file = { ...p.file!, service: p.file!.service + 1, teamSeasons: p.file!.teamSeasons + 1 };
    const deal = nextDeal(p.contract);
    if (deal) {
      players[p.id] = { ...p, file, contract: deal };
      continue;
    }
    const out: Player = { ...p, teamId: null, file: { ...file, lastSalary: p.contract.salary, rightsTeamId: teamId, lastTeamId: teamId } };
    delete out.contract;
    players[p.id] = out;
    rosters[teamId] = rosters[teamId].filter((id) => id !== p.id);
    devRosters[teamId] = devRosters[teamId].filter((id) => id !== p.id);
    freeAgents.push(p.id);
  }
  const books = Object.fromEntries(
    Object.entries(f.books).map(([id, b]): [string, TeamBooks] => [
      id,
      { ...b, midLevelUsed: 0, dead: b.dead.map((d) => ({ ...d, years: d.years - 1 })).filter((d) => d.years > 0) },
    ]),
  );
  return { ...f, players, rosters, devRosters, freeAgents, books, cap: nextCap(f.cap, f.seed, f.revenueGrowth) };
}
