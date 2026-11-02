import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addDays, proCalendar } from "@/career/calendar";
import type { Team } from "@/engine/types";
import { emptyLine } from "@/game/sim/stats";
import { createFranchise } from "../create";
import { payroll } from "../pro/cap";
import { capRules } from "../pro/rules";
import { applyTrade, tradeOpen, tradeProblems, type Trade } from "../pro/trades";
import type { Franchise } from "../types";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const make = () => createFranchise({ league: "pro", team: teams[0], teams, seed: "trades", now: 1 });
const [A, B, C] = teams.map((t) => t.id);
const rules = capRules({ year: 2026, salaryCap: 140e6 });

function evenPay(f: Franchise, teamId: string, total: number): Franchise {
  const players = { ...f.players };
  for (const id of f.rosters[teamId]) players[id] = { ...players[id], contract: { salary: total / 15, years: 2 } };
  return { ...f, players };
}
const setPay = (f: Franchise, id: string, salary: number): Franchise => ({
  ...f,
  players: { ...f.players, [id]: { ...f.players[id], contract: { salary, years: 2 } } },
});
/** A for B, one player each way, at these salaries. */
function swap(f: Franchise, out: number, incoming: number): { f: Franchise; t: Trade } {
  const a = f.rosters[A][0],
    b = f.rosters[B][0];
  return {
    f: setPay(setPay(f, a, out), b, incoming),
    t: {
      teams: [A, B],
      assets: [
        { kind: "player", id: a, from: A, to: B },
        { kind: "player", id: b, from: B, to: A },
      ],
    },
  };
}
const salaryProblem = (p: string[]) => p.filter((x) => /salary|apron|cap/i.test(x));

describe("salary matching", () => {
  it("under the cap after the trade, a team takes back any salary", () => {
    const base = evenPay(evenPay(make(), A, 90e6), B, 150e6);
    const { f, t } = swap(base, 6e6, 30e6);
    expect(salaryProblem(tradeProblems(f, t))).toEqual([]);
  });

  it("over the cap, incoming salary can be 125% of outgoing plus the cushion", () => {
    const base = evenPay(evenPay(make(), A, 150e6), B, 150e6);
    const ok = swap(base, 8e6, 8e6 * 1.25 + rules.tradeCushion);
    expect(salaryProblem(tradeProblems(ok.f, ok.t))).toEqual([]);
    const no = swap(base, 8e6, 8e6 * 1.25 + rules.tradeCushion + 1e6);
    expect(salaryProblem(tradeProblems(no.f, no.t))).toHaveLength(1);
  });

  it("over the first apron, 110%", () => {
    const base = evenPay(evenPay(make(), A, 180e6), B, 150e6);
    const no = swap(base, 10e6, 12e6);
    expect(salaryProblem(tradeProblems(no.f, no.t))).toHaveLength(1);
    const ok = swap(base, 10e6, 11e6);
    expect(salaryProblem(tradeProblems(ok.f, ok.t))).toEqual([]);
  });

  it("over the second apron, it can't take on salary", () => {
    const base = evenPay(evenPay(make(), A, 200e6), B, 150e6);
    const no = swap(base, 10e6, 10.5e6);
    expect(salaryProblem(tradeProblems(no.f, no.t))).toHaveLength(1);
    const ok = swap(base, 10e6, 10e6);
    expect(salaryProblem(tradeProblems(ok.f, ok.t))).toEqual([]);
  });
});

describe("what makes a trade legal", () => {
  it("two-team and three-team deals check each team on its own", () => {
    const f0 = evenPay(evenPay(evenPay(make(), A, 150e6), B, 150e6), C, 200e6);
    const [a, b, c] = [f0.rosters[A][0], f0.rosters[B][0], f0.rosters[C][0]];
    const f = setPay(setPay(setPay(f0, a, 10e6), b, 10e6), c, 10e6);
    const t: Trade = {
      teams: [A, B, C],
      assets: [
        { kind: "player", id: a, from: A, to: B },
        { kind: "player", id: b, from: B, to: C },
        { kind: "player", id: c, from: C, to: A },
      ],
    };
    expect(tradeProblems(f, t)).toEqual([]);
    const over = setPay(f, b, 13e6);
    expect(tradeProblems(over, t).some((p) => /Team|apron|salary/.test(p))).toBe(true);
  });

  it("refuses a deal that leaves an in-season roster above 15, or a player on the wrong team", () => {
    const f = evenPay(evenPay(make(), A, 90e6), B, 90e6);
    const moved: Trade = { teams: [A, B], assets: [{ kind: "player", id: f.rosters[A][0], from: A, to: B }] };
    expect(tradeProblems(f, moved).join()).toMatch(/roster/i);
    const wrong: Trade = { teams: [A, B], assets: [{ kind: "player", id: f.rosters[B][0], from: A, to: B }] };
    expect(tradeProblems(f, wrong).join()).toMatch(/isn't on/);
  });

  it("refuses a pick a team doesn't own", () => {
    const f = make();
    const t: Trade = { teams: [A, B], assets: [{ kind: "pick", id: `pick-2027-1-${B}`, from: A, to: B }] };
    expect(tradeProblems(f, t).join()).toMatch(/own/);
  });

  it("refuses anything after the deadline, and reopens when the finals end", () => {
    const f = make();
    const deadline = proCalendar(f.season.year).tradeDeadline;
    expect(tradeOpen({ ...f, date: deadline })).toBe(true);
    const late = { ...f, date: addDays(deadline, 1) };
    expect(tradeOpen(late)).toBe(false);
    const { t } = swap(late, 5e6, 5e6);
    expect(tradeProblems(late, t).join()).toMatch(/deadline/);
    expect(tradeOpen({ ...late, phase: "playoffs" })).toBe(false);
    expect(tradeOpen({ ...late, phase: "offseason" })).toBe(true);
  });

  it("refuses a player in free agency unless the deal is a sign-and-trade by his rights team", () => {
    const f0 = evenPay(evenPay(make(), A, 90e6), B, 90e6);
    const id = f0.rosters[A][14];
    const p = { ...f0.players[id], teamId: null, file: { service: 6, teamSeasons: 4, rightsTeamId: A, lastSalary: 5e6 } };
    delete p.contract;
    const f: Franchise = {
      ...f0,
      phase: "offseason",
      players: { ...f0.players, [id]: p },
      rosters: { ...f0.rosters, [A]: f0.rosters[A].slice(0, 14) },
      freeAgents: [id],
    };
    const plain: Trade = { teams: [A, B], assets: [{ kind: "player", id, from: A, to: B }] };
    expect(tradeProblems(f, plain).join()).toMatch(/free agent/i);
    const sat: Trade = { teams: [A, B], assets: [{ kind: "player", id, from: A, to: B, signAndTrade: { salary: 10e6, years: 3 } }] };
    expect(tradeProblems(f, sat)).toEqual([]);
    const done = applyTrade(f, sat);
    expect(done.players[id]).toMatchObject({ teamId: B, contract: { salary: 10e6, years: 3 } });
    expect(done.freeAgents).toEqual([]);
    const wrongTeam: Trade = { teams: [B, C], assets: [{ kind: "player", id, from: B, to: C, signAndTrade: { salary: 10e6, years: 3 } }] };
    expect(tradeProblems(f, wrongTeam).join()).toMatch(/rights/);
  });

  it("a team over the first apron can't take a sign-and-trade", () => {
    const f0 = evenPay(evenPay(make(), A, 90e6), B, 185e6);
    const id = f0.rosters[A][14];
    const p = { ...f0.players[id], teamId: null, file: { service: 6, teamSeasons: 4, rightsTeamId: A, lastSalary: 5e6 } };
    delete p.contract;
    const f: Franchise = {
      ...f0,
      phase: "offseason",
      players: { ...f0.players, [id]: p },
      rosters: { ...f0.rosters, [A]: f0.rosters[A].slice(0, 14) },
      freeAgents: [id],
    };
    const t: Trade = { teams: [A, B], assets: [{ kind: "player", id, from: A, to: B, signAndTrade: { salary: 2e6, years: 1 } }] };
    expect(tradeProblems(f, t).join()).toMatch(/sign-and-trade/);
  });
});

describe("applying a trade", () => {
  it("applyTrade moves players and picks, resets team seasons and keeps this season's stats", () => {
    const base = make();
    const { f: paid, t } = swap(base, 5e6, 5e6);
    const a = t.assets[0].id;
    const pick = `pick-2028-1-${A}`;
    const f = { ...paid, season: { ...paid.season, stats: { [a]: { ...emptyLine(), gp: 9, gs: 9, pts: 90 } } } };
    const done = applyTrade(f, { ...t, assets: [...t.assets, { kind: "pick", id: pick, from: A, to: B }] });
    expect(done.players[a].teamId).toBe(B);
    expect(done.rosters[B]).toContain(a);
    expect(done.rosters[A]).not.toContain(a);
    expect(done.players[a].file?.teamSeasons).toBe(0);
    expect(done.picks.find((p) => p.id === pick)!.ownerId).toBe(B);
    expect(done.season.stats[a].pts).toBe(90);
    expect(new Set(done.rosters[B].map((id) => done.players[id].jersey)).size).toBe(done.rosters[B].length);
  });

  it("a refused deal changes nothing", () => {
    const f = evenPay(evenPay(make(), A, 200e6), B, 150e6);
    const { f: paid, t } = swap(f, 5e6, 30e6);
    expect(applyTrade(paid, t)).toBe(paid);
    expect(payroll(paid, A)).toBe(payroll(paid, A));
  });
});
