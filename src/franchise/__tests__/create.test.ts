import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Team } from "@/engine/types";
import { createFranchise, DEFAULT_FRANCHISE_SETTINGS } from "../create";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const make = (seed = "s1") => createFranchise({ league: "pro", team: teams[0], teams, seed, now: 1000 });

describe("createFranchise", () => {
  it("gives all 30 teams a roster of 13 to 15", () => {
    const f = make();
    expect(Object.keys(f.rosters)).toHaveLength(30);
    for (const ids of Object.values(f.rosters)) {
      expect(ids.length).toBeGreaterThanOrEqual(13);
      expect(ids.length).toBeLessThanOrEqual(15);
    }
  });

  it("keeps player ids unique across the league and tied to their teams", () => {
    const f = make();
    const all = Object.values(f.rosters).flat();
    expect(new Set(all).size).toBe(all.length);
    expect(Object.keys(f.players)).toHaveLength(all.length);
    for (const [teamId, ids] of Object.entries(f.rosters)) for (const id of ids) expect(f.players[id].teamId).toBe(teamId);
  });

  it("starts at revision 0 in the regular season, using the default settings", () => {
    const f = make();
    expect(f.revision).toBe(0);
    expect(f.phase).toBe("regular");
    expect(f.settings).toEqual(DEFAULT_FRANCHISE_SETTINGS);
    expect(f.settings).toMatchObject({ quarterMinutes: 6, difficulty: "pro", closeGameMargin: 8 });
    expect(f.season.year).toBe(2026);
  });

  it("is deterministic for a seed and differs across seeds", () => {
    expect(make("a").players).toEqual(make("a").players);
    expect(make("a").players).not.toEqual(make("b").players);
  });
});
