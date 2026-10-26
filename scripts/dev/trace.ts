import fs from "node:fs";
import { Match } from "../../src/game/sim/match";
import { generateRoster } from "../../src/engine/player";
import type { Team } from "../../src/engine/types";
const data = JSON.parse(fs.readFileSync(`src/data/generated/pro.json`, "utf8")) as { teams: Team[] };
const h = data.teams[0], a = data.teams[3];
const m = new Match({ league: "pro", home: { team: h, roster: generateRoster(h) }, away: { team: a, roster: generateRoster(a) }, fast: true, seed: 1 });
let last = "";
for (let i = 0; i < 60 * 60 * 6; i++) {
  m.step(1 / 60);
  const s = m.state;
  const o = s.ball.owner !== null ? s.agents[s.ball.owner] : null;
  const line = `${s.phase} clock=${s.clock.toFixed(0)} sc=${s.shotClock.toFixed(0)} ball=${s.ball.mode} owner=${o ? o.idx + ":" + o.action.kind : "-"} bpos=${s.ball.phys.pos.x.toFixed(1)},${s.ball.phys.pos.y.toFixed(1)},${s.ball.phys.pos.z.toFixed(1)}`;
  const key = line.replace(/clock=\d+ sc=\d+ /, "").replace(/bpos=.*/, "");
  if (key !== last || i % 600 === 0) { console.log((i / 60).toFixed(1).padStart(6), line); last = key; }
  if (s.phase === "final") break;
}
for (const e of m.state.playByPlay.slice(0, 30)) console.log(e.clock.toFixed(0), e.text);
