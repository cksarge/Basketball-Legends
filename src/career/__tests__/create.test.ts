import { describe, expect, it } from "vitest";
import { ALL_KEYS, archetypesFor, overall, randomAppearance } from "@/engine/player";
import { Rng } from "@/engine/rng";
import { POSITIONS, type Position } from "@/engine/types";
import {
  CREATOR_MAX_PER_RATING,
  DEFAULT_SETTINGS,
  HEIGHT_RANGE,
  WINGSPAN_RANGE,
  applyAllocation,
  clampBody,
  computeCaps,
  createCareer,
  defaultBody,
  heightAtAge,
  hometownSchools,
  hometowns,
  startingRatings,
  weightRange,
} from "../create";
import type { CreatorInput } from "../types";
import hs from "@/data/generated/hs.json";
import type { Team } from "@/engine/types";

const teams = hs.teams as unknown as Team[];

function input(pos: Position = "SG", over: Partial<CreatorInput> = {}): CreatorInput {
  return {
    firstName: "Test",
    lastName: "Player",
    pos,
    archetype: archetypesFor(pos)[0],
    body: defaultBody(pos),
    appearance: randomAppearance(new Rng(1)),
    jersey: 23,
    hometown: "Phoenix, AZ",
    schoolId: teams[0].id,
    allocation: {},
    settings: DEFAULT_SETTINGS,
    startYear: 2026,
    ...over,
  };
}

describe("creator body rules", () => {
  it("clamps height, weight and wingspan to the position's ranges", () => {
    for (const pos of POSITIONS) {
      const [lo, hi] = HEIGHT_RANGE[pos];
      const tall = clampBody(pos, { adultHeightIn: 120, weightLb: 900, wingspanIn: 200 });
      expect(tall.adultHeightIn).toBe(hi);
      expect(tall.weightLb).toBe(weightRange(hi)[1]);
      expect(tall.wingspanIn).toBe(hi + WINGSPAN_RANGE[1]);
      const short = clampBody(pos, { adultHeightIn: 10, weightLb: 1, wingspanIn: 1 });
      expect(short.adultHeightIn).toBe(lo);
      expect(short.weightLb).toBe(weightRange(lo)[0]);
      expect(short.wingspanIn).toBe(lo + WINGSPAN_RANGE[0]);
    }
  });

  it("freshmen are still growing toward their adult height", () => {
    expect(heightAtAge(80, 14)).toBeLessThan(80);
    expect(heightAtAge(80, 16)).toBeGreaterThan(heightAtAge(80, 14));
    expect(heightAtAge(80, 18)).toBe(80);
  });
});

describe("rating caps", () => {
  it("every cap is between 55 and 99", () => {
    for (const pos of POSITIONS)
      for (const a of archetypesFor(pos)) {
        const caps = computeCaps(pos, a, defaultBody(pos));
        for (const k of ALL_KEYS) {
          expect(caps[k]).toBeGreaterThanOrEqual(55);
          expect(caps[k]).toBeLessThanOrEqual(99);
        }
      }
  });

  it("height trades speed and handles for size skills", () => {
    const short = computeCaps("SF", "Two-Way Wing", { adultHeightIn: 75, weightLb: 200, wingspanIn: 78 });
    const tall = computeCaps("SF", "Two-Way Wing", { adultHeightIn: 82, weightLb: 220, wingspanIn: 85 });
    expect(tall.speed).toBeLessThan(short.speed);
    expect(tall.ballHandle).toBeLessThan(short.ballHandle);
    expect(tall.block).toBeGreaterThan(short.block);
    expect(tall.defReb).toBeGreaterThan(short.defReb);
  });

  it("weight builds strength at the cost of speed; wingspan helps defense", () => {
    const light = computeCaps("PF", "Two-Way Wing", { adultHeightIn: 80, weightLb: 200, wingspanIn: 82 });
    const heavy = computeCaps("PF", "Two-Way Wing", { adultHeightIn: 80, weightLb: 260, wingspanIn: 82 });
    expect(heavy.strength).toBeGreaterThan(light.strength);
    expect(heavy.speed).toBeLessThan(light.speed);
    const long = computeCaps("PF", "Two-Way Wing", { adultHeightIn: 80, weightLb: 220, wingspanIn: 88 });
    expect(long.steal).toBeGreaterThan(light.steal);
    expect(long.block).toBeGreaterThan(light.block);
  });

  it("archetypes raise their signature skills", () => {
    const body = defaultBody("SG");
    expect(computeCaps("SG", "Sharpshooter", body).three).toBeGreaterThan(computeCaps("SG", "Slasher", body).three);
    expect(computeCaps("SG", "Slasher", body).dunk).toBeGreaterThan(computeCaps("SG", "Sharpshooter", body).dunk);
  });
});

describe("starting ratings and allocation", () => {
  it("start well below the caps", () => {
    const caps = computeCaps("PG", "Floor General", defaultBody("PG"));
    const r = startingRatings("PG", "Floor General", caps, new Rng(5));
    for (const k of ALL_KEYS) expect(r[k]).toBeLessThanOrEqual(caps[k] - 20);
    expect(overall(r, "PG")).toBeLessThan(55);
  });

  it("allocation adds at most the per-rating limit and never passes a cap", () => {
    const caps = computeCaps("C", "Rim Protector", defaultBody("C"));
    const base = startingRatings("C", "Rim Protector", caps, new Rng(5));
    const after = applyAllocation(base, caps, { block: 50, three: 3 });
    expect(after.block - base.block).toBe(CREATOR_MAX_PER_RATING);
    expect(after.three - base.three).toBe(3);
    const nearCap = applyAllocation({ ...base, steal: caps.steal - 2 }, caps, { steal: 10 });
    expect(nearCap.steal).toBe(caps.steal);
  });
});

describe("createCareer", () => {
  it("builds a freshman at the chosen school with a welcome message", () => {
    const c = createCareer(input("PG", { allocation: { three: 5 } }), 1234);
    expect(c.stage).toBe("hs");
    expect(c.date).toBe("2026-08-01");
    expect(c.player.age).toBe(14);
    expect(c.player.classYear).toBe("FR");
    expect(c.player.teamId).toBe(teams[0].id);
    expect(c.player.isUser).toBe(true);
    expect(c.player.heightIn).toBeLessThan(c.player.body.adultHeightIn);
    expect(c.player.potential).toBeGreaterThan(overall(c.player.ratings, "PG"));
    expect(c.inbox).toHaveLength(1);
  });

  it("is deterministic for a seed", () => {
    const a = createCareer(input("SF"), 99);
    const b = createCareer(input("SF"), 99);
    expect(a.player.ratings).toEqual(b.player.ratings);
  });

  it("fixes an archetype that doesn't fit the position", () => {
    const c = createCareer(input("C", { archetype: "Floor General" }), 3);
    expect(archetypesFor("C")).toContain(c.player.archetype);
  });

  it("falls back to placeholder names and clamps the jersey number", () => {
    const c = createCareer(input("SG", { firstName: "  ", lastName: "", jersey: 140 }), 3);
    expect(c.player.firstName).toBe("Rookie");
    expect(c.player.jersey).toBe(99);
  });
});

describe("hometowns and schools", () => {
  it("every hometown has at least one school, biggest classification first", () => {
    const towns = hometowns(teams);
    expect(towns.length).toBeGreaterThan(100);
    for (const t of towns) expect(hometownSchools(teams, t).length).toBeGreaterThan(0);
    const phx = hometownSchools(teams, "Phoenix, AZ");
    expect(phx[0].tier).toBe("6A");
  });
});
