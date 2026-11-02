import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runMatchSync } from "@/career/hs/play";
import { generateRoster } from "@/engine/player";
import type { Team } from "@/engine/types";
import { Match, type MatchSetup } from "../sim/match";
import { emptyLine } from "../sim/stats";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const [a, b] = teams;
const ra = generateRoster(a, 1),
  rb = generateRoster(b, 2);
const star = ra[0];
const setup = (o: Partial<MatchSetup> = {}): MatchSetup => ({
  league: "pro",
  quarterMinutes: 2,
  seed: 5,
  home: { team: a, roster: ra },
  away: { team: b, roster: rb },
  startFrom: { period: 4, homeScore: 80, awayScore: 75, box: { [star.id]: { ...emptyLine(), pts: 30, fgm: 12, fga: 20, min: 1800, pf: 2 } } },
  ...o,
});

describe("starting from the 4th quarter", () => {
  it("opens in period 4 with the score and box, and no jump ball", () => {
    const m = new Match({ ...setup(), fast: true });
    expect(m.state.period).toBe(4);
    expect(m.state.teams[0].score).toBe(80);
    expect(m.state.teams[1].score).toBe(75);
    expect(m.state.box[star.id].pts).toBe(30);
    expect(m.state.phase).not.toBe("jumpball");
    expect(m.state.clock).toBe(120);
    expect(m.state.teams[0].periodScores).toHaveLength(3);
    expect(m.state.teams[0].periodScores.reduce((x, y) => x + y, 0)).toBe(80);
  });

  it("plays out to a final", () => {
    const m = runMatchSync(setup());
    expect(m.state.phase).toBe("final");
    expect(m.state.teams[0].score).toBeGreaterThanOrEqual(80);
    expect(m.state.box[star.id].pts).toBeGreaterThanOrEqual(30);
  });

  it("keeps a player who has fouled out on the bench", () => {
    const m = new Match({
      ...setup({ startFrom: { period: 4, homeScore: 80, awayScore: 75, box: { [star.id]: { ...emptyLine(), pf: 6 } } } }),
      fast: true,
    });
    expect(m.state.teams[0].onCourt).not.toContain(star.id);
    for (let i = 0; i < 3000 && m.state.phase !== "final"; i++) {
      m.step(1 / 30);
      expect(m.state.teams[0].onCourt).not.toContain(star.id);
    }
  });

  it("credits minutes already played", () => {
    const m = new Match({ ...setup(), fast: true });
    expect(m.state.teams[0].minutes[star.id]).toBe(1800);
  });
});
