import { describe, expect, it } from "vitest";
import pro from "@/data/generated/pro.json";
import hs from "@/data/generated/hs.json";
import { Match } from "../sim/match";
import { generateRoster } from "@/engine/player";
import type { Team } from "@/engine/types";
import { teamTotals } from "../sim/stats";

function play(league: "pro" | "hs", teams: Team[], seed: number) {
  const [h, a] = [teams[0], teams[5]];
  const m = new Match({ league, home: { team: h, roster: generateRoster(h) }, away: { team: a, roster: generateRoster(a) }, fast: true, seed });
  let steps = 0;
  while (m.state.phase !== "final" && steps < 60 * 60 * 120) {
    m.step(1 / 60);
    steps++;
  }
  return m;
}

describe("real-time match", () => {
  it("plays a full pro game to a final with plausible stats", () => {
    const m = play("pro", (pro as { teams: Team[] }).teams, 3);
    const s = m.state;
    expect(s.phase).toBe("final");
    for (const t of s.teams) {
      expect(t.score).toBeGreaterThan(70);
      expect(t.score).toBeLessThan(170);
      const tot = teamTotals(
        s.box,
        t.roster.map((p) => p.id),
      );
      expect(tot.pts).toBe(t.score);
      expect(tot.fga).toBeGreaterThan(50);
    }
  });
  it("is deterministic for a seed", () => {
    const a = play("hs", (hs as { teams: Team[] }).teams, 9).state;
    const b = play("hs", (hs as { teams: Team[] }).teams, 9).state;
    expect([a.teams[0].score, a.teams[1].score]).toEqual([b.teams[0].score, b.teams[1].score]);
  });
});
