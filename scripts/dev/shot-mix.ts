// Dev harness: shot type mix and accuracy per type.   npx tsx scripts/dev/shot-mix.ts [games] [league]
import fs from "node:fs";
import { Match } from "../../src/game/sim/match";
import { generateRoster } from "../../src/engine/player";

const games = Number(process.argv[2] ?? 4);
const league = (process.argv[3] ?? "pro") as "pro" | "college" | "hs";
const teams = JSON.parse(fs.readFileSync(`src/data/generated/${league}.json`, "utf8")).teams;
const mix: Record<string, { a: number; m: number }> = {};
for (let g = 0; g < games; g++) {
  const [h, a] = [teams[g % teams.length], teams[(g + 7) % teams.length]];
  const m = new Match({ league, home: { team: h, roster: generateRoster(h) }, away: { team: a, roster: generateRoster(a) }, fast: true, seed: g + 3 });
  let n = 0;
  while (m.state.phase !== "final" && n < 60 * 60 * 200) {
    m.step(1 / 60);
    n++;
  }
  for (const e of m.state.events) {
    if (e.t === "shot") (mix[e.kind] ??= { a: 0, m: 0 }).a++;
    if (e.t === "make" && e.kind !== "freeThrow") (mix[e.kind] ??= { a: 0, m: 0 }).m++;
  }
}
for (const [k, v] of Object.entries(mix))
  console.log(`${k.padEnd(9)} ${(v.a / games / 2).toFixed(1).padStart(5)} per team  ${((v.m / v.a) * 100).toFixed(0)}%`);
