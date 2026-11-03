import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { playerOvr } from "@/engine/player";
import type { Team } from "@/engine/types";
import { createFranchise } from "../create";
import { compareRows, compareTeams } from "../history/compare";
import type { HallEntry } from "../types";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const f = createFranchise({ league: "pro", team: teams[0], teams, seed: "compare", now: 1 });
const ids = [...f.rosters[teams[0].id]].sort((x, y) => playerOvr(f.players[y]) - playerOvr(f.players[x]));
const [hi, lo] = [f.players[ids[0]], f.players[ids[14]]];
const row = (rows: ReturnType<typeof compareRows>, label: string) => rows.find((r) => r.label === label)!;

describe("comparing players", () => {
  it("the better value is marked on each row, and ties mark neither", () => {
    const rows = compareRows(hi, lo, f);
    expect(row(rows, "Overall").better).toBe("a");
    expect(compareRows(lo, hi, f).find((r) => r.label === "Overall")!.better).toBe("b");
    expect(row(compareRows(hi, hi, f), "Overall").better).toBeNull();
    expect(row(compareRows(hi, hi, f), "Overall").a).toBe(String(playerOvr(hi)));
  });

  it("an unknown rookie's rating doesn't leak into a comparison", () => {
    const rookie = { ...lo, file: { service: 0, teamSeasons: 0, range: { ovr: [60, 70] as [number, number], pot: [70, 80] as [number, number] } } };
    const rows = compareRows(hi, rookie, f);
    expect(row(rows, "Overall").b).toBe("60-70");
    expect(row(rows, "Overall").better).toBeNull();
    expect(row(rows, "Potential").b).toBe("70-80");
    expect(row(rows, "Potential").better).toBeNull();
  });

  it("a retired player can be compared from the Hall", () => {
    const entry: HallEntry = {
      id: "h",
      name: "Old Great",
      pos: "SF",
      year: 2030,
      score: 100,
      career: { seasons: 15, gp: 1000, min: 1, pts: 25000, reb: 5000, ast: 5000, stl: 1, blk: 1, bestSeasonPts: 2500 },
      awards: 10,
      titles: 2,
      lastTeamId: null,
    };
    const rows = compareRows(hi, entry, f);
    expect(row(rows, "Career points").b).toBe("25,000");
    expect(row(rows, "Career points").better).toBe("b");
    expect(row(rows, "Overall").b).toBe("-");
    expect(row(rows, "Overall").better).toBeNull();
  });
});

describe("comparing teams", () => {
  it("team comparison covers record, payroll, top eight and picks", () => {
    const rows = compareTeams(f, teams[0].id, teams[1].id, teams);
    expect(rows.map((r) => r.label)).toEqual(expect.arrayContaining(["Record", "Payroll", "Top eight", "First-round picks", "Power rank"]));
    expect(rows.find((r) => r.label === "First-round picks")!.a).toBe("4");
  });
});
