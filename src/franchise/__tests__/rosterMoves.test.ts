import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addDays } from "@/career/calendar";
import type { Team } from "@/engine/types";
import { emptyLine } from "@/game/sim/stats";
import { simDay } from "../core/season";
import { createFranchise } from "../create";
import { franchisePending } from "../match";
import { payroll } from "../pro/cap";
import { marketValue } from "../pro/market";
import {
  activeRoster,
  buyOut,
  buyoutAsk,
  callUp,
  claimWaiver,
  guaranteed,
  processWaivers,
  releasePlayer,
  rosterProblem,
  signDev,
  signTwoWay,
} from "../pro/rosterMoves";
import { capRules } from "../pro/rules";
import type { Franchise } from "../types";
import { setPayroll } from "./capHelpers";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const make = () => createFranchise({ league: "pro", team: teams[0], teams, seed: "moves", now: 1 });
const me = teams[0].id;
const set = (f: Franchise, id: string, salary: number, years: number, teamOptionYears = 0): Franchise => ({
  ...f,
  players: { ...f.players, [id]: { ...f.players[id], contract: { salary, years, teamOptionYears } } },
});
/** A free agent taken from the end of another team's roster. */
function withAgent(f: Franchise): { f: Franchise; id: string } {
  const other = teams[2].id;
  const id = f.rosters[other].at(-1)!;
  const p = { ...f.players[id], teamId: null };
  delete p.contract;
  return { id, f: { ...f, players: { ...f.players, [id]: p }, rosters: { ...f.rosters, [other]: f.rosters[other].slice(0, -1) }, freeAgents: [id] } };
}
const later = (f: Franchise, days: number) => ({ ...f, date: addDays(f.date, days) });

describe("release", () => {
  it("guaranteed money skips team option years", () => {
    expect(guaranteed({ salary: 2e6, years: 3, teamOptionYears: 1 })).toBe(4e6);
  });

  it("release leaves the guaranteed money as dead cap, without team option years", () => {
    const start = make();
    const id = start.rosters[me][0];
    const f = releasePlayer(set(start, id, 10e6, 3, 1), id);
    expect(f.rosters[me]).not.toContain(id);
    expect(f.books[me].dead[0]).toMatchObject({ playerId: id, salary: 10e6, years: 2 });
    expect(f.waivers).toEqual([{ playerId: id, fromTeamId: me, until: addDays(start.date, 2) }]);
    expect(payroll(f, me)).toBe(payroll(set(start, id, 10e6, 3, 1), me));
  });

  it("an unclaimed player reaches free agency after two days", () => {
    const start = make();
    const id = start.rosters[me][0];
    const f = releasePlayer(set(start, id, 40e6, 3), id);
    expect(processWaivers(later(f, 1)).franchise.waivers).toHaveLength(1);
    const done = processWaivers(later(f, 2)).franchise;
    expect(done.waivers).toEqual([]);
    expect(done.freeAgents).toContain(id);
    expect(done.players[id].contract).toBeUndefined();
    expect(done.books[me].dead).toHaveLength(1);
  });

  it("a claiming team takes the whole contract and the dead money goes away", () => {
    const start = make();
    const id = start.rosters[me].slice().sort((a, b) => start.players[b].potential - start.players[a].potential)[0];
    let f = releasePlayer(set(start, id, 1.3e6, 2), id);
    const claimer = teams[5].id;
    f = { ...f, rosters: { ...f.rosters, [claimer]: f.rosters[claimer].slice(0, 13) } };
    f = setPayroll(f, claimer, 100e6);
    const done = processWaivers(later(f, 2)).franchise;
    const team = done.players[id].teamId;
    expect(team).not.toBeNull();
    expect(done.rosters[team!]).toContain(id);
    expect(done.players[id].contract?.salary).toBe(1.3e6);
    expect(done.books[me].dead).toEqual([]);
  });

  it("a team that can't fit the contract can't claim", () => {
    const start = make();
    const id = start.rosters[me][0];
    const f = setPayroll(releasePlayer(set(start, id, 30e6, 2), id), teams[5].id, 180e6);
    expect(claimWaiver(f, teams[5].id, id)).toBe(f);
  });

  it("the user can claim a player on waivers", () => {
    const start = make();
    const other = teams[1].id;
    const id = start.rosters[other][0];
    let f = releasePlayer(set(start, id, 1.2e6, 1), id);
    f = { ...f, rosters: { ...f.rosters, [me]: f.rosters[me].slice(0, 14) } };
    const done = claimWaiver(f, me, id);
    expect(done.players[id].teamId).toBe(me);
    expect(done.waivers).toEqual([]);
  });
});

describe("waivers in the season", () => {
  it("simDay clears waivers on their date", () => {
    const start = make();
    const id = start.rosters[me][14];
    let f = releasePlayer(set(start, id, 40e6, 2), id);
    f = { ...f, rosters: { ...f.rosters, [me]: [...f.rosters[me]] } };
    for (let i = 0; i < 3; i++) f = simDay(f, teams, { includeUser: true }).franchise;
    expect(f.waivers).toEqual([]);
    expect(f.freeAgents).toContain(id);
  });
});

describe("buyouts", () => {
  it("a buyout below the player's ask is refused, and an accepted one becomes dead cap", () => {
    const start = make();
    const id = start.rosters[me][3];
    const f = set(start, id, 20e6, 2);
    const ask = buyoutAsk(f, id);
    expect(ask).toBeLessThan(40e6);
    expect(ask).toBeGreaterThan(0);
    expect(buyOut(f, id, ask - 1e6)).toBe(f);
    const done = buyOut(f, id, ask);
    expect(done.players[id].teamId).toBeNull();
    expect(done.freeAgents).toContain(id);
    expect(done.books[me].dead[0]).toMatchObject({ salary: ask / 2, years: 2 });
    expect(payroll(done, me)).toBeLessThan(payroll(f, me));
  });

  it("a player worth his deal gives back little", () => {
    const start = make();
    const id = start.rosters[me][3];
    const value = marketValue(start, start.players[id]);
    expect(buyoutAsk(set(start, id, value, 2), id)).toBeGreaterThanOrEqual(value * 2 * 0.59);
  });
});

describe("two-way and developmental deals", () => {
  it("three two-way slots outside the cap and the 15", () => {
    const made = withAgent(make());
    const id = made.id;
    let f = made.f;
    const pay = payroll(f, me);
    f = signTwoWay(f, me, id);
    expect(f.players[id].contract).toMatchObject({ twoWay: true, salary: capRules(f.cap).twoWaySalary, years: 1 });
    expect(f.rosters[me]).toHaveLength(16);
    expect(payroll(f, me)).toBe(pay);
    expect(f.freeAgents).toEqual([]);
    expect(rosterProblem(f)).toBeNull();
    const more = [1, 2, 3].map((i) => f.rosters[teams[6].id][i]);
    f = {
      ...f,
      freeAgents: more,
      players: { ...f.players, ...Object.fromEntries(more.map((x) => [x, { ...f.players[x], teamId: null, contract: undefined }])) },
    };
    f = signTwoWay(signTwoWay(f, me, more[0]), me, more[1]);
    expect(signTwoWay(f, me, more[2])).toBe(f);
  });

  it("a two-way player sits out the playoffs and stops at 50 games", () => {
    const made = withAgent(make());
    const id = made.id;
    let f = made.f;
    f = signTwoWay(f, me, id);
    const g = f.season.games.find((x) => x.homeId === me || x.awayId === me)!;
    expect(activeRoster(f, me, g).map((p) => p.id)).toContain(id);
    expect(activeRoster(f, me, { ...g, kind: "playoff" }).map((p) => p.id)).not.toContain(id);
    const done = { ...f, season: { ...f.season, stats: { [id]: { ...emptyLine(), gp: 50, gs: 0 } } } };
    expect(activeRoster(done, me, g).map((p) => p.id)).not.toContain(id);
  });

  it("developmental players stay outside the roster until called up", () => {
    const made = withAgent(make());
    const id = made.id;
    let f = made.f;
    f = signDev(f, me, id);
    expect(f.devRosters[me]).toEqual([id]);
    expect(f.rosters[me]).not.toContain(id);
    expect(f.players[id].contract).toMatchObject({ dev: true });
    expect(f.players[id].teamId).toBe(me);
    f = { ...f, rosters: { ...f.rosters, [me]: f.rosters[me].slice(0, 14) } };
    f = callUp(f, id);
    expect(f.devRosters[me]).toEqual([]);
    expect(f.rosters[me]).toContain(id);
    expect(f.players[id].contract).toMatchObject({ salary: capRules(f.cap).minSalary, years: 1 });
    expect(f.players[id].contract?.dev).toBeUndefined();
  });

  it("a full roster can't call anyone up", () => {
    const made = withAgent(make());
    const f = signDev(made.f, me, made.id);
    expect(callUp(f, made.id)).toBe(f);
  });

  it("a game played with 18 under contract builds a valid match", () => {
    let f = make();
    const more = [1, 2, 3].map((i) => f.rosters[teams[6].id][i]);
    f = {
      ...f,
      freeAgents: more,
      players: { ...f.players, ...Object.fromEntries(more.map((x) => [x, { ...f.players[x], teamId: null, contract: undefined }])) },
    };
    for (const id of more) f = signTwoWay(f, me, id);
    const g = f.season.games.find((x) => x.homeId === me || x.awayId === me)!;
    const pending = franchisePending(f, g, teams, "keyboard");
    expect(pending.home.roster.length).toBeGreaterThanOrEqual(5);
  });
});

describe("roster limits", () => {
  it("simDay won't run while the user's roster is outside 13-15 in season", () => {
    const f = make();
    const short = { ...f, rosters: { ...f.rosters, [me]: f.rosters[me].slice(0, 12) } };
    expect(rosterProblem(short)).toMatch(/13/);
    const day = simDay(short, teams, { includeUser: true });
    expect(day.blocked).toBe(true);
    expect(day.franchise).toBe(short);
    expect(rosterProblem(f)).toBeNull();
  });

  it("the limit waits until the season", () => {
    const f = make();
    expect(rosterProblem({ ...f, phase: "offseason", rosters: { ...f.rosters, [me]: f.rosters[me].slice(0, 12) } })).toBeNull();
  });
});
