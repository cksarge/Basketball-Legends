import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Player, Team } from "@/engine/types";
import { createFranchise } from "../create";
import { canSign, leagueAverageSalary, payroll, rightsLimit, signingRoom, taxBill, spendException, veteranRights } from "../pro/cap";
import { capRules } from "../pro/rules";
import type { Franchise } from "../types";
import { setPayroll } from "./capHelpers";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const make = () => createFranchise({ league: "pro", team: teams[0], teams, seed: "cap", now: 1 });
const rules = capRules({ year: 2026, salaryCap: 140e6 });
const id = teams[0].id;
const other = teams[1].id;
/** A free agent from another team, with this many years of service and tenure. */
function agent(f: Franchise, service: number, teamSeasons = 0, rightsTeamId?: string, lastSalary?: number): Player {
  const p = f.players[f.rosters[other][0]];
  return { ...p, teamId: null, contract: undefined, file: { service, teamSeasons, rightsTeamId, lastSalary } };
}

describe("payroll and tax", () => {
  it("counts dead money and skips two-way and developmental deals", () => {
    let f = setPayroll(make(), id, 150e6);
    const [a, b, c] = f.rosters[id];
    f = { ...f, players: { ...f.players, [a]: { ...f.players[a], contract: { ...f.players[a].contract!, salary: 1e6, twoWay: true } } } };
    f = { ...f, players: { ...f.players, [b]: { ...f.players[b], contract: { ...f.players[b].contract!, salary: 1e6, dev: true } } } };
    const without = payroll(f, id);
    expect(without).toBeCloseTo((150e6 * 13) / 15 + 0);
    f = { ...f, books: { ...f.books, [id]: { dead: [{ playerId: c, name: "x", salary: 3e6, years: 2 }], midLevelUsed: 0 } } };
    expect(payroll(f, id)).toBeCloseTo(without + 3e6);
  });

  it("taxes $5M over the line at the first step and $25M over at higher steps", () => {
    expect(taxBill(rules.taxLine, rules)).toBe(0);
    expect(taxBill(rules.taxLine + 5e6, rules)).toBeCloseTo(7.5e6);
    expect(taxBill(rules.taxLine + 25e6, rules)).toBeCloseTo(5e6 * (1.5 + 1.75 + 2.5 + 3.25 + 3.75));
  });
});

describe("veteran rights", () => {
  it("full rights after 3 seasons exceed the cap up to the max", () => {
    const f = setPayroll(make(), id, 200e6);
    const p = agent(f, 8, 3, id, 10e6);
    expect(veteranRights(p, id)).toBe("full");
    expect(canSign(f, id, p, 42e6)).toEqual({ ok: true, via: "rights" });
    expect(canSign(f, id, p, 43e6).ok).toBe(false);
  });

  it("1-2 seasons allow the greater of 175% of salary or 105% of the league average", () => {
    const f = make();
    expect(veteranRights(agent(f, 8, 2, id, 10e6), id)).toBe("early");
    expect(rightsLimit(f, agent(f, 8, 2, id, 20e6), id)).toBe(35e6);
    expect(rightsLimit(f, agent(f, 8, 1, id, 2e6), id)).toBeCloseTo(leagueAverageSalary(f) * 1.05, -5);
  });

  it("another team has no rights", () => {
    const f = make();
    expect(veteranRights(agent(f, 8, 5, id), other)).toBe("none");
    expect(rightsLimit(f, agent(f, 8, 5, id), other)).toBe(0);
  });

  it("the season he's on the team counts toward rights, before the contract year turns", () => {
    const f = make();
    const p = f.players[f.rosters[id][0]];
    expect(veteranRights({ ...p, file: { service: 5, teamSeasons: 0 } }, id)).toBe("early");
    expect(veteranRights({ ...p, file: { service: 5, teamSeasons: 2 } }, id)).toBe("full");
  });

  it("a signed player's rights belong to his team", () => {
    const f = make();
    const p = f.players[f.rosters[id][0]];
    expect(veteranRights({ ...p, file: { service: 5, teamSeasons: 4 } }, id)).toBe("full");
  });
});

describe("signing room", () => {
  const free = (f: Franchise) => agent(f, 5);

  it("no rights: a capped team can only offer the minimum", () => {
    const f = setPayroll(make(), id, 195e6);
    expect(signingRoom(f, id, free(f))).toEqual({ limit: rules.minSalary, via: "minimum" });
    expect(canSign(f, id, free(f), rules.minSalary)).toEqual({ ok: true, via: "minimum" });
    expect(canSign(f, id, free(f), 2e6).ok).toBe(false);
  });

  it("cap room pays first", () => {
    const f = setPayroll(make(), id, 100e6);
    expect(canSign(f, id, free(f), 30e6)).toEqual({ ok: true, via: "cap" });
  });

  it("the mid-level splits across signings until it's used up", () => {
    let f = setPayroll(make(), id, 160e6);
    expect(canSign(f, id, free(f), 8e6)).toEqual({ ok: true, via: "midLevel" });
    f = spendException(f, id, "midLevel", 8e6);
    expect(canSign(f, id, free(f), 4e6)).toEqual({ ok: true, via: "midLevel" });
    f = spendException(f, id, "midLevel", 4e6);
    expect(canSign(f, id, free(f), 4e6)).toEqual({ ok: true, via: "biannual" });
  });

  it("the full mid-level isn't available over the first apron, and the taxpayer one isn't over the second", () => {
    const over = setPayroll(make(), id, 180e6);
    expect(signingRoom(over, id, free(over))).toEqual({ limit: rules.taxMidLevel, via: "taxMidLevel" });
    const top = setPayroll(make(), id, 190e6);
    expect(signingRoom(top, id, free(top)).via).toBe("minimum");
  });

  it("a team under the cap by less than the deal uses its room mid-level instead", () => {
    const f = setPayroll(make(), id, 139e6);
    expect(canSign(f, id, free(f), 6e6)).toEqual({ ok: true, via: "roomMidLevel" });
  });

  it("the biannual can't be used two years in a row", () => {
    let f = setPayroll(make(), id, 160e6);
    f = spendException(f, id, "midLevel", rules.midLevel);
    expect(canSign(f, id, free(f), 4e6)).toEqual({ ok: true, via: "biannual" });
    f = spendException(f, id, "biannual", 4e6);
    expect(canSign(f, id, free(f), 4e6).ok).toBe(false);
    const nextYear = { ...f, cap: { ...f.cap, year: f.cap.year + 1 } };
    expect(canSign(nextYear, id, free(nextYear), 4e6).ok).toBe(false);
    const later = { ...f, cap: { ...f.cap, year: f.cap.year + 2 } };
    expect(canSign(later, id, free(later), 4e6).ok).toBe(true);
  });

  it("the max depends on years of service", () => {
    const f = setPayroll(make(), id, 20e6);
    expect(canSign(f, id, agent(f, 3), 36e6).ok).toBe(false);
    expect(canSign(f, id, agent(f, 12), 49e6).ok).toBe(true);
  });

  it("canSign gives a reason a person can read", () => {
    const f = setPayroll(make(), id, 195e6);
    const no = canSign(f, id, free(f), 10e6);
    expect(no).toEqual({ ok: false, reason: expect.stringMatching(/\$1\.2M/) });
    const low = canSign(f, id, free(f), 1e5);
    expect(low).toEqual({ ok: false, reason: expect.stringMatching(/minimum/) });
    const top = canSign(f, id, agent(f, 1), 60e6);
    expect(top).toEqual({ ok: false, reason: expect.stringMatching(/maximum/) });
  });
});
