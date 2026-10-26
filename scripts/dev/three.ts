import fs from "node:fs";
import { Match } from "../../src/game/sim/match";
import { generateRoster } from "../../src/engine/player";
import { inLane } from "../../src/game/court";
import type { Team } from "../../src/engine/types";
const data = JSON.parse(fs.readFileSync(`src/data/generated/pro.json`, "utf8")) as { teams: Team[] };
const h = data.teams[0], a = data.teams[3];
const m = new Match({ league: "pro", home: { team: h, roster: generateRoster(h) }, away: { team: a, roster: generateRoster(a) }, fast: true, seed: 11 });
const hist: string[][] = Array.from({ length: 10 }, () => []);
let shown = 0;
for (let i = 0; i < 60 * 60 * 40 && shown < 3; i++) {
  m.step(1 / 60);
  const s = m.state;
  for (const ag of s.agents) {
    const side = m.attackSide(ag.team);
    hist[ag.idx].push(`lt=${ag.laneTime.toFixed(1)} pos=${ag.pos.x.toFixed(1)},${ag.pos.z.toFixed(1)} in=${inLane(s.cfg.court, side, ag.pos.x, ag.pos.z)} int=${ag.intent.moveX.toFixed(2)},${ag.intent.moveZ.toFixed(2)} act=${ag.action.kind} ball=${s.ball.mode}/${s.ball.owner} ph=${s.phase}`);
    if (hist[ag.idx].length > 200) hist[ag.idx].shift();
  }
  for (const e of s.frameEvents) if (e.t === "violation" && e.kind === "threeSeconds" && e.player !== null) {
    shown++;
    const ag = s.agents[e.player];
    console.log(`=== 3sec ${ag.player.pos} role=${ag.role} owner=${s.ball.owner === e.player}`);
    console.log(hist[e.player].filter((_, k) => k % 15 === 0).join("\n"));
  }
}
