import fs from "node:fs";
import { Match } from "../../src/game/sim/match";
import { generateRoster } from "../../src/engine/player";
import type { Team } from "../../src/engine/types";
const data = JSON.parse(fs.readFileSync(`src/data/generated/pro.json`, "utf8")) as { teams: Team[] };
const h = data.teams[0],
  a = data.teams[3];
const m = new Match({ league: "pro", home: { team: h, roster: generateRoster(h) }, away: { team: a, roster: generateRoster(a) }, fast: true, seed: 1 });
let n = 0,
  prevPhase = "";
for (let i = 0; i < 60 * 60 * 12 && n < 14; i++) {
  const before = { phase: m.state.phase, mode: m.state.ball.mode, owner: m.state.ball.owner };
  m.step(1 / 60);
  const s = m.state;
  for (const e of s.frameEvents) {
    if (e.t === "violation") {
      n++;
      const p = e.player !== null ? s.agents[e.player] : null;
      console.log(
        `[${(i / 60).toFixed(1)}] ${e.kind} team=${e.team} before=${JSON.stringify(before)} player=${p ? `${p.idx} pos=${p.pos.x.toFixed(1)},${p.pos.z.toFixed(1)} act=${p.action.kind}` : "-"} ball=${s.ball.phys.pos.x.toFixed(1)},${s.ball.phys.pos.y.toFixed(1)},${s.ball.phys.pos.z.toFixed(1)} lastTouch=${s.ball.lastTouch}`,
      );
    }
  }
  if (s.phase !== prevPhase && i > 60 * 60 * 5) {
    prevPhase = s.phase;
  }
}
console.log("final phase", m.state.phase, "clock", m.state.clock.toFixed(1), "mode", m.state.ball.mode, "owner", m.state.ball.owner, m.state.inbound);
