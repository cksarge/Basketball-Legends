import fs from "node:fs";
import { Match } from "../../src/game/sim/match";
import { generateRoster } from "../../src/engine/player";
import type { Team } from "../../src/engine/types";
const data = JSON.parse(fs.readFileSync(`src/data/generated/pro.json`, "utf8")) as { teams: Team[] };
const tos: Record<string, number> = {}; const durs: number[] = []; let ends: Record<string, number> = {};
for (let g = 0; g < 4; g++) {
  const h = data.teams[(g * 7) % 30], a = data.teams[(g * 7 + 3) % 30];
  const m = new Match({ league: "pro", home: { team: h, roster: generateRoster(h) }, away: { team: a, roster: generateRoster(a) }, fast: true, seed: g + 11 });
  let start = 0, off = m.state.offense; let liveTime = 0;
  for (let i = 0; i < 60 * 60 * 60 && m.state.phase !== "final"; i++) {
    m.step(1 / 60);
    const s = m.state;
    if (s.phase === "live") liveTime += 1 / 60;
    for (const e of s.frameEvents) {
      if (e.t === "turnover") tos[e.reason] = (tos[e.reason] ?? 0) + 1;
      if (e.t === "violation") tos["v:" + e.kind] = (tos["v:" + e.kind] ?? 0) + 1;
      if (["make", "miss", "turnover", "steal", "foul"].includes(e.t)) ends[e.t] = (ends[e.t] ?? 0) + 1;
    }
    if (s.offense !== off) { durs.push(liveTime - start); start = liveTime; off = s.offense; }
  }
}
durs.sort((x, y) => x - y);
console.log("turnovers/violations per game", Object.fromEntries(Object.entries(tos).map(([k, v]) => [k, (v / 4).toFixed(1)])));
console.log("possession live secs: median", durs[durs.length >> 1].toFixed(1), "p10", durs[Math.floor(durs.length * 0.1)].toFixed(1), "p90", durs[Math.floor(durs.length * 0.9)].toFixed(1));
console.log("events per game", Object.fromEntries(Object.entries(ends).map(([k, v]) => [k, (v / 4).toFixed(1)])));
