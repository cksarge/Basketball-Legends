import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveLineup, defaultPlan } from "../coaching/plan";
import { createFranchise } from "../create";
import { leagueModule, totalMinutes } from "../leagues";
import { fillWorld } from "../pro/gmState";
import { migrateFranchise } from "../storage";
import { FRANCHISE_VERSION, type Franchise } from "../types";
import { proRun, proTeams } from "./proSnapshot";

const snapshot = JSON.parse(readFileSync("src/franchise/__tests__/pro-snapshot.json", "utf8")) as { platform: string; season: string; offseason: string };
// sim results differ between processors, so the snapshot only holds where it was recorded
const samePlatform = `${process.platform}-${process.arch}` === snapshot.platform;
const make = () => createFranchise({ league: "pro", team: proTeams[0], teams: proTeams, seed: "leagues", now: 1 });

/** A save as beta.14 wrote it: version 4, with no world. */
function beta14(f: Franchise) {
  const old = JSON.parse(JSON.stringify(f));
  for (const k of ["world", "formerWorlds"]) delete old[k];
  delete old.season.brackets;
  return { ...old, version: 4 } as Franchise;
}

describe("league modules", () => {
  const run = samePlatform ? proRun() : null;

  it.runIf(samePlatform)("a pro season with a fixed seed has the same results as the beta.14 snapshot", () => {
    expect(run!.season).toBe(snapshot.season);
  });

  it.runIf(samePlatform)("a pro offseason with a fixed seed ends with the same rosters, picks and cap as the beta.14 snapshot", () => {
    expect(run!.offseason).toBe(snapshot.offseason);
  });

  it("a beta.14 save opens as version 5 with world pro and empty brackets", () => {
    const up = migrateFranchise(beta14(make()));
    expect(up.version).toBe(FRANCHISE_VERSION);
    expect(FRANCHISE_VERSION).toBe(5);
    expect(up.world).toEqual({ league: "pro" });
    expect(up.formerWorlds).toEqual([]);
    expect(up.season.brackets).toEqual([]);
  });

  it("a beta.14 save in the offseason opens at its step", () => {
    const up = migrateFranchise({ ...beta14(make()), phase: "offseason", offseason: { step: "freeAgency", report: null } });
    expect(up.offseason?.step).toBe("freeAgency");
    expect(up.world).toEqual({ league: "pro" });
  });

  it("filling the world twice changes nothing", () => {
    const once = fillWorld(beta14(make()));
    expect(fillWorld(once)).toEqual(once);
  });

  it("total minutes are 240 in pro, 200 in college and 160 in high school", () => {
    const f = make();
    expect(totalMinutes(f)).toBe(240);
    expect(totalMinutes({ ...f, league: "college" })).toBe(200);
    expect(totalMinutes({ ...f, league: "hs" })).toBe(160);
  });

  it("starter minimums scale with the game's length", () => {
    const f = make();
    const roster = f.rosters[f.teamId].map((id) => f.players[id]);
    const starters = roster.slice(0, 5).map((p) => p.id);
    const plan = { ...defaultPlan(), autoRotation: false, starters, minutes: { [roster[5].id]: 30, [roster[6].id]: 30 } };
    const full = resolveLineup(plan, roster, 240).rotation;
    const short = resolveLineup(plan, roster, 160).rotation;
    for (const id of starters) expect(short[id] / 160).toBeCloseTo(full[id] / 240, 1);
  });

  it("leagueModule throws a clear message for an unknown league", () => {
    expect(() => leagueModule("arena" as never)).toThrow(/doesn't support/);
  });

  it("the pro module keeps the pro systems on", () => {
    const m = leagueModule("pro");
    expect(m.systems).toMatchObject({ cap: true, trades: true, freeAgency: true, draft: true, finances: true, recruiting: false, squads: false });
    expect(m.lastPeriodLabel).toBe("4th quarter");
    expect(m.arena).toBe("pro");
    expect(m.boss).toBe("owner");
    expect(m.settingsOptions.games).toEqual([82, 70, 58, 41]);
  });
});
