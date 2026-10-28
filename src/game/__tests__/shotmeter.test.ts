import { describe, expect, it } from "vitest";
import pro from "@/data/generated/pro.json";
import { Match, greenWindow, releaseGrade } from "../sim/match";
import { generateRoster } from "@/engine/player";
import type { Team } from "@/engine/types";

const teams = (pro as { teams: Team[] }).teams;

function humanMatch(seed = 4) {
  const [h, a] = [teams[2], teams[9]];
  return new Match({
    league: "pro",
    home: { team: h, roster: generateRoster(h), human: true, humans: [0] },
    away: { team: a, roster: generateRoster(a) },
    seed,
    shotMeter: true,
  });
}

describe("shot meter", () => {
  it("better shooters get a wider green window, within sane bounds", () => {
    expect(greenWindow(90)).toBeGreaterThan(greenWindow(50));
    expect(greenWindow(50)).toBeGreaterThan(greenWindow(30));
    expect(greenWindow(0)).toBeCloseTo(0.07);
    expect(greenWindow(99)).toBeCloseTo(0.198);
  });

  it("grades releases the same way the meter labels them", () => {
    const w = greenWindow(60);
    expect(releaseGrade(0, w)).toBe("green");
    expect(releaseGrade(w * 0.99, w)).toBe("green");
    expect(releaseGrade(-w * 0.99, w)).toBe("green");
    expect(releaseGrade(w * 1.01, w)).toBe("good");
    expect(releaseGrade(-0.3, w)).toBe("early");
    expect(releaseGrade(0.3, w)).toBe("late");
  });

  it("a green release goes in nearly every time, open or contested, for any shooter", () => {
    const m = humanMatch();
    const a = m.state.agents.find((x) => x.human === 0)!;
    for (const rating of [25, 50, 90]) {
      for (const k of ["three", "midRange", "closeShot", "layup", "freeThrow"] as const) a.player.ratings[k] = rating;
      const w = greenWindow(rating);
      expect(m.makeProbability(a, "jumper", 7.5, true, 0, 0, w)).toBeGreaterThanOrEqual(0.96);
      expect(m.makeProbability(a, "jumper", 5, false, 0, w * 0.9, w)).toBeGreaterThanOrEqual(0.96);
      expect(m.makeProbability(a, "freeThrow", 4.6, false, 0, -w * 0.5, w)).toBeGreaterThanOrEqual(0.96);
      expect(m.makeProbability(a, "layup", 1, false, 0, 0, w)).toBeGreaterThanOrEqual(0.96);
      // even smothered, a perfect release is still a very good shot
      expect(m.makeProbability(a, "jumper", 7.5, true, 1, 0, w)).toBeGreaterThanOrEqual(0.84);
    }
  });

  it("a non-green release is much less certain than a green one", () => {
    const m = humanMatch();
    const a = m.state.agents.find((x) => x.human === 0)!;
    a.player.ratings.three = 60;
    const w = greenWindow(60);
    const green = m.makeProbability(a, "jumper", 7.5, true, 0, 0, w);
    const good = m.makeProbability(a, "jumper", 7.5, true, 0, 0.18, w);
    const late = m.makeProbability(a, "jumper", 7.5, true, 0, 0.6, w);
    expect(good).toBeLessThan(green - 0.4);
    expect(late).toBeLessThan(good);
  });

  it("records the shooter's green window on the shot so the HUD band matches the engine", () => {
    const m = humanMatch();
    const s = m.state;
    const a = s.agents.find((x) => x.human === 0)!;
    s.phase = "live";
    m.giveBall(a);
    m.beginShot(a, "jumper");
    expect(a.action.kind).toBe("jumper");
    const w = a.action.data.greenW as number;
    expect(w).toBeGreaterThanOrEqual(0.07);
    expect(w).toBeLessThanOrEqual(0.2);
  });
});
