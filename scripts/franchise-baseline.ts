/**
 * Measures what real engine pro games produce, so the franchise box-score simulator can be tuned against them.
 * Run with: npx tsx scripts/franchise-baseline.ts
 * Writes src/franchise/__tests__/engine-baseline.json.
 */
import fs from "node:fs";
import path from "node:path";
import { runMatchSync } from "../src/career/hs/play";
import pro from "../src/data/generated/pro.json";
import { generateRoster } from "../src/engine/player";
import type { Team } from "../src/engine/types";
import type { StatLine } from "../src/game/sim/stats";

const GAMES = 60;
const teams = (pro as unknown as { teams: Team[] }).teams;
const KEYS = ["pts", "fga", "fgm", "tpa", "tpm", "fta", "ftm", "oreb", "dreb", "ast", "stl", "blk", "tov", "pf"] as const;

const perTeam: Record<string, number[]> = Object.fromEntries(KEYS.map((k) => [k, []]));
const topScorer: number[] = [];
let homeWins = 0;

for (let i = 0; i < GAMES; i++) {
  const home = teams[(i * 7) % teams.length];
  const away = teams[(i * 11 + 3) % teams.length === (i * 7) % teams.length ? (i * 11 + 4) % teams.length : (i * 11 + 3) % teams.length];
  const m = runMatchSync({
    league: "pro",
    quarterMinutes: 12,
    seed: i + 1,
    home: { team: home, roster: generateRoster(home, i), controllers: [] },
    away: { team: away, roster: generateRoster(away, i + 100), controllers: [] },
  } as never);
  const s = m.state;
  if (s.teams[0].score > s.teams[1].score) homeWins++;
  for (const side of [0, 1]) {
    const lines = s.teams[side].roster.map((p) => s.box[p.id]).filter(Boolean) as StatLine[];
    for (const k of KEYS) perTeam[k].push(lines.reduce((sum, l) => sum + l[k], 0));
    topScorer.push(Math.max(...lines.map((l) => l.pts)));
  }
  if ((i + 1) % 10 === 0) console.log(`${i + 1}/${GAMES}`);
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => Math.sqrt(mean(a.map((x) => (x - mean(a)) ** 2)));
const round = (x: number) => Math.round(x * 100) / 100;
const out = {
  games: GAMES,
  perTeam: Object.fromEntries(KEYS.map((k) => [k, { mean: round(mean(perTeam[k])), sd: round(sd(perTeam[k])) }])),
  fgPct: round(mean(perTeam.fgm) / mean(perTeam.fga)),
  tpPct: round(mean(perTeam.tpm) / mean(perTeam.tpa)),
  ftPct: round(mean(perTeam.ftm) / mean(perTeam.fta)),
  topScorerPts: round(mean(topScorer)),
  homeWinRate: round(homeWins / GAMES),
};
fs.writeFileSync(path.join(__dirname, "..", "src", "franchise", "__tests__", "engine-baseline.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out));
