import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nextSeries } from "@/career/pro/bracket";
import { generateProSchedule } from "@/career/pro/schedule";
import type { Team } from "@/engine/types";
import { startNewSeason } from "../core/offseason";
import { simDay } from "../core/season";
import { simBox } from "../boxsim";
import { boxInputFor } from "../core/season";
import { progressPlayer } from "../core/progress";
import { createFranchise } from "../create";
import { leaders, seasonAwards } from "../core/awards";
import { Rng } from "@/engine/rng";
import { generatePlayer, playerOvr } from "@/engine/player";
import { tradeReply } from "../pro/tradeAi";
import type { Trade } from "../pro/trades";
import { DEFAULT_LEAGUE, applyPending, setLeagueSettings, trimSchedule } from "../settings";
import type { Franchise, LeagueSettings } from "../types";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const ids = teams.map((t) => t.id);
const make = (league: Partial<LeagueSettings> = {}, seed = "settings") =>
  createFranchise({ league: "pro", team: teams[0], teams, seed, now: 1, settings: { league: { ...DEFAULT_LEAGUE, ...league } } });
function season(f: Franchise) {
  let x = f;
  for (let i = 0; i < 400 && x.phase !== "offseason"; i++) x = simDay(x, teams, { includeUser: true }).franchise;
  return x;
}

describe("game count", () => {
  for (const n of [70, 58, 41]) {
    it(`gives every team exactly ${n} games, about half at home`, () => {
      const games = trimSchedule(generateProSchedule(teams, 2026, "s"), ids, n, "s");
      for (const id of ids) {
        const own = games.filter((g) => g.homeId === id || g.awayId === id);
        expect(own).toHaveLength(n);
        const home = own.filter((g) => g.homeId === id).length;
        expect(Math.abs(home - n / 2)).toBeLessThanOrEqual(5);
      }
    });
  }

  it("82 games is the schedule as it was", () => {
    const games = generateProSchedule(teams, 2026, "s");
    expect(trimSchedule(games, ids, 82, "s")).toBe(games);
  });

  it("a new franchise uses its game count", () => {
    expect(make({ gamesPerSeason: 41 }).season.games).toHaveLength(615);
  });

  it("a 41-game season reaches a champion with valid awards and leaders", () => {
    const f = season(make({ gamesPerSeason: 41 }));
    expect(f.season.championId).toBeDefined();
    expect(f.season.awards.find((a) => a.id === "mvp")).toBeDefined();
    expect(leaders(f, "fgPct").length).toBeGreaterThan(0);
    expect(seasonAwards(f, teams).length).toBeGreaterThan(10);
  });
});

describe("playoff format", () => {
  it("best of five shortens the first round only", () => {
    const f = season(make({ playoffFormat: { firstRoundBestOf: 5, playIn: true } }));
    expect(f.season.series.filter((x) => x.round === 1).every((x) => x.bestOf === 5)).toBe(true);
    expect(f.season.series.filter((x) => x.round === 2).every((x) => x.bestOf === 7)).toBe(true);
    expect(f.season.championId).toBeDefined();
  });

  it("with no play-in, seeds 7 and 8 go straight through", () => {
    const f = season(make({ playoffFormat: { firstRoundBestOf: 7, playIn: false } }));
    expect(f.season.series.some((x) => x.round === 0)).toBe(false);
    expect(f.season.series.filter((x) => x.round === 1)).toHaveLength(8);
    expect(f.season.championId).toBeDefined();
  });

  it("the career bracket is unchanged with no format", () => {
    const out = nextSeries({ year: 2026, games: [], series: [], seeds: () => ids.slice(0, 15) });
    expect(out.map((x) => x.round)).toEqual([0, 0, 0, 0]);
    expect(out[0].bestOf).toBe(1);
  });
});

describe("when settings apply", () => {
  it("game count and playoff format wait for next season, and apply once", () => {
    const f = setLeagueSettings(make(), { gamesPerSeason: 41, playoffFormat: { firstRoundBestOf: 5, playIn: false } });
    expect(f.settings.league.gamesPerSeason).toBe(82);
    expect(f.settings.pendingLeague?.gamesPerSeason).toBe(41);
    const next = applyPending(f);
    expect(next.settings.league.gamesPerSeason).toBe(41);
    expect(next.settings.league.playoffFormat.playIn).toBe(false);
    expect(next.settings.pendingLeague).toBeUndefined();
    expect(applyPending(next)).toBe(next);
  });

  it("changing them twice keeps the last choice", () => {
    const f = setLeagueSettings(setLeagueSettings(make(), { gamesPerSeason: 41 }), { gamesPerSeason: 58 });
    expect(applyPending(f).settings.league.gamesPerSeason).toBe(58);
  });

  it("choosing the current value clears the wait", () => {
    const f = setLeagueSettings(setLeagueSettings(make(), { gamesPerSeason: 41 }), { gamesPerSeason: 82 });
    expect(f.settings.pendingLeague).toBeUndefined();
  });

  it("the next season uses what was waiting", () => {
    const f: Franchise = { ...setLeagueSettings(make(), { gamesPerSeason: 41 }), phase: "offseason", offseason: { step: "camp", report: null } };
    const next = startNewSeason(f, teams);
    expect(next.season.games).toHaveLength(615);
    expect(next.settings.pendingLeague).toBeUndefined();
  });

  it("the other settings apply at once", () => {
    const f = setLeagueSettings(make(), { tradeDifficulty: "hard", injuries: "off", progression: "fast" });
    expect(f.settings.league).toMatchObject({ tradeDifficulty: "hard", injuries: "off", progression: "fast" });
    expect(f.settings.pendingLeague).toBeUndefined();
  });

  it("a waiting change survives a change that applies at once", () => {
    const f = setLeagueSettings(setLeagueSettings(make(), { gamesPerSeason: 41 }), { injuries: "off" });
    expect(applyPending(f).settings.league).toMatchObject({ gamesPerSeason: 41, injuries: "off" });
  });
});

describe("difficulty", () => {
  it("trade difficulty changes what the AI accepts at once", () => {
    const base = make();
    const me = teams[0].id,
      them = teams[1].id;
    const a = base.rosters[me][3];
    const b = base.rosters[them][3];
    const twin = { ...base.players[a], age: 26, potential: playerOvr(base.players[a]), contract: { salary: 8e6, years: 2 } };
    const f: Franchise = { ...base, players: { ...base.players, [a]: twin, [b]: { ...twin, id: b, teamId: them } } };
    const t: Trade = {
      teams: [me, them],
      assets: [
        { kind: "player", id: a, from: me, to: them },
        { kind: "player", id: b, from: them, to: me },
      ],
    };
    const gap = (d: LeagueSettings["tradeDifficulty"]) => tradeReply(setLeagueSettings(f, { tradeDifficulty: d }), t).gap;
    expect(gap("hard")).toBeGreaterThanOrEqual(gap("normal"));
    expect(gap("normal")).toBeGreaterThanOrEqual(gap("easy"));
    expect(gap("hard")).toBeGreaterThan(gap("easy"));
  });

  it("no injuries means none, and more means more", () => {
    const count = (injuries: LeagueSettings["injuries"]) => {
      const f = setLeagueSettings(make(), { injuries });
      return f.season.games.slice(0, 200).reduce((n, g) => n + simBox(boxInputFor(f, g)).injuries.length, 0);
    };
    expect(count("off")).toBe(0);
    expect(count("more")).toBeGreaterThan(count("fewer"));
  });

  it("progression speed scales yearly change, both ways", () => {
    const change = (speed: number, age: number) => {
      let total = 0;
      for (let i = 0; i < 500; i++) {
        const p = { ...generatePlayer(new Rng(`p${i}`), { pos: "SF", targetOvr: 72, age, league: "pro", teamId: "x" }), age, potential: age < 28 ? 90 : 72 };
        total += playerOvr(progressPlayer(p, new Rng(`q${i}`), 0, speed)) - playerOvr(p);
      }
      return total / 500;
    };
    expect(change(1.3, 21)).toBeGreaterThan(change(0.7, 21));
    expect(change(1.3, 34)).toBeLessThan(change(0.7, 34));
  });

  it("the defaults reproduce today's results exactly", () => {
    const f = make();
    const g = f.season.games[0];
    expect(simBox({ ...boxInputFor(f, g), injuryRate: 1 })).toEqual(simBox({ ...boxInputFor(f, g), injuryRate: undefined }));
  });
});
