import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Team } from "@/engine/types";
import { createFranchise } from "../create";
import { HALL_BAR, hallScore, induct } from "../history/hall";
import type { CareerLine, RetiredPlayer } from "../types";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const f = createFranchise({ league: "pro", team: teams[0], teams, seed: "hall", now: 1 });
const line = (seasons: number, pts: number, reb = 4000, ast = 4000): CareerLine => ({
  seasons,
  gp: seasons * 70,
  min: 1,
  pts,
  reb,
  ast,
  stl: 500,
  blk: 200,
  bestSeasonPts: 2000,
});
const retired = (career: CareerLine, awards = 0, titles = 0): RetiredPlayer => ({
  id: "r",
  name: "A B",
  pos: "SF",
  year: 2040,
  age: 37,
  peak: 90,
  lastTeamId: teams[1].id,
  career,
  awards,
  titles,
});

describe("the Hall of Fame", () => {
  it("a great career makes the Hall", () => {
    expect(hallScore(retired(line(16, 26000), 12, 3))).toBeGreaterThanOrEqual(HALL_BAR);
    expect(induct(f, retired(line(16, 26000), 12, 3)).hall).toHaveLength(1);
  });

  it("a long ordinary one doesn't", () => {
    expect(hallScore(retired(line(14, 9000, 3000, 1500)))).toBeLessThan(HALL_BAR);
    expect(induct(f, retired(line(14, 9000, 3000, 1500))).hall).toEqual([]);
  });

  it("titles and awards help", () => {
    expect(hallScore(retired(line(12, 15000), 8, 2))).toBeGreaterThan(hallScore(retired(line(12, 15000))));
  });

  it("the Hall keeps a retired player's stats after his row is gone", () => {
    const entry = induct(f, retired(line(16, 26000), 12, 3)).hall[0];
    expect(entry).toMatchObject({ id: "r", name: "A B", year: 2040, awards: 12, titles: 3 });
    expect(entry.career.pts).toBe(26000);
  });

  it("no career totals means no induction", () => {
    expect(induct(f, { ...retired(line(1, 1)), career: undefined }).hall).toEqual([]);
  });
});
