import fs from "node:fs";
import { Match } from "../../src/game/sim/match";
import { generateRoster } from "../../src/engine/player";
import type { Team } from "../../src/engine/types";
const data = JSON.parse(fs.readFileSync(`src/data/generated/pro.json`, "utf8")) as { teams: Team[] };
const causes: Record<string, number> = {};
const three: Record<string, number> = {};
for (let g = 0; g < 3; g++) {
  const h = data.teams[(g * 7) % 30],
    a = data.teams[(g * 7 + 3) % 30];
  const m = new Match({ league: "pro", home: { team: h, roster: generateRoster(h) }, away: { team: a, roster: generateRoster(a) }, fast: true, seed: g + 1 });
  for (let i = 0; i < 60 * 60 * 60 && m.state.phase !== "final"; i++) {
    const before = m.state.phase;
    m.step(1 / 60);
    for (const e of m.state.frameEvents) {
      if (e.t === "violation" && e.kind === "outOfBounds") {
        const k = `${before}:${m.state.ball.looseCause ?? "held"}`;
        causes[k] = (causes[k] ?? 0) + 1;
      }
      if (e.t === "violation" && e.kind === "threeSeconds" && e.player !== null) {
        const ag = m.state.agents[e.player];
        const k = `${ag.player.pos}:${m.state.ball.owner === e.player ? "ball" : "off"}:${ag.role}`;
        three[k] = (three[k] ?? 0) + 1;
      }
    }
  }
}
console.log("OOB causes", causes);
console.log("3sec", three);
