import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Team } from "@/engine/types";
import { emptyLine } from "@/game/sim/stats";
import { leaders, seasonAwards } from "../core/awards";
import { simDay } from "../core/season";
import { createFranchise } from "../create";
import type { Franchise, SeasonLine } from "../types";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const make = () => createFranchise({ league: "pro", team: teams[0], teams, seed: "awards", now: 1 });
function simSeason(f: Franchise) {
  for (let i = 0; i < 400 && f.phase !== "offseason"; i++) f = simDay(f, teams, { includeUser: true }).franchise;
  return f;
}
const season = simSeason(make());
const line = (o: Partial<SeasonLine>): SeasonLine => ({ ...emptyLine(), gp: 70, gs: 70, ...o });
const withStats = (f: Franchise, stats: Record<string, SeasonLine>) => ({ ...f, season: { ...f.season, stats } });
const ids = (f: Franchise) => Object.keys(f.players);

describe("leaders", () => {
  it("sorts best first and shows averages", () => {
    const f = make();
    const [a, b] = ids(f);
    const top = leaders(withStats(f, { [a]: line({ pts: 700 }), [b]: line({ pts: 1400 }) }), "ppg");
    expect(top.map((x) => x.playerId)).toEqual([b, a]);
    expect(top[0].value).toBe(20);
  });

  it("skips players under the games minimum, scaled to the schedule", () => {
    const f = make();
    const [a, b] = ids(f);
    const top = leaders(withStats(f, { [a]: line({ pts: 1000, gp: 57 }), [b]: line({ pts: 700, gp: 58 }) }), "ppg");
    expect(top.map((x) => x.playerId)).toEqual([b]);
  });

  it("needs enough attempts for percentage titles", () => {
    const f = make();
    const [a, b] = ids(f);
    const top = leaders(withStats(f, { [a]: line({ tpm: 40, tpa: 81 }), [b]: line({ tpm: 40, tpa: 90 }) }), "tpPct");
    expect(top.map((x) => x.playerId)).toEqual([b]);
  });

  it("honors the limit", () => {
    expect(leaders(season, "rpg", 5)).toHaveLength(5);
  });
});

describe("seasonAwards", () => {
  const awards = season.season.awards;
  const one = (id: string) => awards.find((a) => a.id === id)!;

  it("lands when the Finals end", () => {
    for (const id of ["mvp", "dpoy", "sixth", "finalsMvp"]) expect(one(id)).toBeDefined();
    for (const id of ["allLeague1", "allLeague2", "allLeague3"]) expect(awards.filter((a) => a.id === id)).toHaveLength(5);
  });

  it("gives the MVP to someone who played enough games", () => {
    expect(season.season.stats[one("mvp").playerId].gp).toBeGreaterThanOrEqual(58);
  });

  it("keeps a player with too few games out of the MVP race", () => {
    const f = make();
    const [a, b] = ids(f);
    const r = seasonAwards(withStats(f, { [a]: line({ pts: 4000, gp: 30 }), [b]: line({ pts: 1000 }) }), teams);
    expect(r.find((x) => x.id === "mvp")?.playerId).toBe(b);
  });

  it("gives Sixth Man to a bench player", () => {
    const l = season.season.stats[one("sixth").playerId];
    expect(l.gs).toBeLessThan(l.gp / 2);
  });

  it("puts nobody on two All-League teams", () => {
    const picks = awards.filter((a) => a.id.startsWith("allLeague")).map((a) => a.playerId);
    expect(new Set(picks).size).toBe(15);
  });

  it("gives Finals MVP to a player on the champion", () => {
    expect(one("finalsMvp").teamId).toBe(season.season.championId);
  });
});

describe("awards and teamless players", () => {
  it("a player released before the awards can't win one without a team", () => {
    const f = createFranchise({ league: "pro", team: teams[0], teams, seed: "teamless", now: 1 });
    const [gone, kept] = f.rosters[teams[1].id];
    const big = { ...emptyLine(), gp: 80, gs: 80, pts: 2400, stl: 400, blk: 400 };
    const fine = { ...emptyLine(), gp: 80, gs: 80, pts: 800 };
    const next = {
      ...f,
      players: { ...f.players, [gone]: { ...f.players[gone], teamId: null } },
      season: { ...f.season, stats: { [gone]: big, [kept]: fine } },
    };
    const scheduled = { ...next, season: { ...next.season, games: f.season.games } };
    for (const a of seasonAwards(scheduled, teams)) expect(a.teamId).toBeTruthy();
  });
});
