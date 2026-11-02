import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { playerOvr } from "@/engine/player";
import type { Team } from "@/engine/types";
import { createFranchise } from "../create";
import { boardScore, aiChoice, currentPick, makePick, rookieDeal, simDraftToEnd, simToUserPick, trimRoster } from "../pro/draft";
import { runLottery } from "../pro/lottery";
import { capRules } from "../pro/rules";
import type { Franchise } from "../types";
import { finishedSeason } from "./draftHelpers";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const ready = (team = teams[15]) => runLottery(finishedSeason(createFranchise({ league: "pro", team, teams, seed: "dr", now: 1 }), teams), teams);
const rules = capRules({ year: 2026, salaryCap: 140e6 });

describe("rookie deals", () => {
  it("each first-rounder signs two guaranteed years plus two team options on the scale", () => {
    expect(rookieDeal(1, rules)).toMatchObject({ salary: 12_500_000, years: 4, teamOptionYears: 2, rookie: true });
    expect(rookieDeal(30, rules).salary).toBeLessThan(rookieDeal(2, rules).salary);
    expect(rookieDeal(30, rules).salary).toBeGreaterThan(rules.minSalary);
  });

  it("each second-rounder signs two guaranteed years plus one team option", () => {
    expect(rookieDeal(31, rules)).toMatchObject({ salary: 1_300_000, years: 3, teamOptionYears: 1, rookie: true });
    expect(rookieDeal(60, rules).salary).toBe(rules.minSalary);
  });

  it("scale pay rises with the cap", () => {
    expect(rookieDeal(1, capRules({ year: 2030, salaryCap: 168e6 })).salary).toBe(15_000_000);
  });
});

describe("the draft", () => {
  it("an AI team passes a better player only for a clear need", () => {
    let f = ready();
    for (let i = 0; i < 10; i++) {
      const team = currentPick(f)!.ownerId;
      const left = f.draft.prospects.filter((p) => !f.draft.results.some((r) => r.playerId === p.id));
      const best = Math.max(...left.map((p) => boardScore(f, p)));
      const pick = aiChoice(f, team);
      expect(
        boardScore(
          f,
          f.draft.prospects.find((p) => p.id === pick)!,
        ),
      ).toBeGreaterThanOrEqual(best - 2);
      f = simToUserPick({ ...f, teamId: "none" }, 1);
      f = { ...f, teamId: teams[15].id };
    }
  });

  it("a drafted player's file records the year, pick and team", () => {
    const f = simDraftToEnd(ready());
    const r = f.draft.results[0];
    const p = f.players[r.playerId];
    expect(p.file?.draft).toEqual({ year: 2027, pick: 1, teamId: r.teamId });
    expect(p.teamId).toBe(r.teamId);
    expect(f.rosters[r.teamId]).toContain(p.id);
    expect(p.file?.range).toBeDefined();
    expect(p.contract?.rookie).toBe(true);
    expect(new Set(f.rosters[r.teamId].map((id) => f.players[id].jersey)).size).toBe(f.rosters[r.teamId].length);
  });

  it("the user can't pick out of turn or take a player twice", () => {
    let f = ready();
    const first = f.draft.prospects[0].id;
    expect(makePick(f, first)).toBe(f);
    f = simToUserPick(f);
    expect(currentPick(f)!.ownerId).toBe(f.teamId);
    const taken = f.draft.results[0].playerId;
    expect(makePick(f, taken)).toBe(f);
    const left = f.draft.prospects.find((p) => !f.draft.results.some((r) => r.playerId === p.id))!;
    const next = makePick(f, left.id);
    expect(next.draft.results).toHaveLength(f.draft.results.length + 1);
    expect(next.draft.results.at(-1)!.teamId).toBe(f.teamId);
  });

  it("simToUserPick stops at the user's next pick and simDraftToEnd finishes it", () => {
    const f = simToUserPick(ready());
    expect(f.draft.results.length).toBeGreaterThan(0);
    expect(f.draft.results.length).toBeLessThan(60);
    const done = simDraftToEnd(f);
    expect(done.draft.results).toHaveLength(60);
    expect(currentPick(done)).toBeNull();
    expect(new Set(done.draft.results.map((r) => r.playerId)).size).toBe(60);
  });

  it("after the draft, undrafted prospects are free agents and keep their ranges until they play", () => {
    const f = simDraftToEnd(ready());
    expect(f.freeAgents).toHaveLength(10);
    for (const id of f.freeAgents) {
      expect(f.players[id].teamId).toBeNull();
      expect(f.players[id].contract).toBeUndefined();
      expect(f.players[id].file?.range).toBeDefined();
    }
  });

  it("a team over the limit lets its weakest players go", () => {
    const f: Franchise = simDraftToEnd(ready());
    const id = teams[3].id;
    const trimmed = trimRoster(f, id, 12);
    expect(trimmed.rosters[id]).toHaveLength(12);
    const left = f.rosters[id].filter((x) => !trimmed.rosters[id].includes(x));
    expect(Math.min(...trimmed.rosters[id].map((x) => playerOvr(f.players[x])))).toBeGreaterThanOrEqual(Math.min(...left.map((x) => playerOvr(f.players[x]))));
    for (const x of left) expect(trimmed.freeAgents).toContain(x);
  });
});
