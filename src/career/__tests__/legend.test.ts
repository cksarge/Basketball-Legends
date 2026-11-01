import { describe, expect, it } from "vitest";
import { archetypesFor, randomAppearance } from "@/engine/player";
import { Rng } from "@/engine/rng";
import { emptyLine } from "@/game/sim/stats";
import { DEFAULT_SETTINGS, createCareer, defaultBody } from "../create";
import { LEGEND_BAR, RANKS, RANK_POINTS, isLegend, legendChance, legendEvents, legendPoints, legendStatus, rankFor } from "../legend";
import type { Career, CollegeSeason, HsSeason, ScheduledGame } from "../types";

function base(): Career {
  return createCareer(
    {
      firstName: "Test",
      lastName: "Legend",
      pos: "PG",
      archetype: archetypesFor("PG")[0],
      body: defaultBody("PG"),
      appearance: randomAppearance(new Rng(3)),
      jersey: 1,
      hometown: "Phoenix, AZ",
      schoolId: "hs-brophy-prep",
      allocation: {},
      settings: DEFAULT_SETTINGS,
      startYear: 2026,
    },
    5,
  );
}
const hsSeason = (extra: Partial<HsSeason>): HsSeason =>
  ({
    year: 2026,
    grade: 12,
    schoolId: "s",
    level: "varsity",
    moves: [],
    rosters: {},
    games: [],
    stats: {},
    awards: [],
    grades: {},
    focus: 0.5,
    ...extra,
  }) as HsSeason;
const collegeSeason = (extra: Partial<CollegeSeason>): CollegeSeason =>
  ({
    year: 2030,
    classYear: "FR",
    teamId: "t",
    tier: "D1",
    walkOn: false,
    trust: 50,
    role: "starter",
    roster: [],
    games: [],
    stats: {},
    awards: [],
    nil: [],
    ...extra,
  }) as CollegeSeason;
const game = (pts: number, played: boolean, extra: Partial<ScheduledGame> = {}): ScheduledGame =>
  ({
    id: `g${pts}`,
    date: "2031-02-01",
    level: "college",
    homeId: "t",
    awayId: "x",
    kind: "region",
    result: { home: 80, away: 70, played, overtimes: 0, userLine: { ...emptyLine(), pts } },
    ...extra,
  }) as ScheduledGame;

describe("ranks", () => {
  it("climb in order and stay below the pros until you turn pro", () => {
    expect(rankFor(0, "hs")).toBe("Local Hero");
    expect(rankFor(RANK_POINTS["State Star"]!, "hs")).toBe("State Star");
    expect(rankFor(RANK_POINTS["National Name"]!, "college")).toBe("National Name");
    expect(rankFor(5000, "college")).toBe("National Name");
    expect(rankFor(0, "pro")).toBe("Pro");
    expect(rankFor(RANK_POINTS["All-Star"]!, "pro")).toBe("All-Star");
    expect(rankFor(RANK_POINTS.Superstar!, "pro")).toBe("Superstar");
    expect(rankFor(RANK_POINTS.Icon!, "pro")).toBe("Icon");
  });

  it("never reaches Legend on points alone", () => {
    expect(rankFor(99_999, "pro")).toBe("Icon");
    expect(rankFor(99_999, "retired")).toBe("Icon");
  });

  it("names a Legend only at retirement, and only past the bar", () => {
    expect(isLegend(LEGEND_BAR - 1)).toBe(false);
    expect(isLegend(LEGEND_BAR)).toBe(true);
    expect(rankFor(LEGEND_BAR, "retired", true)).toBe("Legend");
    expect(rankFor(LEGEND_BAR - 1, "retired", isLegend(LEGEND_BAR - 1))).toBe("Icon");
    const c = { ...base(), stage: "retired" as const };
    expect(legendStatus(c).rank).not.toBe("Legend");
  });

  it("has a points target for every rank but Local Hero, Pro and Legend", () => {
    expect(RANKS.length).toBe(8);
    expect(Object.keys(RANK_POINTS).length).toBe(5);
    expect(LEGEND_BAR).toBeGreaterThan(RANK_POINTS.Icon!);
  });
});

describe("the Icon's chance", () => {
  it("is a percentage that grows with points and shrinks as time runs out", () => {
    expect(legendChance(1000, 28)).toBeGreaterThan(legendChance(1000, 36));
    expect(legendChance(1400, 30)).toBeGreaterThan(legendChance(1000, 30));
    for (const [p, a] of [
      [0, 40],
      [9000, 20],
    ]) {
      expect(legendChance(p, a)).toBeGreaterThanOrEqual(1);
      expect(legendChance(p, a)).toBeLessThanOrEqual(99);
    }
  });

  it("is hidden until you're an Icon and gone once you retire", () => {
    expect(legendStatus(base()).chance).toBeNull();
    const awards = Array.from({ length: 60 }, () => "National Player of the Year");
    const icon = { ...base(), stage: "pro" as const, player: { ...base().player, age: 30 }, college: { seasons: [collegeSeason({ awards })], earnings: 0 } };
    const st = legendStatus(icon);
    expect(st.rank).toBe("Icon");
    expect(st.chance).toBeGreaterThan(0);
    expect(legendStatus({ ...icon, stage: "retired" }).chance).toBeNull();
  });
});

describe("points", () => {
  it("come from saved high school honors, so older careers get credit", () => {
    const c = {
      ...base(),
      hs: { schoolId: "s", seasons: [hsSeason({ awards: ["6A State champion", "6A Player of the Year", "All-State 6A First Team", "Region champion"] })] },
    };
    const { pillars, total } = legendPoints(legendEvents(c));
    expect(pillars.winning).toBe(15);
    expect(pillars.greatness).toBe(20);
    expect(total).toBe(35);
    expect(legendStatus(c).rank).toBe("State Star");
  });

  it("score college honors more than high school ones", () => {
    const c = {
      ...base(),
      college: { seasons: [collegeSeason({ awards: ["National champion", "National Player of the Year", "All-American First Team"] })], earnings: 0 },
    };
    const { pillars } = legendPoints(legendEvents(c));
    expect(pillars.winning).toBe(40);
    expect(pillars.greatness).toBe(65);
  });

  it("gives no points for honors it doesn't know", () => {
    const c = { ...base(), college: { seasons: [collegeSeason({ awards: ["Team bus driver"] })], earnings: 0 } };
    expect(legendEvents(c)).toEqual([]);
  });

  it("counts Moments only from games you played yourself", () => {
    const played = { ...base(), college: { seasons: [collegeSeason({ games: [game(42, true)] })], earnings: 0 } };
    const simmed = { ...base(), college: { seasons: [collegeSeason({ games: [game(42, false)] })], earnings: 0 } };
    expect(legendPoints(legendEvents(played)).pillars.moments).toBe(5);
    expect(legendPoints(legendEvents(simmed)).pillars.moments).toBe(0);
  });

  it("community NIL work counts for Impact", () => {
    const nil = [{ id: "n", brand: "Food Bank Drive", kind: "community" as const, amount: 500, status: "signed" as const }];
    const c = { ...base(), college: { seasons: [collegeSeason({ nil })], earnings: 500 } };
    expect(legendPoints(legendEvents(c)).pillars.impact).toBe(3);
  });

  it("shows the next rank to chase", () => {
    expect(legendStatus(base()).next).toEqual({ rank: "State Star", points: 30 });
  });
});
