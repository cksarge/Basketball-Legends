// Things the player sees and hears that the sim drives: the dribble sits on the dribbling
// hand's side, and automatic replays only come after made baskets unless asked otherwise.
import { describe, expect, it } from "vitest";
import pro from "@/data/generated/pro.json";
import { Match } from "../sim/match";
import { generateRoster } from "@/engine/player";
import type { Team } from "@/engine/types";
import { ReplayDirector } from "@/game3d/replay";

function match(seed: number) {
  const teams = (pro as { teams: Team[] }).teams;
  const [h, a] = [teams[2], teams[7]];
  return new Match({ league: "pro", home: { team: h, roster: generateRoster(h) }, away: { team: a, roster: generateRoster(a) }, seed });
}

describe("presentation", () => {
  it("dribbles the ball on the dribble hand's side of the body", () => {
    const m = match(4);
    let checked = 0;
    for (let i = 0; i < 60 * 240 && checked < 200; i++) {
      m.step(1 / 60);
      const s = m.state;
      if (s.ball.mode !== "dribble" || s.ball.owner === null) continue;
      const h = s.agents[s.ball.owner];
      const dx = s.ball.phys.pos.x - h.pos.x,
        dz = s.ball.phys.pos.z - h.pos.z;
      // the body's right is -x in its own frame: (-cos f, sin f) in the world
      const right = -Math.cos(h.facing) * dx + Math.sin(h.facing) * dz;
      expect(Math.sign(right)).toBe(h.hand);
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("marks made-basket clips so default replays skip blocks and steals", () => {
    const m = match(8);
    const rp = new ReplayDirector(m);
    const kinds = { scoring: 0, other: 0 };
    for (let i = 0; i < 60 * 600; i++) {
      m.step(1 / 60);
      rp.observe(m.state.frameEvents);
      rp.record();
      if (m.state.phase === "final") break;
    }
    for (const c of rp.highlights) {
      if (c.scoring) {
        kinds.scoring++;
        expect(c.label).not.toMatch(/rejection|steal|ankles/);
      } else kinds.other++;
    }
    expect(kinds.scoring).toBeGreaterThan(0);
  });
});
