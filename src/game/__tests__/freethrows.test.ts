import { describe, expect, it } from "vitest";
import pro from "@/data/generated/pro.json";
import { Match } from "../sim/match";
import { generateRoster } from "@/engine/player";
import type { Team } from "@/engine/types";
import type { AgentIntent } from "../sim/state";

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

/** Put the human's agent on the line for two shots. */
function sendHumanToLine(m: Match) {
  const s = m.state;
  const shooter = s.agents.find((x) => x.human === 0)!;
  const def = s.agents.find((x) => x.team === 1)!;
  s.phase = "live";
  m.foul(def, shooter, "shooting", true, 2);
  expect(s.phase).toBe("freethrows");
  return shooter;
}

const idle = (): AgentIntent => ({ moveX: 0, moveZ: 0, sprint: false });

describe("human free throws", () => {
  it("a press during the routine is remembered and the shots resolve", () => {
    const m = humanMatch();
    const shooter = sendHumanToLine(m);
    const s = m.state;
    let pressed = 0;
    for (let i = 0; i < 60 * 20 && s.phase === "freethrows"; i++) {
      const it = idle();
      // press shortly after each attempt is set up (during the lineup), release ~0.7 s later
      const t = i % 240;
      if (t === 20) {
        it.act = { type: "shoot", phase: "press" };
        pressed++;
      }
      if (t === 62) it.act = { type: "shoot", phase: "release" };
      m.step(1 / 60, [it]);
    }
    expect(pressed).toBeGreaterThan(0);
    expect(s.phase).not.toBe("freethrows");
    expect(s.box[shooter.player.id].fta).toBe(2);
  });

  it("never freezes if the player doesn't press anything", () => {
    const m = humanMatch(7);
    const shooter = sendHumanToLine(m);
    const s = m.state;
    for (let i = 0; i < 60 * 40 && s.phase === "freethrows"; i++) m.step(1 / 60, [idle()]);
    expect(s.phase).not.toBe("freethrows");
    expect(s.box[shooter.player.id].fta).toBe(2);
  });
});

describe("watchdog", () => {
  it("full AI games never stall", () => {
    for (const seed of [1, 2, 3]) {
      const [h, a] = [teams[seed], teams[seed + 10]];
      const m = new Match({
        league: "pro",
        home: { team: h, roster: generateRoster(h) },
        away: { team: a, roster: generateRoster(a) },
        seed,
        fast: true,
        quarterMinutes: 4,
      });
      for (let i = 0; i < 60 * 60 * 60 && m.state.phase !== "final"; i++) m.step(1 / 60);
      expect(m.state.phase).toBe("final");
      expect(m.watchdogTrips).toBe(0);
    }
  });
});
