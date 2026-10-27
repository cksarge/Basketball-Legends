// Dev harness: what the officials do over a game.   npx tsx scripts/dev/referee-trace.ts [seed]
import fs from "node:fs";
import { Match } from "../../src/game/sim/match";
import { generateRoster } from "../../src/engine/player";

const seed = Number(process.argv[2] ?? 9);
const teams = JSON.parse(fs.readFileSync("src/data/generated/pro.json", "utf8")).teams;
const m = new Match({ league: "pro", home: { team: teams[0], roster: generateRoster(teams[0]) }, away: { team: teams[1], roster: generateRoster(teams[1]) }, seed, quarterMinutes: 3 });
const seen = new Map<string, number>();
let handoffs = 0, inBase = 0, minDist = 99;
const board = m.state.cfg.court.halfL - m.state.cfg.court.boardFromBaseline;
const inside = (x: number, z: number) => Math.abs(x) > board + 0.85 && Math.abs(x) < board + 2.55 && Math.abs(z) < 0.68;
for (let i = 0; i < 60 * 60 * 6 && m.state.phase !== "final"; i++) {
  m.step(1 / 60);
  const s = m.state;
  for (const r of s.crew!.refs) {
    if (r.signal !== "none") seen.set(r.signal, (seen.get(r.signal) ?? 0) + 1);
    if (inside(r.pos.x, r.pos.z)) inBase++;
    for (const a of s.agents) minDist = Math.min(minDist, Math.hypot(a.pos.x - r.pos.x, a.pos.z - r.pos.z));
  }
  for (const a of s.agents) if (inside(a.pos.x, a.pos.z)) inBase++;
  if (s.crew!.handoff && s.crew!.handoff.t <= 1 / 60 + 1e-6) handoffs++;
}
console.log("signal frames:", Object.fromEntries(seen));
console.log(`inbound hand-offs ${handoffs}, frames inside a hoop base ${inBase}, closest official to a player ${minDist.toFixed(2)} m`);
