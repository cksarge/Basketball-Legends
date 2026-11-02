// Whole seasons on autopilot. Three run every time; SOAK=1 runs 25 and writes the numbers per season.
import { appendFileSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { playerOvr } from "@/engine/player";
import type { Team } from "@/engine/types";
import { advanceOffseason } from "../core/offseason";
import { simDay } from "../core/season";
import { createFranchise } from "../create";
import { payroll } from "../pro/cap";
import { simDraftToEnd } from "../pro/draft";
import { staffHandles } from "../pro/freeAgency";
import { standardCount } from "../pro/rosterMoves";
import { TWO_WAY_MAX, capRules } from "../pro/rules";
import type { Franchise } from "../types";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const SEASONS = process.env.SOAK ? 25 : 3;
const LOG = process.env.SOAK_LOG;

const median = (n: number[]) => [...n].sort((a, b) => a - b)[Math.floor(n.length / 2)];
const mean = (n: number[]) => n.reduce((a, b) => a + b, 0) / n.length;
function topEight(f: Franchise, id: string) {
  return mean(
    f.rosters[id]
      .map((p) => playerOvr(f.players[p]))
      .sort((a, b) => b - a)
      .slice(0, 8),
  );
}
function rosterProblems(f: Franchise): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const claim = (id: string, where: string) => {
    if (seen.has(id)) out.push(`${id} is in two places (${where})`);
    seen.add(id);
    if (!f.players[id]) out.push(`${id} is missing (${where})`);
  };
  for (const t of teams) {
    const n = standardCount(f, t.id);
    if (n < 13 || n > 15) out.push(`${t.id} has ${n}`);
    if (f.rosters[t.id].filter((id) => f.players[id].contract?.twoWay).length > TWO_WAY_MAX) out.push(`${t.id} has too many two-way players`);
    for (const id of [...f.rosters[t.id], ...f.devRosters[t.id]]) {
      claim(id, t.id);
      if (f.players[id]?.teamId !== t.id) out.push(`${id} thinks he's elsewhere`);
      if (!f.players[id]?.contract) out.push(`${id} has no contract`);
    }
  }
  f.freeAgents.forEach((id) => claim(id, "free agents"));
  return out;
}
function measure(f: Franchise) {
  const eights = teams.map((t) => topEight(f, t.id));
  const pay = teams.map((t) => payroll(f, t.id));
  const r = capRules(f.cap);
  const all = Object.values(f.rosters)
    .flat()
    .map((id) => f.players[id]);
  return {
    year: f.season.year,
    top8: +mean(eights).toFixed(1),
    worst8: +Math.min(...eights).toFixed(1),
    best8: +Math.max(...eights).toFixed(1),
    over90: all.filter((p) => playerOvr(p) >= 90).length,
    over85: all.filter((p) => playerOvr(p) >= 85).length,
    age: median(all.map((p) => p.age)),
    pay: +(median(pay) / r.salaryCap).toFixed(2),
    apron2: pay.filter((x) => x > r.secondApron).length,
    fa: f.freeAgents.length,
    cap: Math.round(r.salaryCap / 1e6),
    trades: f.tradeLog.length,
  };
}
function season(f: Franchise) {
  let x = f;
  for (let i = 0; i < 400 && x.phase !== "offseason"; i++) x = simDay(x, teams, { includeUser: true }).franchise;
  return x;
}
function summer(f: Franchise) {
  let x = f;
  for (let i = 0; i < 12 && x.phase === "offseason"; i++) {
    if (x.offseason?.step === "draft") x = simDraftToEnd(x);
    x = advanceOffseason(staffHandles(x), teams);
  }
  return x;
}

describe("seasons on autopilot", () => {
  it(`runs ${SEASONS} seasons with a healthy league`, () => {
    let f = createFranchise({ league: "pro", team: teams[0], teams, seed: process.env.SOAK_SEED ?? "soak", now: 1 });
    const start = measure(f);
    const seasons = [];
    let trades = 0;
    for (let i = 0; i < SEASONS; i++) {
      f = summer(season(f));
      const m = { ...measure(f), trades: f.tradeLog.length - trades };
      trades = f.tradeLog.length;
      seasons.push(m);
      if (LOG) appendFileSync(LOG, JSON.stringify(m) + "\n");
      expect(rosterProblems(f)).toEqual([]);
    }
    // the whole run gets logged before anything is judged
    for (const m of seasons) {
      expect(Math.abs(m.top8 - start.top8)).toBeLessThanOrEqual(2.5);
      expect(m.over90).toBeGreaterThanOrEqual(3);
      expect(m.over90).toBeLessThanOrEqual(30);
      expect(m.pay).toBeGreaterThanOrEqual(0.85);
      expect(m.pay).toBeLessThanOrEqual(1.3);
      expect(m.apron2).toBeLessThan(6);
      expect(m.worst8).toBeGreaterThan(start.top8 - 10);
      expect(m.age).toBeGreaterThanOrEqual(24);
      expect(m.age).toBeLessThanOrEqual(29);
    }
  }, 1_800_000);
});
