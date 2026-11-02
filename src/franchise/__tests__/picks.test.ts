import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Team } from "@/engine/types";
import { createFranchise } from "../create";
import { futurePicks, rollPicks } from "../pro/picks";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const ids = teams.map((t) => t.id);

describe("draft picks", () => {
  it("gives every team two picks in each of the next four drafts", () => {
    const picks = futurePicks(ids, 2027, 4);
    expect(picks).toHaveLength(30 * 2 * 4);
    expect(new Set(picks.map((p) => p.id)).size).toBe(picks.length);
    for (const id of ids) for (const year of [2027, 2028, 2029, 2030]) expect(picks.filter((p) => p.ownerId === id && p.year === year)).toHaveLength(2);
  });

  it("a new franchise owns the next four drafts", () => {
    const f = createFranchise({ league: "pro", team: teams[0], teams, seed: "p", now: 1 });
    expect(f.picks).toHaveLength(240);
    expect(Math.min(...f.picks.map((p) => p.year))).toBe(f.season.year + 1);
  });

  it("rolling forward drops used years, adds one and keeps who owns what", () => {
    const f = createFranchise({ league: "pro", team: teams[0], teams, seed: "p", now: 1 });
    const traded = f.picks.find((p) => p.year === 2028 && p.round === 1 && p.originalTeamId === ids[1])!;
    const next = rollPicks(
      { ...f, season: { ...f.season, year: f.season.year + 1 }, picks: f.picks.map((p) => (p === traded ? { ...p, ownerId: ids[0] } : p)) },
      teams,
    );
    expect(next).toHaveLength(240);
    expect(Math.min(...next.map((p) => p.year))).toBe(2028);
    expect(Math.max(...next.map((p) => p.year))).toBe(2031);
    expect(next.find((p) => p.id === traded.id)!.ownerId).toBe(ids[0]);
  });
});
