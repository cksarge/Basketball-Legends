// A club's money: the gate, sponsors and TV coming in, payroll, staff, budgets and the tax going out.
import { clamp } from "@/engine/rng";
import type { Team } from "@/engine/types";
import type { BudgetKey, Franchise, TeamFinance } from "../types";
import { payroll, taxBill } from "../pro/cap";
import { winShare } from "../pro/market";
import { START_CAP, capRules, roundMoney, ticketBase } from "../pro/rules";

const DEMAND_BASE = 0.55;
const HYPE_DEMAND = 250;
const WIN_DEMAND = 0.3;
const FACILITY_DEMAND = 500;
/** Above 1, so a price past what fills the arena earns less. */
const PRICE_ELASTICITY = 1.6;
const TV_PER_GAME = 2_500_000;
const SPONSORS_PER_GAME = 1_200_000;
const PLAYOFF_TICKETS = 1.5;
const MIN_TICKET = 10;
const MAX_TICKET = 1000;
const HYPE_FROM_WINS = 40;
const TITLE_HYPE = 8;
const FACILITY_DRIFT = 3;
const EMPTY_SEASON = { revenue: 0, expenses: 0, attendance: 0, homeGames: 0 };

const capScale = (f: Franchise) => f.cap.salaryCap / START_CAP;

export function attendance(f: Franchise, teamId: string, capacity: number): number {
  const b = f.finance[teamId];
  const interest = DEMAND_BASE + b.hype / HYPE_DEMAND + winShare(f, teamId) * WIN_DEMAND + (b.facilities - 50) / FACILITY_DEMAND;
  const price = (ticketBase(f.cap) / b.ticketPrice) ** PRICE_ELASTICITY;
  return Math.round(Math.min(capacity, capacity * interest * price));
}

export function homeGameRevenue(f: Franchise, team: Team, playoff = false): number {
  const tickets = attendance(f, team.id, team.arena.capacity) * f.finance[team.id].ticketPrice * (playoff ? PLAYOFF_TICKETS : 1);
  return Math.round(tickets + (TV_PER_GAME + team.prestige * SPONSORS_PER_GAME) * capScale(f));
}

export function recordHomeGame(f: Franchise, team: Team, playoff = false): Franchise {
  const b = f.finance[team.id];
  const season = {
    ...b.season,
    revenue: b.season.revenue + homeGameRevenue(f, team, playoff),
    attendance: b.season.attendance + attendance(f, team.id, team.arena.capacity),
    homeGames: b.season.homeGames + 1,
  };
  return { ...f, finance: { ...f.finance, [team.id]: { ...b, season } } };
}

/** Pays the home team for every decided game that hasn't paid yet. */
export function payGates(f: Franchise, teams: Team[]): Franchise {
  if (!f.season.games.some((g) => g.result && !g.result.gatePaid)) return f;
  const byId = new Map(teams.map((t) => [t.id, t]));
  let next = f;
  const games = f.season.games.map((g) => {
    if (!g.result || g.result.gatePaid) return g;
    next = recordHomeGame(next, byId.get(g.homeId)!, g.kind === "playoff");
    return { ...g, result: { ...g.result, gatePaid: true } };
  });
  return { ...next, season: { ...next.season, games } };
}

/** What this season will cost when the books close. */
export function seasonExpenses(f: Franchise, teamId: string): number {
  const b = f.finance[teamId];
  const rules = capRules(f.cap);
  const pay = payroll(f, teamId);
  const staff = teamId === f.teamId ? f.plan.staff.reduce((sum, s) => sum + s.salary, 0) : 0;
  const lowDeals = f.rosters[teamId].reduce((sum, id) => sum + (f.players[id].contract?.twoWay ? f.players[id].contract!.salary : 0), 0);
  return pay + staff + lowDeals + b.budgets.coaching + b.budgets.scouting + b.budgets.facilities + taxBill(pay, rules);
}

function closeTeam(f: Franchise, team: Team): TeamFinance {
  const b = f.finance[team.id];
  const rules = capRules(f.cap);
  const expenses = seasonExpenses(f, team.id);
  const profit = b.season.revenue - expenses;
  const title = f.season.championId === team.id ? TITLE_HYPE : 0;
  const mine = team.id === f.teamId;
  return {
    ...b,
    ticketPrice: mine ? b.ticketPrice : ticketBase(f.cap),
    budgets: mine ? b.budgets : { coaching: rules.budgetDefault, scouting: rules.budgetDefault, facilities: rules.budgetDefault },
    hype: clamp(b.hype + (winShare(f, team.id) - 0.5) * HYPE_FROM_WINS + title, 0, 100),
    facilities: clamp(b.facilities + (b.budgets.facilities / rules.budgetDefault - 1) * FACILITY_DRIFT, 0, 100),
    balance: b.balance + profit,
    season: EMPTY_SEASON,
    lastSeason: { revenue: b.season.revenue, expenses, profit, attendance: b.season.homeGames ? Math.round(b.season.attendance / b.season.homeGames) : 0 },
  };
}

export const leagueRevenue = (f: Franchise) => Object.values(f.finance).reduce((sum, b) => sum + (b.lastSeason?.revenue ?? b.season.revenue), 0);

/** The year's books for every team, and how the league's money moved against the cap. */
export function closeSeasonBooks(f: Franchise, teams: Team[]): Franchise {
  const revenue = Object.values(f.finance).reduce((sum, b) => sum + b.season.revenue, 0);
  const per = revenue / f.cap.salaryCap;
  const growth = f.revenueBase ? per / f.revenueBase - 1 : undefined;
  return {
    ...f,
    finance: Object.fromEntries(teams.map((t) => [t.id, closeTeam(f, t)])),
    revenueBase: per,
    ...(growth === undefined ? {} : { revenueGrowth: growth }),
  };
}

const setTeam = (f: Franchise, patch: Partial<TeamFinance>): Franchise => ({
  ...f,
  finance: { ...f.finance, [f.teamId]: { ...f.finance[f.teamId], ...patch } },
});

export const setTicketPrice = (f: Franchise, price: number) =>
  setTeam(f, { ticketPrice: Math.round(clamp(price, MIN_TICKET * capScale(f), MAX_TICKET * capScale(f))) });

export function setBudget(f: Franchise, key: BudgetKey, amount: number): Franchise {
  const r = capRules(f.cap);
  return setTeam(f, { budgets: { ...f.finance[f.teamId].budgets, [key]: roundMoney(clamp(amount, r.budgetMin, r.budgetMax)) } });
}

/** What the user's budget does to its system: 1 at the default. */
export const budgetEffect = (f: Franchise, key: BudgetKey) => Math.sqrt(f.finance[f.teamId].budgets[key] / capRules(f.cap).budgetDefault);
