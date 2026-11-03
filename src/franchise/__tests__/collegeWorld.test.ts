import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import type { Conference, Team } from "@/engine/types";
import { collegeCalendar } from "@/career/calendar";
import { simDay } from "../core/season";
import { createFranchise } from "../create";
import { defaultLeagueSettings } from "../settings";
import { commitFranchise, createFranchiseSave, exportFranchise, loadFranchise, openFranchiseDb } from "../storage";
import type { Franchise } from "../types";
import { outsideRoster, outsideStrength, outsideTeams, worldTeams } from "../world";

const data = JSON.parse(readFileSync("src/data/generated/college.json", "utf8")) as { teams: Team[]; conferences: Conference[] };
const teams = data.teams;
const d1 = teams.filter((t) => t.tier === "D1");
const d3 = teams.filter((t) => t.tier === "D3");
const make = (team = d1[0], seed = "college", games?: number) =>
  createFranchise({
    league: "college",
    team,
    teams,
    conferences: data.conferences,
    seed,
    now: 1,
    ...(games ? { settings: { league: { ...defaultLeagueSettings("college"), gamesPerSeason: games } } } : {}),
  });
const base = make();
const regularCounts = (f: Franchise) => {
  const n: Record<string, number> = {};
  for (const g of f.season.games) for (const id of [g.homeId, g.awayId]) n[id] = (n[id] ?? 0) + 1;
  return n;
};
function simDays(f: Franchise, days: number, all = teams) {
  for (let i = 0; i < days; i++) f = simDay(f, all, { includeUser: true }).franchise;
  return f;
}

beforeEach(() => {
  openFranchiseDb(`test-${Math.random()}`);
});

describe("the college world", () => {
  it("a Division I franchise has 365 teams of players and none from other divisions", () => {
    expect(base.world).toEqual({ league: "college", division: "D1" });
    expect(Object.keys(base.rosters)).toHaveLength(365);
    expect(Object.keys(base.rosters).every((id) => d1.some((t) => t.id === id))).toBe(true);
    expect(worldTeams(teams, base.world)).toHaveLength(365);
    expect(outsideTeams(teams, base.world)).toHaveLength(teams.length - 365);
  });

  it("each program's roster has 13 to 15 players with class years and eligibility", () => {
    for (const ids of Object.values(base.rosters)) {
      expect(ids.length).toBeGreaterThanOrEqual(13);
      expect(ids.length).toBeLessThanOrEqual(15);
      for (const id of ids) {
        const p = base.players[id];
        expect(["FR", "SO", "JR", "SR"]).toContain(p.classYear);
        expect(p.file?.eligibility).toEqual({ used: ["FR", "SO", "JR", "SR"].indexOf(p.classYear!), redshirted: false });
        expect(p.contract).toBeUndefined();
      }
    }
  });

  it("every program plays 26 to 31 regular-season games, with conference games from January", () => {
    const n = regularCounts(base);
    for (const t of d1) {
      expect(n[t.id], t.id).toBeGreaterThanOrEqual(26);
      expect(n[t.id], t.id).toBeLessThanOrEqual(31);
    }
    const start = collegeCalendar(base.season.year).conferenceStart;
    expect(base.season.games.filter((g) => g.kind === "region").every((g) => g.date >= start)).toBe(true);
  });

  it("a 22-game setting gives every program 20 to 23 games", () => {
    const n = regularCounts(make(d1[0], "short", 22));
    for (const t of d1) {
      expect(n[t.id], t.id).toBeGreaterThanOrEqual(20);
      expect(n[t.id], t.id).toBeLessThanOrEqual(23);
    }
  });

  it("Divisions II and III get a full outside schedule, and their results land on the right days", () => {
    const outside = base.season.outside!;
    const ids = new Set(outsideTeams(teams, base.world).map((t) => t.id));
    expect(outside.games.length).toBeGreaterThan(9000);
    expect(outside.games.every((g) => ids.has(g.homeId) && ids.has(g.awayId))).toBe(true);
    const week = simDays(base, 7);
    const played = week.season.outside!.games.filter((g) => g.result);
    expect(played.length).toBeGreaterThan(0);
    expect(played.every((g) => g.date < week.date)).toBe(true);
    expect(week.season.outside!.games.filter((g) => !g.result).every((g) => g.date >= week.date)).toBe(true);
  });

  it("an outside roster is the same every time it's viewed", () => {
    const t = d3[5];
    expect(outsideRoster(t, 2026, "college")).toEqual(outsideRoster(t, 2026, "college"));
    expect(outsideRoster(t, 2026, "college").length).toBeGreaterThanOrEqual(13);
    expect(outsideRoster(t, 2027, "college")).not.toEqual(outsideRoster(t, 2026, "college"));
  });

  it("outside strength follows prestige", () => {
    const sorted = [...d1].sort((a, b) => a.prestige - b.prestige);
    const low = sorted.slice(0, 40).reduce((s, t) => s + outsideStrength(t, 2026, "x"), 0) / 40;
    const high = sorted.slice(-40).reduce((s, t) => s + outsideStrength(t, 2026, "x"), 0) / 40;
    expect(high).toBeGreaterThan(low + 8);
  });

  it("a new Division I save is under 12 MB", () => {
    expect(exportFranchise(base).length).toBeLessThan(12_000_000);
  });

  it("a Division I regular season sims in under 60 seconds", () => {
    const start = Date.now();
    let f = base;
    const last = collegeCalendar(f.season.year).lastRegular;
    for (let i = 0; i < 200 && f.date <= last; i++) f = simDay(f, teams, { includeUser: true }).franchise;
    expect(f.season.games.filter((g) => g.kind !== "playoff").every((g) => g.result)).toBe(true);
    expect(Date.now() - start).toBeLessThan(60_000);
  });

  it("a Division III world builds and sims a week", () => {
    const f = simDays(make(d3[0], "d3"), 10);
    expect(f.world.division).toBe("D3");
    expect(Object.keys(f.rosters)).toHaveLength(d3.length);
    expect(f.season.games.some((g) => g.result)).toBe(true);
  });

  it("a reloaded college save sims the same week as one that kept running", async () => {
    const team = d1.find((t) => t.id === base.teamId)!;
    let f = await createFranchiseSave(base, team);
    let kept = base;
    for (let i = 0; i < 12; i++) {
      const step = simDay(f, teams, { includeUser: true });
      f = await commitFranchise(step.franchise, team, step.changedPlayers);
      kept = simDay(kept, teams, { includeUser: true }).franchise;
      if (i === 5) f = (await loadFranchise(f.id))!;
    }
    const reloaded = (await loadFranchise(f.id))!;
    expect(reloaded.season.games.map((g) => g.result?.home)).toEqual(kept.season.games.map((g) => g.result?.home));
    expect(reloaded.season.outside!.games.map((g) => g.result?.home)).toEqual(kept.season.outside!.games.map((g) => g.result?.home));
    expect(reloaded.players).toEqual(kept.players);
  });
});
