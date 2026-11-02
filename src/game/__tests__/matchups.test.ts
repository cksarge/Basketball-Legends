import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateRoster } from "@/engine/player";
import type { Player, Team, TeamTactics } from "@/engine/types";
import { Match } from "../sim/match";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const [a, b] = teams;
const ra = generateRoster(a, 1),
  rb = generateRoster(b, 2);
const starters = (r: Player[]) => r.slice(0, 5).map((p) => p.id);
const make = (tactics: Partial<TeamTactics>, seed = 3) =>
  new Match({
    league: "pro",
    quarterMinutes: 3,
    seed,
    fast: true,
    home: { team: a, roster: ra, starters: starters(ra), tactics },
    away: { team: b, roster: rb, starters: starters(rb) },
  });
const agentOf = (m: Match, p: Player) => m.state.agents.find((x) => x.player.id === p.id)!;
const pg = ra[0],
  theirC = rb[4];

describe("matchups", () => {
  it("puts a chosen defender on a chosen player", () => {
    const m = make({ matchups: { [pg.id]: theirC.id } });
    expect(agentOf(m, pg).guarding).toBe(agentOf(m, theirC).idx);
  });

  it("keeps everyone else on a different man", () => {
    const m = make({ matchups: { [pg.id]: theirC.id } });
    const marks = m.state.agents.filter((x) => x.team === 0).map((x) => x.guarding);
    expect(new Set(marks).size).toBe(5);
  });

  it("ignores a matchup naming someone off the floor", () => {
    const plain = make({});
    const m = make({ matchups: { [pg.id]: rb[12].id } });
    expect(agentOf(m, pg).guarding).toBe(agentOf(plain, pg).guarding);
  });
});

describe("a chosen double team", () => {
  /** The share of his time on the ball that the player had two defenders on him. */
  function pressure(tactics: Partial<TeamTactics>, target: Player) {
    let held = 0,
      doubled = 0;
    for (const seed of [9, 10, 11, 12]) {
      const m = make(tactics, seed);
      for (let i = 0; i < 15_000 && m.state.phase !== "final"; i++) {
        m.step(1 / 30);
        const h = m.handler();
        if (h?.player.id !== target.id) continue;
        held++;
        if (m.agentsOf(0).filter((d) => (d.pos.x - h.pos.x) ** 2 + (d.pos.z - h.pos.z) ** 2 < 2.2 ** 2).length >= 2) doubled++;
      }
    }
    return doubled / held;
  }

  it("sends help at the named player even if he isn't a star", () => {
    const target = rb.slice(0, 5).sort((x, y) => x.potential - y.potential)[0];
    expect(target.potential).toBeLessThan(88);
    expect(pressure({ doubleTarget: target.id }, target)).toBeGreaterThan(pressure({}, target) * 1.2);
  });
});
