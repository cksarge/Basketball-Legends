import { describe, expect, it } from "vitest";
import pro from "@/data/generated/pro.json";
import { Match, type MatchSetup } from "../sim/match";
import { generateRoster } from "@/engine/player";
import type { Team } from "@/engine/types";

const teams = (pro as { teams: Team[] }).teams;
const setup = (): MatchSetup => ({
  league: "pro",
  home: { team: teams[3], roster: generateRoster(teams[3]) },
  away: { team: teams[12], roster: generateRoster(teams[12]) },
  fast: true,
  seed: 77,
  quarterMinutes: 3,
});
const run = (m: Match, steps: number) => {
  for (let i = 0; i < steps && m.state.phase !== "final"; i++) m.step(1 / 60);
};

describe("suspend and resume", () => {
  it("a restored game continues exactly like the original", () => {
    const a = new Match(setup());
    run(a, 60 * 200);
    const saved = a.serialize();
    const b = Match.restore(setup(), saved);
    expect(b.state.teams[0].score).toBe(a.state.teams[0].score);
    expect(b.state.clock).toBeCloseTo(a.state.clock, 6);
    run(a, 60 * 400);
    run(b, 60 * 400);
    expect(b.state.teams.map((t) => t.score)).toEqual(a.state.teams.map((t) => t.score));
    expect(b.state.period).toBe(a.state.period);
    expect(b.state.clock).toBeCloseTo(a.state.clock, 6);
  });
  it("keeps on-court players linked to the roster", () => {
    const a = new Match(setup());
    run(a, 60 * 60);
    const b = Match.restore(setup(), a.serialize());
    for (const ag of b.state.agents) expect(b.state.teams[ag.team].roster).toContain(ag.player);
  });
});
