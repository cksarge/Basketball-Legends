import { describe, expect, it } from "vitest";
import pro from "@/data/generated/pro.json";
import { Match } from "../sim/match";
import { generateRoster } from "@/engine/player";
import type { Team } from "@/engine/types";

const teams = (pro as { teams: Team[] }).teams;

function play(seed: number, injuries: boolean, injuryRate = 1) {
  const [h, a] = [teams[2], teams[9]];
  const m = new Match({
    league: "pro",
    home: { team: h, roster: generateRoster(h) },
    away: { team: a, roster: generateRoster(a) },
    fast: true,
    seed,
    injuries,
    quarterMinutes: 6,
    sliders: { injuryRate },
  });
  let steps = 0;
  while (m.state.phase !== "final" && steps < 60 * 60 * 80) {
    m.step(1 / 60);
    steps++;
  }
  return m;
}

describe("in-game injuries", () => {
  it("never happen when the setting is off", () => {
    expect(play(4, false, 2).state.injuries).toHaveLength(0);
  }, 60_000);
  it("take the hurt player off the floor for the rest of the game", () => {
    let seen = 0;
    // a high injury-rate slider so injuries reliably happen whatever the exact game flow
    for (let seed = 1; seed <= 6; seed++) {
      const m = play(seed, true, 12);
      for (const inj of m.state.injuries) {
        seen++;
        const t = m.state.teams[inj.team];
        expect(t.onCourt).not.toContain(inj.playerId);
        expect(inj.gamesOut).toBeGreaterThanOrEqual(0);
      }
      expect(m.state.phase).toBe("final");
    }
    expect(seen).toBeGreaterThan(0);
  }, 120_000);
});
