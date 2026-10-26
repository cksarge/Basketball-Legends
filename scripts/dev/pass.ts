import fs from "node:fs";
import { Match } from "../../src/game/sim/match";
import { generateRoster } from "../../src/engine/player";
import type { Team } from "../../src/engine/types";
const data = JSON.parse(fs.readFileSync(`src/data/generated/pro.json`, "utf8")) as { teams: Team[] };
const h = data.teams[0], a = data.teams[3];
const m = new Match({ league: "pro", home: { team: h, roster: generateRoster(h) }, away: { team: a, roster: generateRoster(a) }, fast: true, seed: 1 });
let shown = 0, cur: { to: number; minD: number; frames: string[] } | null = null;
for (let i = 0; i < 60 * 60 * 30 && shown < 4; i++) {
  m.step(1 / 60);
  const s = m.state;
  if (s.ball.mode === "pass" && s.ball.pass && s.ball.pass.to >= 0) {
    const r = s.agents[s.ball.pass.to]; const b = s.ball.phys;
    const d = Math.hypot(r.pos.x - b.pos.x, r.pos.z - b.pos.z);
    if (!cur) cur = { to: r.idx, minD: 99, frames: [] };
    cur.minD = Math.min(cur.minD, d);
    cur.frames.push(`t=${s.ball.pass.t.toFixed(2)}/${s.ball.pass.dur.toFixed(2)} d=${d.toFixed(2)} by=${b.pos.y.toFixed(2)} r=${r.pos.x.toFixed(1)},${r.pos.z.toFixed(1)} act=${r.action.kind} human=${r.human} intent=${r.intent.moveX.toFixed(2)},${r.intent.moveZ.toFixed(2)} kind=${s.ball.pass.kind}`);
  } else if (cur) {
    if (s.ball.mode === "loose") { shown++; console.log(`--- uncaught pass (${s.phase}) cause=${s.ball.looseCause} owner=${s.ball.owner} minD ${cur.minD.toFixed(2)} events=${s.frameEvents.map(e=>e.t).join(",")}`); console.log(cur.frames.filter((_, k) => k % 3 === 0).join("\n")); }
    cur = null;
  }
}
