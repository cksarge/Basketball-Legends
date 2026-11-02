/**
 * Measures how each coaching setting changes real engine pro games, so the box-score simulator can move the same way.
 * Run with: npx tsx scripts/franchise-tactics-baseline.ts
 * Writes src/franchise/__tests__/tactics-baseline.json: for each setting, each stat's change against the default.
 */
import fs from "node:fs";
import path from "node:path";
import { runMatchSync } from "../src/career/hs/play";
import pro from "../src/data/generated/pro.json";
import { generateRoster, teamTalentTarget } from "../src/engine/player";
import type { Team, TeamTactics } from "../src/engine/types";
import type { StatLine } from "../src/game/sim/stats";

const GAMES = 20;
const teams = [...(pro as unknown as { teams: Team[] }).teams].sort((a, b) => teamTalentTarget(a) - teamTalentTarget(b));
const [home, away] = [teams[14], teams[15]];
const rh = generateRoster(home, 1),
  ra = generateRoster(away, 2);
const KEYS = ["pts", "fga", "fgm", "tpa", "tpm", "fta", "oreb", "dreb", "ast", "stl", "tov"] as const;

const SETTINGS: Record<string, Partial<TeamTactics>> = {
  default: {},
  zone23: { defense: "zone23" },
  zone32: { defense: "zone32" },
  press: { defense: "press" },
  paceSlow: { pace: 0.1 },
  paceFast: { pace: 0.9 },
  threeLow: { threeRate: 0.1 },
  threeHigh: { threeRate: 0.9 },
  crashLow: { crashBoards: 0.1 },
  crashHigh: { crashBoards: 0.9 },
};

function measure(tactics: Partial<TeamTactics>) {
  const own = Object.fromEntries(KEYS.map((k) => [k, 0])) as Record<(typeof KEYS)[number], number>;
  const opp = { ...own };
  for (let i = 0; i < GAMES; i++) {
    const m = runMatchSync({ league: "pro", quarterMinutes: 12, seed: 500 + i, home: { team: home, roster: rh, tactics }, away: { team: away, roster: ra } });
    const s = m.state;
    const lines = (r: typeof rh) => r.map((p) => s.box[p.id]).filter(Boolean) as StatLine[];
    for (const k of KEYS) {
      own[k] += lines(rh).reduce((sum, l) => sum + l[k], 0) / GAMES;
      opp[k] += lines(ra).reduce((sum, l) => sum + l[k], 0) / GAMES;
    }
  }
  return { own, opp };
}

const base = measure({});
const change = (a: Record<string, number>, b: Record<string, number>) => Object.fromEntries(KEYS.map((k) => [k, Math.round((a[k] / b[k] - 1) * 1000) / 1000]));
const out: Record<string, unknown> = {};
for (const [name, t] of Object.entries(SETTINGS)) {
  if (name === "default") continue;
  const r = measure(t);
  out[name] = { own: change(r.own, base.own), opp: change(r.opp, base.opp) };
  console.log(name, JSON.stringify(out[name]));
}
fs.writeFileSync(path.join(__dirname, "..", "src", "franchise", "__tests__", "tactics-baseline.json"), `${JSON.stringify(out, null, 2)}\n`);
