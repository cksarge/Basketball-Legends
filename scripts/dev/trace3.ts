import fs from "node:fs";
import { Match } from "../../src/game/sim/match";
import { generateRoster } from "../../src/engine/player";
import type { Team } from "../../src/engine/types";
const data = JSON.parse(fs.readFileSync(`src/data/generated/pro.json`, "utf8")) as { teams: Team[] };
const h = data.teams[0],
  a = data.teams[3];
const m = new Match({ league: "pro", home: { team: h, roster: generateRoster(h) }, away: { team: a, roster: generateRoster(a) }, fast: true, seed: 1 });
let watching = 0;
for (let i = 0; i < 60 * 130; i++) {
  m.step(1 / 60);
  const s = m.state;
  if (s.phase === "inbound" && s.ball.mode === "pass" && watching === 0) {
    watching = 40;
    const p = s.ball.pass!;
    console.log(
      `[${(i / 60).toFixed(2)}] inbound pass from ${p.from} to ${p.to} kind=${p.kind} target=${p.target.x.toFixed(1)},${p.target.z.toFixed(1)} recv=${s.agents[p.to]?.pos.x.toFixed(1)},${s.agents[p.to]?.pos.z.toFixed(1)} vel=${JSON.stringify(s.ball.phys.vel)}`,
    );
  }
  if (watching > 0) {
    watching--;
    if (watching % 8 === 0)
      console.log(
        `   ${s.phase} ${s.ball.mode} pos=${s.ball.phys.pos.x.toFixed(1)},${s.ball.phys.pos.y.toFixed(1)},${s.ball.phys.pos.z.toFixed(1)} vel=${s.ball.phys.vel.x.toFixed(1)},${s.ball.phys.vel.y.toFixed(1)},${s.ball.phys.vel.z.toFixed(1)}`,
      );
    if (s.phase !== "inbound") watching = 0;
  }
}
