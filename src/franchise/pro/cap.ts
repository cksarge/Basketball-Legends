// What a team has spent and what it can pay. AI teams and the user go through the same checks.
import type { Player } from "@/engine/types";
import type { Franchise } from "../types";
import { capRules, roundMoney, type CapRules } from "./rules";

const EARLY_RIGHTS_SALARY = 1.75;
const EARLY_RIGHTS_AVERAGE = 1.05;
const FULL_RIGHTS_SEASONS = 3;
const TAX_BRACKET = 5 / 140;
const TAX_RATES = [1.5, 1.75, 2.5, 3.25];
const TAX_RATE_STEP = 0.5;

export type SigningVia = "rights" | "cap" | "minimum" | "roomMidLevel" | "midLevel" | "taxMidLevel" | "biannual";
export interface SigningRoom {
  limit: number;
  via: SigningVia;
}
export type SignCheck = { ok: true; via: SigningVia } | { ok: false; reason: string };

export const moneyM = (n: number) => `$${(n / 1e6).toFixed(1)}M`;

const onCap = (p: Player) => !!p.contract && !p.contract.twoWay && !p.contract.dev;

export function payroll(f: Franchise, teamId: string): number {
  const salaries = f.rosters[teamId].reduce((sum, id) => sum + (onCap(f.players[id]) ? f.players[id].contract!.salary : 0), 0);
  return salaries + f.books[teamId].dead.reduce((sum, d) => sum + d.salary, 0);
}

/** The tax rises by the bracket the further a team goes over the line. */
export function taxBill(pay: number, rules: CapRules): number {
  const bracket = rules.salaryCap * TAX_BRACKET;
  let over = pay - rules.taxLine;
  let bill = 0;
  for (let i = 0; over > 0; i++) {
    const rate = TAX_RATES[i] ?? TAX_RATES[TAX_RATES.length - 1] + TAX_RATE_STEP * (i - TAX_RATES.length + 1);
    bill += Math.min(over, bracket) * rate;
    over -= bracket;
  }
  return bill;
}

export function veteranRights(p: Player, teamId: string): "full" | "early" | "none" {
  if ((p.teamId ?? p.file?.rightsTeamId) !== teamId) return "none";
  // tenure ticks over on July 1, so the season a rostered player is in counts too
  const seasons = (p.file?.teamSeasons ?? 0) + (p.teamId === teamId ? 1 : 0);
  return seasons >= FULL_RIGHTS_SEASONS ? "full" : seasons >= 1 ? "early" : "none";
}

export function leagueAverageSalary(f: Franchise): number {
  const deals = Object.values(f.rosters)
    .flat()
    .map((id) => f.players[id])
    .filter(onCap);
  return deals.reduce((sum, p) => sum + p.contract!.salary, 0) / Math.max(1, deals.length);
}

export function rightsLimit(f: Franchise, p: Player, teamId: string): number {
  const rights = veteranRights(p, teamId);
  if (rights === "none") return 0;
  const most = capRules(f.cap).maxSalary(p.file?.service ?? 0);
  if (rights === "full") return most;
  const last = p.file?.lastSalary ?? p.contract?.salary ?? 0;
  return Math.min(most, roundMoney(Math.max(last * EARLY_RIGHTS_SALARY, leagueAverageSalary(f) * EARLY_RIGHTS_AVERAGE)));
}

/** Every way this team could pay this player, cheapest resource first. */
function signingPaths(f: Franchise, teamId: string, p: Player): SigningRoom[] {
  const rules = capRules(f.cap);
  const pay = payroll(f, teamId);
  const books = f.books[teamId];
  const midLeft = (size: number) => size - books.midLevelUsed;
  const paths: SigningRoom[] = [];
  const add = (via: SigningVia, limit: number, open = true) => {
    if (open && limit > 0) paths.push({ via, limit });
  };
  add("rights", rightsLimit(f, p, teamId));
  add("cap", rules.salaryCap - pay);
  add("minimum", rules.minSalary);
  add("roomMidLevel", midLeft(rules.roomMidLevel), pay <= rules.salaryCap);
  add("midLevel", midLeft(rules.midLevel), pay > rules.salaryCap && pay < rules.firstApron);
  add("taxMidLevel", midLeft(rules.taxMidLevel), pay >= rules.firstApron && pay < rules.secondApron);
  add("biannual", rules.biannual, pay < rules.firstApron && (books.biannualYear === undefined || books.biannualYear < f.cap.year - 1));
  return paths;
}

/** The most this team can pay this player, and how. */
export function signingRoom(f: Franchise, teamId: string, p: Player): SigningRoom {
  return signingPaths(f, teamId, p).reduce((a, b) => (b.limit > a.limit ? b : a));
}

export function canSign(f: Franchise, teamId: string, p: Player, salary: number): SignCheck {
  const rules = capRules(f.cap);
  const most = rules.maxSalary(p.file?.service ?? 0);
  if (salary < rules.minSalary) return { ok: false, reason: `That's under the ${moneyM(rules.minSalary)} minimum.` };
  if (salary > most) return { ok: false, reason: `His maximum salary is ${moneyM(most)}.` };
  const path = signingPaths(f, teamId, p).find((x) => x.limit >= salary);
  return path ? { ok: true, via: path.via } : { ok: false, reason: `The most this team can pay him is ${moneyM(signingRoom(f, teamId, p).limit)}.` };
}

/** Records what a signing used up. */
export function useException(f: Franchise, teamId: string, via: SigningVia, salary: number): Franchise {
  const books = f.books[teamId];
  if (via === "midLevel" || via === "roomMidLevel" || via === "taxMidLevel")
    return { ...f, books: { ...f.books, [teamId]: { ...books, midLevelUsed: books.midLevelUsed + salary } } };
  if (via === "biannual") return { ...f, books: { ...f.books, [teamId]: { ...books, biannualYear: f.cap.year } } };
  return f;
}
