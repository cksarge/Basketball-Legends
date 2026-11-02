import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Team } from "@/engine/types";
import { hireStaff } from "../coaching/staff";
import { weeklyDevelopment } from "../coaching/development";
import { simDay } from "../core/season";
import { createFranchise } from "../create";
import { attendance, budgetEffect, closeSeasonBooks, homeGameRevenue, leagueRevenue, recordHomeGame, setBudget, setTicketPrice } from "../club/finance";
import { payroll, taxBill } from "../pro/cap";
import { mood } from "../pro/market";
import { capRules, nextCap } from "../pro/rules";
import { prospectRange } from "../pro/scouting";
import type { Franchise } from "../types";
import { setPayroll } from "./capHelpers";
import { finishedSeason } from "./draftHelpers";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const team = teams[0];
const make = (seed = "money") => createFranchise({ league: "pro", team, teams, seed, now: 1 });
const big = [...teams].sort((a, b) => b.arena.capacity * b.prestige - a.arena.capacity * a.prestige)[0];
const small = [...teams].sort((a, b) => a.arena.capacity * a.prestige - b.arena.capacity * b.prestige)[0];
const mine = (f: Franchise) => f.finance[f.teamId];
const withHype = (f: Franchise, hype: number): Franchise => ({ ...f, finance: { ...f.finance, [f.teamId]: { ...mine(f), hype } } });
const priced = (f: Franchise, ticketPrice: number): Franchise => ({ ...f, finance: { ...f.finance, [f.teamId]: { ...mine(f), ticketPrice } } });

describe("the gate", () => {
  it("a higher ticket price sells fewer seats and can earn more up to a point", () => {
    const f = make();
    const seats = (p: number) => attendance(priced(f, p), f.teamId, team.arena.capacity);
    expect(seats(600)).toBeLessThan(seats(120));
    const gate = (p: number) => seats(p) * p;
    expect(gate(150)).toBeGreaterThan(gate(50));
    expect(gate(5000)).toBeLessThan(gate(150));
  });

  it("attendance never passes the arena's capacity", () => {
    const f = withHype(priced(make(), 5), 100);
    expect(attendance(f, f.teamId, team.arena.capacity)).toBe(team.arena.capacity);
  });

  it("hype fills seats", () => {
    const f = priced(make(), 300);
    expect(attendance(withHype(f, 90), f.teamId, team.arena.capacity)).toBeGreaterThan(attendance(withHype(f, 10), f.teamId, team.arena.capacity));
  });

  it("a bigger arena and more prestige earn more", () => {
    const f = make();
    expect(homeGameRevenue(f, big)).toBeGreaterThan(homeGameRevenue(f, small));
  });

  it("every home game pays its team", () => {
    const f = make();
    const next = recordHomeGame(f, team);
    expect(next.finance[team.id].season.homeGames).toBe(1);
    expect(next.finance[team.id].season.revenue).toBe(homeGameRevenue(f, team));
    expect(next.finance[team.id].season.attendance).toBeGreaterThan(0);
  });

  it("playoff home games pay more", () => {
    const f = make();
    expect(homeGameRevenue(f, team, true)).toBeGreaterThan(homeGameRevenue(f, team));
  });

  it("simDay pays the home teams", () => {
    let f = make();
    for (let i = 0; i < 3; i++) f = simDay(f, teams, { includeUser: true }).franchise;
    const paid = Object.values(f.finance).filter((x) => x.season.homeGames > 0).length;
    expect(paid).toBeGreaterThan(5);
  });
});

describe("closing the books", () => {
  const ended = () => {
    const f = finishedSeason(make(), teams);
    return teams.reduce((x, t) => [...Array(41)].reduce((y) => recordHomeGame(y, t), x), f);
  };

  it("payroll, staff salaries, budgets and dead money are charged across a season", () => {
    const f = setPayroll(ended(), team.id, 100e6);
    const withStaff = hireStaff(f, { id: "s", role: "scout", name: "A B", rating: 80, salary: 3e6 });
    const dead = {
      ...withStaff,
      books: { ...withStaff.books, [team.id]: { ...withStaff.books[team.id], dead: [{ playerId: "x", name: "X", salary: 5e6, years: 1 }] } },
    };
    const base = closeSeasonBooks(f, teams).finance[team.id].lastSeason!;
    const paid = closeSeasonBooks(dead, teams).finance[team.id].lastSeason!;
    expect(paid.expenses - base.expenses).toBeCloseTo(8e6, -3);
    expect(base.expenses).toBeGreaterThanOrEqual(payroll(f, team.id) + capRules(f.cap).budgetDefault * 3);
  });

  it("the luxury tax is charged at the end of the season", () => {
    const f = setPayroll(ended(), team.id, capRules(make().cap).taxLine + 10e6);
    const under = setPayroll(ended(), team.id, capRules(make().cap).taxLine);
    const gap = closeSeasonBooks(f, teams).finance[team.id].lastSeason!.expenses - closeSeasonBooks(under, teams).finance[team.id].lastSeason!.expenses;
    expect(gap).toBeCloseTo(10e6 + taxBill(capRules(f.cap).taxLine + 10e6, capRules(f.cap)), -3);
  });

  it("a typical team makes $20M to $60M at the start", () => {
    const f = ended();
    const closed = closeSeasonBooks(f, teams);
    const profits = teams
      .filter((t) => payroll(f, t.id) < capRules(f.cap).taxLine)
      .map((t) => closed.finance[t.id].lastSeason!.profit)
      .sort((a, b) => a - b);
    const median = profits[Math.floor(profits.length / 2)];
    expect(median).toBeGreaterThan(20e6);
    expect(median).toBeLessThan(60e6);
  });

  it("the balance grows by the profit, and the season's counters reset", () => {
    const closed = closeSeasonBooks(ended(), teams).finance[team.id];
    expect(closed.balance).toBe(closed.lastSeason!.profit);
    expect(closed.season).toEqual({ revenue: 0, expenses: 0, attendance: 0, homeGames: 0 });
  });

  it("winning raises hype, and losing lowers it", () => {
    const f = ended();
    const closed = closeSeasonBooks(f, teams);
    expect(closed.finance[teams[29].id].hype).toBeGreaterThan(f.finance[teams[29].id].hype);
    expect(closed.finance[teams[0].id].hype).toBeLessThan(f.finance[teams[0].id].hype);
  });

  it("facilities rise with a big budget and fall with a small one", () => {
    const f = ended();
    const top = capRules(f.cap).budgetMax;
    const low = capRules(f.cap).budgetMin;
    const start = mine(f).facilities;
    expect(closeSeasonBooks(setBudget(f, "facilities", top), teams).finance[f.teamId].facilities).toBeGreaterThan(start);
    expect(closeSeasonBooks(setBudget(f, "facilities", low), teams).finance[f.teamId].facilities).toBeLessThan(start);
  });

  it("the cap follows league revenue, within 2 to 8 percent", () => {
    const cap = { year: 2026, salaryCap: 140e6 };
    expect(nextCap(cap, "s", 0.5).salaryCap / cap.salaryCap).toBeCloseTo(1.08, 3);
    expect(nextCap(cap, "s", -0.5).salaryCap / cap.salaryCap).toBeCloseTo(1.02, 3);
    expect(nextCap(cap, "s", 0.02).salaryCap / cap.salaryCap).toBeCloseTo(1.055, 3);
    expect(leagueRevenue(ended())).toBeGreaterThan(0);
  });
});

describe("budgets", () => {
  it("the default budget has no effect either way", () => {
    expect(budgetEffect(make(), "coaching")).toBe(1);
  });

  it("the scouting budget narrows ranges faster", () => {
    const f = make();
    const p = f.draft.prospects[0];
    const scouted = (x: Franchise) => ({ ...x, draft: { ...x.draft, scouting: { [p.id]: 20 } } });
    const width = (x: Franchise) => {
      const r = prospectRange(scouted(x), p).ovr;
      return r[1] - r[0];
    };
    expect(width(setBudget(f, "scouting", capRules(f.cap).budgetMax))).toBeLessThan(width(setBudget(f, "scouting", capRules(f.cap).budgetMin)));
  });

  it("the coaching budget helps development", () => {
    const f = { ...make(), date: "2026-11-30" };
    const gains = (x: Franchise) => {
      const out = weeklyDevelopment(x).franchise;
      return x.rosters[x.teamId].reduce(
        (n, id) => n + Object.keys(x.players[id].ratings).filter((k) => out.players[id].ratings[k as "speed"] > x.players[id].ratings[k as "speed"]).length,
        0,
      );
    };
    const yearOf = (x: Franchise) => [...Array(40)].reduce((sum, _, i) => sum + gains({ ...x, seed: `dev${i}` }), 0);
    expect(yearOf(setBudget(f, "coaching", capRules(f.cap).budgetMax))).toBeGreaterThan(yearOf(setBudget(f, "coaching", capRules(f.cap).budgetMin)));
  });

  it("better facilities improve a free agent's mood", () => {
    const f = make();
    const p = f.players[f.rosters[teams[4].id][0]];
    const at = (facilities: number) => mood({ ...f, finance: { ...f.finance, [team.id]: { ...mine(f), facilities } } }, p, team.id).score;
    expect(at(95)).toBeGreaterThan(at(5));
  });

  it("the budget and price limits hold", () => {
    const f = make();
    const r = capRules(f.cap);
    expect(mine(setBudget(f, "coaching", 1)).budgets.coaching).toBe(r.budgetMin);
    expect(mine(setBudget(f, "coaching", 1e9)).budgets.coaching).toBe(r.budgetMax);
    expect(mine(setTicketPrice(f, 0)).ticketPrice).toBeGreaterThanOrEqual(10);
    expect(mine(setTicketPrice(f, 1e6)).ticketPrice).toBeLessThanOrEqual(1000);
  });
});

describe("speed", () => {
  it("a season of finance adds under 3 seconds", () => {
    let f = make();
    const t0 = performance.now();
    for (let i = 0; i < 1230; i++) f = recordHomeGame(f, teams[i % 30]);
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});
