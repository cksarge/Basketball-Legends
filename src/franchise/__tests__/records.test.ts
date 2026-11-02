import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ScheduledGame } from "@/career/types";
import type { Team } from "@/engine/types";
import { emptyLine } from "@/game/sim/stats";
import { createFranchise } from "../create";
import { gameRecords, updateRecords } from "../history/records";
import type { Franchise, RetiredPlayer } from "../types";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const make = () => createFranchise({ league: "pro", team: teams[0], teams, seed: "records", now: 1 });
const f = make();
const [a, b] = f.rosters[teams[1].id];
const withLine = (x: Franchise, id: string, pts: number, gp = 70): Franchise => ({
  ...x,
  season: { ...x.season, stats: { ...x.season.stats, [id]: { ...emptyLine(), gp, gs: gp, pts } } },
});
const value = (x: Franchise, key: string) => x.records.find((r) => r.key === key)?.value;
const career = { seasons: 12, gp: 900, min: 1, pts: 25000, reb: 1, ast: 1, stl: 1, blk: 1, bestSeasonPts: 2500 };

describe("records", () => {
  it("a new single-season high replaces the record", () => {
    const one = updateRecords(withLine(f, a, 2000));
    expect(value(one, "seasonPts")).toBe(2000);
    const two = updateRecords(withLine(one, b, 2400));
    expect(value(two, "seasonPts")).toBe(2400);
    expect(two.records.find((r) => r.key === "seasonPts")?.playerId).toBe(b);
    const lower = updateRecords(withLine(two, a, 100));
    expect(value(lower, "seasonPts")).toBe(2400);
  });

  it("career records use retired players as well as active ones", () => {
    const retired: RetiredPlayer = { id: "gone", name: "Old Timer", pos: "SF", year: 2030, age: 39, peak: 90, lastTeamId: null, career };
    const x = updateRecords({ ...f, retired: [retired] });
    expect(x.records.find((r) => r.key === "careerPts")).toMatchObject({ value: 25000, name: "Old Timer" });
  });

  it("per-game records need a minimum number of games", () => {
    expect(value(updateRecords(withLine(f, a, 500, 10)), "seasonPpg")).toBeUndefined();
    expect(value(updateRecords(withLine(f, a, 2100, 70)), "seasonPpg")).toBe(30);
  });

  it("the user's single-game records come from box scores", () => {
    const g: ScheduledGame = { id: "g", date: f.date, level: "pro", homeId: f.teamId, awayId: teams[1].id, kind: "region" };
    const id = f.rosters[f.teamId][0];
    const x = gameRecords(f, g, { [id]: { ...emptyLine(), pts: 44, ast: 12, min: 2000 } });
    expect(value(x, "gamePts")).toBe(44);
    expect(value(gameRecords(x, g, { [id]: { ...emptyLine(), pts: 30, min: 2000 } }), "gamePts")).toBe(44);
  });

  it("another team's game doesn't count", () => {
    const g: ScheduledGame = { id: "g", date: f.date, level: "pro", homeId: teams[2].id, awayId: teams[1].id, kind: "region" };
    expect(gameRecords(f, g, { [a]: { ...emptyLine(), pts: 60, min: 2000 } })).toBe(f);
  });

  it("seasons from before the upgrade don't break records", () => {
    const old: RetiredPlayer = { id: "x", name: "Before Stats", pos: "PG", year: 2027, age: 35, peak: 80, lastTeamId: null };
    expect(() => updateRecords({ ...f, retired: [old] })).not.toThrow();
  });
});
