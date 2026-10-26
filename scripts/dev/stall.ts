import fs from "node:fs";
import { Match } from "../../src/game/sim/match";
import { generateRoster } from "../../src/engine/player";
import type { Team } from "../../src/engine/types";
const data = JSON.parse(fs.readFileSync(`src/data/generated/pro.json`, "utf8")) as { teams: Team[] };
const g = Number(process.argv[2] ?? 0);
const h = data.teams[(g * 7) % 30], a = data.teams[(g * 7 + 3) % 30];
const m = new Match({ league: "pro", home: { team: h, roster: generateRoster(h) }, away: { team: a, roster: generateRoster(a) }, fast: true, seed: g + 1 });
let lastKey = "", since = 0;
const oob: string[] = [];
for (let i = 0; i < 60 * 60 * 60; i++) {
  m.step(1 / 60);
  const s = m.state;
  for (const e of s.frameEvents) if (e.t === "violation" && e.kind === "outOfBounds" && oob.length < 6) {
    const p = e.player !== null ? s.agents[e.player] : null;
    oob.push(`${(i/60).toFixed(1)} ${s.phase} ball=${s.ball.phys.pos.x.toFixed(1)},${s.ball.phys.pos.z.toFixed(1)} p=${p ? p.pos.x.toFixed(1)+","+p.pos.z.toFixed(1)+" "+p.action.kind+" human="+p.human : "-"}`);
  }
  const key = `${s.phase}|${s.ball.mode}|${s.ball.owner}|${Math.floor(s.clock)}`;
  if (key === lastKey) since++; else { since = 0; lastKey = key; }
  if (since > 60 * 30) {
    console.log("STALL at", (i / 60).toFixed(1), key, "phaseTimer", s.phaseTimer.toFixed(2), "inbound", JSON.stringify(s.inbound), "ft", JSON.stringify(s.freeThrows));
    console.log("ball", JSON.stringify(s.ball.phys.pos), JSON.stringify(s.ball.phys.vel), "pass", JSON.stringify(s.ball.pass));
    for (const ag of s.agents) console.log(` ${ag.idx} t${ag.team} ${ag.player.pos} pos=${ag.pos.x.toFixed(1)},${ag.pos.z.toFixed(1)} y=${ag.y.toFixed(2)} act=${ag.action.kind}(${ag.action.t.toFixed(1)}/${ag.action.dur}) intent=${ag.intent.moveX.toFixed(2)},${ag.intent.moveZ.toFixed(2)} stun=${ag.stun.toFixed(1)}`);
    break;
  }
  if (s.phase === "final") { console.log("final", s.teams[0].score, s.teams[1].score); break; }
}
console.log(oob.join("\n"));
