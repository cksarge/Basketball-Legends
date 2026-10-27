import fs from "node:fs";
import { Match } from "../../src/game/sim/match";
import { generateRoster } from "../../src/engine/player";
import type { Team } from "../../src/engine/types";
const data = JSON.parse(fs.readFileSync(`src/data/generated/pro.json`, "utf8")) as { teams: Team[] };
const h = data.teams[0],
  a = data.teams[3];
const m = new Match({ league: "pro", home: { team: h, roster: generateRoster(h) }, away: { team: a, roster: generateRoster(a) }, fast: true, seed: 11 });
const hist: string[] = [];
let shown = 0;
for (let i = 0; i < 60 * 60 * 40 && shown < 5; i++) {
  const s = m.state;
  const o = s.ball.owner !== null ? s.agents[s.ball.owner] : null;
  if (o) {
    hist.push(
      `${o.idx} pos=${o.pos.x.toFixed(2)},${o.pos.z.toFixed(2)} vel=${o.vel.x.toFixed(1)},${o.vel.z.toFixed(1)} act=${o.action.kind} int=${o.intent.moveX.toFixed(2)},${o.intent.moveZ.toFixed(2)} ph=${s.phase}`,
    );
    if (hist.length > 40) hist.shift();
  }
  m.step(1 / 60);
  for (const e of m.state.frameEvents)
    if (e.t === "turnover" && e.reason === "outOfBounds") {
      shown++;
      console.log("=== handler OOB");
      console.log(hist.filter((_, k) => k % 4 === 0).join("\n"));
    }
}
