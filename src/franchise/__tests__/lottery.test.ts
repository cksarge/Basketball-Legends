import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Rng } from "@/engine/rng";
import type { Team } from "@/engine/types";
import { createFranchise } from "../create";
import { LOTTERY_ODDS, drawLottery, runLottery } from "../pro/lottery";
import { finishedSeason } from "./draftHelpers";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const f = runLottery(finishedSeason(createFranchise({ league: "pro", team: teams[0], teams, seed: "lot", now: 1 }), teams), teams);
const ownerAt = (i: number) => f.picks.find((p) => p.id === f.draft.order![i])!.ownerId;
const ids = Array.from({ length: 14 }, (_, i) => `t${i}`);

describe("the lottery", () => {
  it("over 20,000 lotteries the worst team gets the first pick 14% of the time", () => {
    let first = 0;
    let last = 0;
    for (let i = 0; i < 20000; i++) {
      const order = drawLottery(ids, new Rng(`l${i}`));
      if (order[0] === "t0") first++;
      if (order[0] === "t13") last++;
    }
    expect(LOTTERY_ODDS.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(first / 20000).toBeGreaterThan(0.125);
    expect(first / 20000).toBeLessThan(0.155);
    expect(last / 20000).toBeLessThan(0.01);
  });

  it("only the top four picks move, and no team falls more than four places", () => {
    for (let i = 0; i < 2000; i++) {
      const order = drawLottery(ids, new Rng(`m${i}`));
      expect(new Set(order).size).toBe(14);
      order.forEach((id, to) => expect(to - ids.indexOf(id)).toBeLessThanOrEqual(4));
      const rest = order.slice(4);
      expect(rest).toEqual(ids.filter((x) => rest.includes(x)));
    }
  });

  it("only teams that missed the playoffs enter, including play-in losers", () => {
    expect(f.draft.lottery).toHaveLength(14);
    const missed = new Set(teams.slice(0, 14).map((t) => t.id));
    for (const l of f.draft.lottery!) expect(missed.has(l.teamId)).toBe(true);
    expect(new Set(Array.from({ length: 14 }, (_, i) => ownerAt(i)))).toEqual(missed);
  });

  it("playoff teams follow, worst record first", () => {
    expect(Array.from({ length: 16 }, (_, i) => ownerAt(14 + i))).toEqual(teams.slice(14).map((t) => t.id));
  });

  it("the second round runs in reverse record order, unshuffled", () => {
    expect(f.draft.order).toHaveLength(60);
    expect(Array.from({ length: 30 }, (_, i) => ownerAt(30 + i))).toEqual(teams.map((t) => t.id));
  });

  it("a traded pick is made by its owner", () => {
    const start = finishedSeason(createFranchise({ league: "pro", team: teams[0], teams, seed: "lot", now: 1 }), teams);
    const moved = { ...start, picks: start.picks.map((p) => (p.id === `pick-2027-2-${teams[0].id}` ? { ...p, ownerId: teams[29].id } : p)) };
    const g = runLottery(moved, teams);
    expect(g.picks.find((p) => p.id === g.draft.order![30])!.ownerId).toBe(teams[29].id);
    expect(g.draft.order![30]).toBe(`pick-2027-2-${teams[0].id}`);
  });
});
