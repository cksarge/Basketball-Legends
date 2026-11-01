import { describe, expect, it } from "vitest";
import { archetypesFor, playerOvr, randomAppearance } from "@/engine/player";
import { Rng } from "@/engine/rng";
import type { Team } from "@/engine/types";
import hs from "@/data/generated/hs.json";
import college from "@/data/generated/college.json";
import pro from "@/data/generated/pro.json";
import { emptyLine } from "@/game/sim/stats";
import { DEFAULT_SETTINGS, createCareer, defaultBody } from "../create";
import { hsContext, startSeason } from "../hs/season";
import { calendarItems, careerGoals, gameLog, seasonRows, trackHistory } from "../timeline";
import type { Career, CollegeSeason, HsSeason, ScheduledGame } from "../types";

const ctx = hsContext(hs.teams as unknown as Team[], college.teams as unknown as Team[], college.conferences, pro.teams as unknown as Team[]);
const base = (): Career =>
  createCareer(
    {
      firstName: "Test",
      lastName: "Time",
      pos: "PG",
      archetype: archetypesFor("PG")[0],
      body: defaultBody("PG"),
      appearance: randomAppearance(new Rng(3)),
      jersey: 4,
      hometown: "Phoenix, AZ",
      schoolId: "hs-brophy-prep",
      allocation: {},
      settings: DEFAULT_SETTINGS,
      startYear: 2026,
    },
    5,
  );
const stats = (gp: number, pts: number) => ({ ...emptyLine(), gp, gs: gp, pts, ast: gp * 3, oreb: gp, dreb: gp, min: gp * 1800 });
const goal = (c: Career, label: string) =>
  careerGoals(c)
    .flatMap((g) => g.goals)
    .find((x) => x.label === label)!;

describe("stat history", () => {
  it("lists every season you played across every stage, in order", () => {
    const c = base();
    const withHs = {
      ...c,
      hs: {
        ...c.hs,
        seasons: [
          { year: 2026, grade: 9, stats: { frso: stats(10, 100) }, awards: [] },
          { year: 2027, grade: 10, stats: { jv: stats(5, 40), varsity: stats(10, 200) }, awards: [] },
        ] as unknown as HsSeason[],
      },
    };
    const full = { ...withHs, college: { seasons: [{ year: 2030, stats: stats(30, 450), awards: [] }] as unknown as CollegeSeason[], earnings: 0 } };
    const rows = seasonRows(full);
    expect(rows.map((r) => r.stage)).toEqual(["High school", "High school", "College"]);
    expect(rows[1].ppg).toBe(20);
    expect(rows[2].rpg).toBe(2);
    expect(rows.map((r) => r.label)).toEqual(["26-27", "27-28", "30-31"]);
  });

  it("logs this season's games from real box scores only", () => {
    const c = startSeason(base(), 2026, ctx);
    expect(gameLog(c)).toEqual([]);
  });

  it("keeps one overall per year, and updates it through the year", () => {
    let c = trackHistory({ ...base(), date: "2026-09-01" });
    expect(c.history).toEqual([{ year: 2026, ovr: playerOvr(c.player) }]);
    const same = trackHistory(c);
    expect(same).toBe(c);
    const stronger = { ...c, player: { ...c.player, ratings: { ...c.player.ratings, three: 99, midRange: 99, layup: 99 } } };
    c = trackHistory(stronger);
    expect(c.history!.length).toBe(1);
    expect(c.history![0].ovr).toBeGreaterThanOrEqual(playerOvr(base().player));
    c = trackHistory({ ...c, date: "2027-09-01" });
    expect(c.history!.length).toBe(2);
  });
});

describe("the calendar", () => {
  it("shows your games and the dates that matter", () => {
    const c = startSeason(base(), 2026, ctx);
    const items = calendarItems(c, ctx);
    expect(items.some((i) => i.label === "Tryouts")).toBe(true);
    expect(items.some((i) => i.label === "State playoffs")).toBe(true);
    expect(items.filter((i) => i.kind === "game").length).toBeGreaterThan(10);
    expect([...items].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map((i) => i.date)).toEqual(items.map((i) => i.date));
  });

  it("marks wins and losses from your side of the score", () => {
    const c = startSeason(base(), 2026, ctx);
    const s = c.hs.seasons[0];
    const mine = s.games.find((g) => g.level === s.level && (g.homeId === s.schoolId || g.awayId === s.schoolId))! as ScheduledGame;
    const played = { ...mine, result: { home: mine.homeId === s.schoolId ? 40 : 60, away: mine.homeId === s.schoolId ? 60 : 40, played: true, overtimes: 0 } };
    const next = { ...c, hs: { ...c.hs, seasons: [{ ...s, games: s.games.map((g) => (g.id === mine.id ? played : g)) }] } };
    const item = calendarItems(next, ctx).find((i) => i.kind === "game" && i.result)!;
    expect(item.result).toBe("L");
    expect(item.score).toBe("40-60");
  });
});

describe("goals", () => {
  it("start with nothing done", () => {
    const groups = careerGoals(base());
    expect(groups.length).toBe(4);
    expect(groups.flatMap((g) => g.goals).filter((x) => x.done)).toEqual([]);
  });

  it("check off from what you've actually done", () => {
    const c = base();
    const done = {
      ...c,
      hs: {
        ...c.hs,
        seasons: [
          {
            year: 2026,
            grade: 9,
            stats: { varsity: stats(10, 100) },
            awards: ["6A State champion", "All-State 6A First Team"],
            grades: {},
            games: [],
            ranking: { stars: 5 },
          },
        ] as unknown as HsSeason[],
      },
    };
    expect(goal(done, "Make varsity").done).toBe(true);
    expect(goal(done, "Make varsity as an underclassman").done).toBe(true);
    expect(goal(done, "Win a state title").done).toBe(true);
    expect(goal(done, "All-State").done).toBe(true);
    expect(goal(done, "Become a 5-star recruit").done).toBe(true);
    expect(goal(done, "All-Region").done).toBe(false);
  });

  it("show progress toward numbers", () => {
    const c = base();
    const p = {
      ...c,
      hs: { ...c.hs, seasons: [{ year: 2026, grade: 9, stats: {}, awards: [], grades: {}, games: [], ranking: { stars: 3 } }] as unknown as HsSeason[] },
    };
    expect(goal(p, "Become a 5-star recruit").progress).toEqual({ value: 3, of: 5 });
  });
});
