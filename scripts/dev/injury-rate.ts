// Dev harness: how often do in-game injuries happen?   npx tsx scripts/dev/injury-rate.ts [games] [league]
import fs from "node:fs";
import { Match } from "../../src/game/sim/match";
import { generateRoster } from "../../src/engine/player";
import type { Team } from "../../src/engine/types";

const games = Number(process.argv[2] ?? 20);
const league = (process.argv[3] ?? "pro") as "pro" | "college" | "hs";
const data = JSON.parse(fs.readFileSync(`src/data/generated/${league}.json`, "utf8")) as { teams: Team[] };
let total = 0, stuck = 0;
const names: Record<string, number> = {};
for (let g = 0; g < games; g++) {
  const h = data.teams[(g * 5) % data.teams.length], a = data.teams[(g * 5 + 2) % data.teams.length];
  const m = new Match({ league, home: { team: h, roster: generateRoster(h) }, away: { team: a, roster: generateRoster(a) }, fast: true, seed: 100 + g, injuries: true });
  let steps = 0;
  while (m.state.phase !== "final" && steps < 60 * 60 * 200) { m.step(1 / 60); steps++; }
  total += m.state.injuries.length;
  for (const i of m.state.injuries) {
    names[i.name] = (names[i.name] ?? 0) + 1;
    if (m.state.agents.some((ag) => ag.player.id === i.playerId)) stuck++;
  }
}
console.log(`${total} injuries in ${games} games (${(total / games).toFixed(2)}/game); still on court at the end: ${stuck}`);
console.log(names);
