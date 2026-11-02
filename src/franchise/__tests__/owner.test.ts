import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Team } from "@/engine/types";
import { applyReview, ownerReview, seasonGoals } from "../club/owner";
import { advanceOffseason, canAdvance } from "../core/offseason";
import { createFranchise } from "../create";
import type { Franchise, OwnerReview } from "../types";
import { finishedSeason } from "./draftHelpers";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const strongest = [...teams].sort((a, b) => b.prestige - a.prestige)[0];
const weakest = [...teams].sort((a, b) => a.prestige - b.prestige)[0];
const make = (team = teams[29]) => createFranchise({ league: "pro", team, teams, seed: "owner", now: 1 });
const winning = (f: Franchise, target: number) => ({
  ...f,
  job: {
    ...f.job,
    goals: [
      { key: "winning" as const, target },
      { key: "profit" as const, target: -1e9 },
      { key: "development" as const, target: -99 },
    ],
  },
});
const review = (over: Partial<OwnerReview>): OwnerReview => ({
  year: 2026,
  grades: { winning: "F", profit: "F", development: "F" },
  change: -20,
  note: "",
  ...over,
});

describe("goals", () => {
  it("a good team's winning goal is higher than a bad team's", () => {
    const f = make();
    const goal = (t: Team) => seasonGoals({ ...f, teamId: t.id }, teams).find((g) => g.key === "winning")!.target;
    expect(goal(strongest)).toBeGreaterThan(goal(weakest));
    expect(goal(strongest)).toBeLessThanOrEqual(82);
  });

  it("every season has all three goals", () => {
    expect(
      seasonGoals(make(), teams)
        .map((g) => g.key)
        .sort(),
    ).toEqual(["development", "profit", "winning"]);
  });

  it("the winning goal follows a shorter season", () => {
    const f = make();
    const short = { ...f, settings: { ...f.settings, league: { ...f.settings.league, gamesPerSeason: 41 as const } } };
    const target = (x: Franchise) => seasonGoals(x, teams).find((g) => g.key === "winning")!.target;
    expect(target(short)).toBeLessThan(target(f));
  });
});

describe("the review", () => {
  it("beating every goal raises security, and missing them lowers it", () => {
    const f = finishedSeason(make(), teams); // teams[29] won the most
    expect(ownerReview(winning(f, 1)).change).toBeGreaterThan(0);
    expect(ownerReview(winning(f, 82)).change).toBeLessThan(ownerReview(winning(f, 1)).change);
    const bad = {
      ...f,
      job: {
        ...f.job,
        goals: [
          { key: "winning" as const, target: 82 },
          { key: "profit" as const, target: 1e12 },
          { key: "development" as const, target: 999 },
        ],
      },
    };
    expect(ownerReview(bad).change).toBeLessThan(0);
  });

  it("the owner weighs winning most, then profit and development", () => {
    const f = finishedSeason(make(), teams);
    const goals = (win: number, profit: number) => ({
      ...f,
      job: {
        ...f.job,
        goals: [
          { key: "winning" as const, target: win },
          { key: "profit" as const, target: profit },
          { key: "development" as const, target: 0 },
        ],
      },
    });
    expect(ownerReview(goals(1, 1e12)).change).toBeGreaterThan(ownerReview(goals(82, -1e12)).change);
  });

  it("a title buys time", () => {
    const f = finishedSeason(make(), teams);
    const champ = { ...f, season: { ...f.season, championId: f.teamId } };
    expect(ownerReview(winning(champ, 82)).change).toBeGreaterThan(ownerReview(winning(f, 82)).change);
  });

  it("security stays within 0 to 100", () => {
    const f = make();
    expect(applyReview({ ...f, job: { ...f.job, security: 95, seasons: 3 } }, review({ change: 30 })).job.security).toBe(100);
    expect(applyReview({ ...f, job: { ...f.job, security: 5, seasons: 3 } }, review({ change: -30 })).job.security).toBe(0);
  });

  it("a new owner gives at least one full season", () => {
    const f = make();
    const next = applyReview({ ...f, job: { ...f.job, security: 5, seasons: 0 } }, review({ change: -30 }));
    expect(next.job.fired).toBeUndefined();
    expect(next.job.seasons).toBe(1);
  });

  it("three awful seasons get a coach fired", () => {
    let f = make();
    for (let i = 0; i < 3; i++) f = applyReview(f, review({ year: 2026 + i }));
    expect(f.job.fired).toEqual({ year: 2028, teamId: f.teamId });
  });

  it("the review lands when the season ends", () => {
    const f = finishedSeason(make(), teams);
    const reviewed = applyReview(f, ownerReview(winning(f, 1)));
    expect(reviewed.job.reviews).toHaveLength(1);
  });

  it("the offseason can't move on until the user has a job", () => {
    const f = make();
    const fired: Franchise = {
      ...f,
      phase: "offseason",
      offseason: { step: "review", report: null },
      job: { ...f.job, fired: { year: 2026, teamId: f.teamId } },
    };
    expect(canAdvance(fired)).toEqual({ ok: false, reason: "Choose your next job first." });
    expect(advanceOffseason(fired, teams)).toBe(fired);
  });
});
