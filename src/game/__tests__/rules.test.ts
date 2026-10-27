import { describe, expect, it } from "vitest";
import pro from "@/data/generated/pro.json";
import { Match } from "../sim/match";
import { generateRoster } from "@/engine/player";
import type { Team, TeamTactics } from "@/engine/types";

const teams = (pro as { teams: Team[] }).teams;
const make = (tactics?: Partial<TeamTactics>, seed = 5) => new Match({
  league: "pro", home: { team: teams[1], roster: generateRoster(teams[1]), human: true, humans: [0], tactics },
  away: { team: teams[8], roster: generateRoster(teams[8]) }, seed, quarterMinutes: 4,
});

function toLiveWithBall(m: Match) {
  for (let i = 0; i < 60 * 30 && !(m.state.phase === "live" && m.state.ball.mode === "dribble" && m.handler()?.human === 0); i++) m.step(1 / 60);
  return m.handler();
}

describe("traveling", () => {
  it("is called when a player walks after picking up the dribble", () => {
    const m = make();
    const h = toLiveWithBall(m);
    expect(h).toBeTruthy();
    m.pumpFake(h!);
    expect(h!.pickedUp).toBe(true);
    // keep walking with the ball: more than a step off the pivot
    let called = false;
    for (let i = 0; i < 120 && !called; i++) {
      m.step(1 / 60, [{ moveX: 1, moveZ: 0, sprint: false }]);
      called = m.state.frameEvents.some((e) => e.t === "violation" && e.kind === "travel");
    }
    expect(called).toBe(true);
  });
  it("is not called for pivoting in place", () => {
    const m = make();
    const h = toLiveWithBall(m)!;
    m.pumpFake(h);
    let called = false;
    for (let i = 0; i < 90; i++) {
      m.step(1 / 60, [{ moveX: 0, moveZ: 0, sprint: false, faceX: h.pos.x + 1, faceZ: h.pos.z }]);
      if (m.state.frameEvents.some((e) => e.t === "violation" && e.kind === "travel")) called = true;
    }
    expect(called).toBe(false);
  });
});

describe("defensive tactics", () => {
  it("every scheme plays complete games", () => {
    for (const defense of ["man", "zone23", "zone32", "press"] as const) {
      const m = new Match({ league: "pro", home: { team: teams[2], roster: generateRoster(teams[2]), tactics: { defense } }, away: { team: teams[4], roster: generateRoster(teams[4]) }, fast: true, seed: 2, quarterMinutes: 4 });
      let n = 0;
      while (m.state.phase !== "final" && n < 60 * 60 * 60) { m.step(1 / 60); n++; }
      expect(m.state.phase).toBe("final");
      expect(m.watchdogTrips).toBeLessThan(3);
    }
  });
});
