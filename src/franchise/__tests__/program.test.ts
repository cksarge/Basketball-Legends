import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Conference, Team } from "@/engine/types";
import { STAFF_PAY, adGoals, postseasonReached, staffBudget, tryHireStaff } from "../club/program";
import { applyReview, ownerReview } from "../club/owner";
import { staffPool } from "../coaching/staff";
import { simDay } from "../core/season";
import { createFranchise } from "../create";
import { proTeams } from "./proSnapshot";
import type { Franchise } from "../types";

const data = JSON.parse(readFileSync("src/data/generated/college.json", "utf8")) as { teams: Team[]; conferences: Conference[] };
const teams = data.teams;
const d1 = teams.filter((t) => t.tier === "D1");
const byPrestige = [...d1].sort((a, b) => b.prestige - a.prestige);
const make = (team: Team, seed = "program") => createFranchise({ league: "college", team, teams, conferences: data.conferences, seed, now: 1 });
const goal = (f: Franchise, key: string) => f.job.goals.find((g) => g.key === key)?.target;
function simSeason(f: Franchise) {
  for (let i = 0; i < 260 && f.phase !== "offseason"; i++) f = simDay(f, teams, { includeUser: true }).franchise;
  return f;
}

describe("the athletic director", () => {
  const top = make(byPrestige[0]);
  const small = make(byPrestige.at(-1)!);

  it("a top program is expected to reach the second weekend and sign a top-15 class", () => {
    expect(top.job.goals.map((g) => g.key).sort()).toEqual(["postseason", "recruiting", "winning"]);
    expect(goal(top, "postseason")).toBe(2);
    expect(goal(top, "recruiting")).toBeLessThanOrEqual(15);
    expect(goal(top, "winning")).toBeGreaterThan(18);
  });

  it("a small program is expected to make its conference tournament", () => {
    expect(goal(small, "postseason")).toBe(0);
    expect(goal(small, "recruiting")).toBeGreaterThan(200);
    expect(goal(small, "winning")).toBeLessThan(goal(top, "winning")!);
    expect(adGoals(small, d1)).toEqual(small.job.goals);
  });

  const season = simSeason(make(byPrestige[30], "season"));

  it("reaching further than the goal grades higher", () => {
    const reached = postseasonReached(season, season.teamId);
    expect(reached).toBeGreaterThanOrEqual(-1);
    const target = (n: number): Franchise => ({
      ...season,
      job: { ...season.job, goals: season.job.goals.map((g) => (g.key === "postseason" ? { ...g, target: n } : g)) },
    });
    const order = ["F", "D", "C", "B", "A"];
    const easy = ownerReview(target(reached - 1)).grades.postseason!;
    const hard = ownerReview(target(reached + 2)).grades.postseason!;
    expect(order.indexOf(easy)).toBeGreaterThan(order.indexOf(hard));
    const champion = season.season.championId!;
    expect(postseasonReached(season, champion)).toBe(3);
  });

  it("a college review moves security like an owner's, and can fire after a full season", () => {
    const r = season.job.reviews.at(-1)!;
    expect(r.note).toMatch(/^The athletic director is /);
    expect(Object.keys(r.grades).sort()).toEqual(["postseason", "recruiting", "winning"]);
    const doomed: Franchise = {
      ...season,
      job: { ...season.job, security: 1, seasons: 1, goals: season.job.goals.map((g) => ({ ...g, target: g.key === "recruiting" ? 1 : 99 })) },
    };
    expect(applyReview(doomed, ownerReview(doomed)).job.fired).toBeDefined();
  });

  it("college staff cost a quarter of pro staff and must fit the staff budget", () => {
    expect(STAFF_PAY).toEqual({ pro: 1, college: 0.25, hs: 0.01 });
    const pro = createFranchise({ league: "pro", team: proTeams[0], teams: proTeams, seed: "program", now: 1 });
    const proPool = staffPool(pro, "assistant");
    const collegePool = staffPool({ ...top, season: { ...top.season, year: pro.season.year } }, "assistant");
    for (let i = 0; i < proPool.length; i++) expect(collegePool[i].salary).toBe(Math.round((proPool[i].salary * 0.25) / 1000) * 1000);
    expect(staffBudget(byPrestige[0], "college")).toBe(Math.round(600_000 + byPrestige[0].prestige * 2_400_000));
    const priciest = [...staffPool(small, "assistant")].sort((a, b) => b.salary - a.salary)[0];
    const budget = staffBudget(byPrestige.at(-1)!, "college");
    const pricey = { ...priciest, salary: budget + 1 };
    const refused = tryHireStaff(small, pricey, byPrestige.at(-1)!);
    expect("error" in refused && refused.error).toMatch(/budget/);
    const fine = tryHireStaff(small, { ...priciest, salary: 1000 }, byPrestige.at(-1)!);
    expect("error" in fine).toBe(false);
  });

  it("pro goals and reviews are unchanged", () => {
    const pro = createFranchise({ league: "pro", team: proTeams[0], teams: proTeams, seed: "program", now: 1 });
    expect(pro.job.goals.map((g) => g.key)).toEqual(["winning", "profit", "development"]);
    expect(ownerReview(pro).note).toMatch(/^The owner is /);
    const anything = tryHireStaff(pro, { ...staffPool(pro, "scout")[0], salary: 99e6 }, proTeams[0]);
    expect("error" in anything).toBe(false);
  });
});
