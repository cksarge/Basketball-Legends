import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { playerOvr } from "@/engine/player";
import type { Contract, Team } from "@/engine/types";
import { emptyLine } from "@/game/sim/stats";
import { leaderRow } from "../core/awards";
import { createFranchise } from "../create";
import { payroll, veteranRights } from "../pro/cap";
import { expiring, extendContract, pendingOptions, playerOptionChoice, rollContracts, setTeamOption } from "../pro/contracts";
import { marketValue } from "../pro/market";
import { rookieDeal } from "../pro/draft";
import { capRules } from "../pro/rules";
import type { Franchise } from "../types";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const make = () => createFranchise({ league: "pro", team: teams[0], teams, seed: "contracts", now: 1 });
const me = teams[0].id;
function deal(f: Franchise, id: string, contract: Contract): Franchise {
  return { ...f, players: { ...f.players, [id]: { ...f.players[id], contract } } };
}

describe("options", () => {
  const start = make();
  const id = start.rosters[me][0];

  it("a rookie deal asks for one option at a time", () => {
    let f = deal(start, id, { salary: 5e6, years: 4, teamOptionYears: 2, rookie: true });
    expect(pendingOptions(f, me).map((p) => p.id)).not.toContain(id);
    f = rollContracts(f);
    expect(f.players[id].contract?.years).toBe(3);
    expect(pendingOptions(f, me).map((p) => p.id)).toContain(id);
    f = setTeamOption(f, id, true);
    expect(pendingOptions(f, me).map((p) => p.id)).not.toContain(id);
    f = rollContracts(f);
    expect(f.players[id].contract).toMatchObject({ years: 2, teamOptionYears: 1 });
    expect(pendingOptions(f, me).map((p) => p.id)).toContain(id);
  });

  it("a declined team option ends the deal after the guaranteed years", () => {
    let f = deal(start, id, { salary: 5e6, years: 3, teamOptionYears: 2, rookie: true });
    f = setTeamOption(f, id, false);
    expect(f.players[id].contract?.years).toBe(1);
    f = rollContracts(f);
    expect(f.players[id].teamId).toBeNull();
    expect(f.freeAgents).toContain(id);
  });

  it("a player opts out when he's worth more, and in when he isn't", () => {
    const p = start.players[id];
    const value = marketValue(start, p);
    expect(playerOptionChoice(start, { ...p, contract: { salary: value * 2, years: 2, playerOption: true } })).toBe(true);
    expect(playerOptionChoice(start, { ...p, contract: { salary: value / 2, years: 2, playerOption: true } })).toBe(false);
  });
});

describe("the new contract year", () => {
  const start = make();
  const id = start.rosters[me][0];

  it("an expired player keeps his rights and stays listed until he signs elsewhere", () => {
    const f = rollContracts(
      deal({ ...start, players: { ...start.players, [id]: { ...start.players[id], file: { service: 5, teamSeasons: 4 } } } }, id, { salary: 9e6, years: 1 }),
    );
    const p = f.players[id];
    expect(p.contract).toBeUndefined();
    expect(p.file?.rightsTeamId).toBe(me);
    expect(p.file?.lastSalary).toBe(9e6);
    expect(veteranRights(p, me)).toBe("full");
    expect(f.rosters[me]).not.toContain(id);
  });

  it("service and tenure rise, and exceptions refill", () => {
    const signed = start.rosters[me][1];
    const before = start.players[signed].file!;
    const f = rollContracts({
      ...start,
      players: { ...start.players, [signed]: { ...start.players[signed], contract: { salary: 2e6, years: 3 } } },
      books: { ...start.books, [me]: { ...start.books[me], midLevelUsed: 5e6 } },
    });
    expect(f.players[signed].file).toMatchObject({ service: before.service + 1, teamSeasons: before.teamSeasons + 1 });
    expect(f.books[me].midLevelUsed).toBe(0);
  });

  it("dead money counts down and drops off", () => {
    const f = rollContracts({
      ...start,
      books: {
        ...start.books,
        [me]: {
          midLevelUsed: 0,
          dead: [
            { playerId: "a", name: "A", salary: 1e6, years: 2 },
            { playerId: "b", name: "B", salary: 1e6, years: 1 },
          ],
        },
      },
    });
    expect(f.books[me].dead).toEqual([{ playerId: "a", name: "A", salary: 1e6, years: 1 }]);
  });

  it("the cap rises for the new year", () => {
    expect(rollContracts(start).cap.salaryCap).toBeGreaterThan(start.cap.salaryCap);
  });

  it("an extension starts when the old deal ends and doesn't change this year's pay", () => {
    let f = deal(start, id, { salary: 9e6, years: 1 });
    expect(expiring(f, me).map((p) => p.id)).toContain(id);
    const pay = payroll(f, me);
    f = extendContract(f, id, 20e6, 3);
    expect(payroll(f, me)).toBe(pay);
    expect(expiring(f, me).map((p) => p.id)).not.toContain(id);
    f = rollContracts(f);
    expect(f.players[id].contract).toMatchObject({ salary: 20e6, years: 3 });
    expect(f.players[id].teamId).toBe(me);
  });

  it("an expired free agent with this season's stats still renders in Leaders", () => {
    const f = deal({ ...start, season: { ...start.season, stats: { [id]: { ...emptyLine(), gp: 50, gs: 50, pts: 800 } } } }, id, { salary: 9e6, years: 1 });
    expect(leaderRow(rollContracts(f), teams, id).team).toBe("");
    expect(playerOvr(rollContracts(f).players[id])).toBe(playerOvr(f.players[id]));
  });
});

describe("deals signed before July 1", () => {
  const start = make();
  const id = start.rosters[me][0];
  const fresh = deal({ ...start, players: { ...start.players, [id]: { ...start.players[id], file: { service: 0, teamSeasons: 0 } } } }, id, {
    ...rookieDeal(1, capRules(start.cap)),
    startsNext: true,
  });

  it("a rookie keeps his two guaranteed years through his first July 1", () => {
    let f = rollContracts(fresh);
    expect(f.players[id].contract).toMatchObject({ years: 4, teamOptionYears: 2 });
    expect(f.players[id].file).toMatchObject({ service: 0, teamSeasons: 0 });
    expect(pendingOptions(f, me).map((p) => p.id)).not.toContain(id);
    f = rollContracts(f); // after his first season
    expect(f.players[id].contract?.years).toBe(3);
    expect(f.players[id].file?.service).toBe(1);
    expect(pendingOptions(f, me).map((p) => p.id)).toContain(id);
  });
});

describe("options on an extension", () => {
  const start = make();
  const id = start.rosters[me][0];

  it("carries the options the player was promised", () => {
    const f = extendContract(deal(start, id, { salary: 9e6, years: 1 }), id, 20e6, 3, { playerOption: true });
    expect(rollContracts(f).players[id].contract).toMatchObject({ salary: 20e6, years: 3, playerOption: true });
    const g = extendContract(deal(start, id, { salary: 9e6, years: 1 }), id, 20e6, 3, { teamOption: true });
    expect(rollContracts(g).players[id].contract).toMatchObject({ teamOptionYears: 1 });
  });
});

describe("replays", () => {
  it("the contract year turns the same way whatever order the players load in", () => {
    const f = make();
    const ids = Object.keys(f.players);
    const expiring = ids.slice(0, 60).reduce((x, id) => deal(x, id, { salary: 2e6, years: 1 }), f);
    const reversed = { ...expiring, players: Object.fromEntries(Object.entries(expiring.players).reverse()) };
    expect(rollContracts(reversed).freeAgents).toEqual(rollContracts(expiring).freeAgents);
  });
});
