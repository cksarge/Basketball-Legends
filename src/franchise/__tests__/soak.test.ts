import "fake-indexeddb/auto";
// Whole seasons on autopilot. Three run every time; SOAK=1 runs 50 and writes the numbers per season.
import { appendFileSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { playerOvr } from "@/engine/player";
import type { Team } from "@/engine/types";
import { jobOffers, takeJob } from "../club/jobs";
import { advanceOffseason } from "../core/offseason";
import { simDay } from "../core/season";
import { createFranchise } from "../create";
import { payroll } from "../pro/cap";
import { AUTO_KEYS, setAuto, simOffseason } from "../auto";
import { simDraftToEnd } from "../pro/draft";
import { staffHandles } from "../pro/freeAgency";
import { standardCount } from "../pro/rosterMoves";
import { TWO_WAY_MAX, capRules } from "../pro/rules";
import { commitFranchise, createFranchiseSave, exportFranchise, loadFranchise, openFranchiseDb, pastSeasons } from "../storage";
import type { Franchise } from "../types";

openFranchiseDb(`soak-${Math.random()}`);

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const SEASONS = process.env.SOAK ? 50 : 3;
/** auto: everything on. off: the user only presses Continue and lets the staff act. fired: off, and the owner loses patience. */
const MODE = (process.env.SOAK_MODE ?? "off") as "auto" | "off" | "fired";
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
    hall: f.hall.length,
    profit: median(teams.map((t) => f.finance[t.id].lastSeason?.profit ?? 0)) / (r.salaryCap / 140e6),
    losers: teams.filter((t) => (f.finance[t.id].lastSeason?.profit ?? 0) < 0).map((t) => t.id),
    rows: Object.keys(f.players).length,
    stints: f.job.stints.length,
  };
}
function season(f: Franchise) {
  let x = f;
  for (let i = 0; i < 400 && x.phase !== "offseason"; i++) x = simDay(x, teams, { includeUser: true }).franchise;
  return x;
}
function summer(f: Franchise) {
  let x = f;
  if (MODE === "auto" && !x.job.fired) x = simOffseason(x, teams);
  for (let i = 0; i < 12 && x.phase === "offseason"; i++) {
    if (x.offseason?.step === "draft") x = simDraftToEnd(x);
    if (x.job.fired) x = takeJob(x, jobOffers(x, teams)[0], teams);
    x = advanceOffseason(staffHandles(x), teams);
  }
  return x;
}

describe("seasons on autopilot", () => {
  it(`runs ${SEASONS} seasons with a healthy league`, () => {
    let f = createFranchise({ league: "pro", team: teams[0], teams, seed: process.env.SOAK_SEED ?? "soak", now: 1 });
    if (MODE === "auto") f = AUTO_KEYS.reduce((x, k) => setAuto(x, k.key, true), f);
    const start = measure(f);
    const seasons: (ReturnType<typeof measure> & { trades: number })[] = [];
    let trades = 0;
    const caps = [f.cap.salaryCap];
    for (let i = 0; i < SEASONS; i++) {
      // an owner who's out of patience every ten years
      if (MODE === "fired" && i % 10 === 9)
        f = { ...f, job: { ...f.job, security: 1, seasons: 3, goals: f.job.goals.map((g) => ({ ...g, target: g.target + 1e12 })) } };
      f = summer(season(f));
      expect(f.phase).toBe("regular");
      caps.push(f.cap.salaryCap);
      const m = { ...measure(f), trades: f.tradeLog.length - trades };
      trades = f.tradeLog.length;
      seasons.push(m);
      if (LOG) appendFileSync(LOG, JSON.stringify(m) + "\n");
      expect(rosterProblems(f)).toEqual([]);
    }
    // the Hall takes one to three a year once careers have had time to finish
    if (SEASONS >= 25) {
      expect(f.hall.length).toBeGreaterThanOrEqual(10 * (SEASONS / 50));
      expect(f.hall.length).toBeLessThanOrEqual(150 * (SEASONS / 50));
    }
    // money: a typical club profits, nobody loses every year, and the cap rises a little each year
    for (let i = 1; i < caps.length; i++) {
      expect(caps[i] / caps[i - 1]).toBeGreaterThanOrEqual(1.019);
      expect(caps[i] / caps[i - 1]).toBeLessThanOrEqual(1.081);
    }
    const everyYear = teams.filter((t) => seasons.length > 2 && seasons.every((m) => m.losers.includes(t.id)));
    expect(everyYear).toEqual([]);
    if (MODE === "fired" && SEASONS >= 25) expect(f.job.stints.length).toBeGreaterThan(1);
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
      expect(m.profit).toBeGreaterThan(-30e6);
      expect(m.profit).toBeLessThan(80e6);
      expect(m.rows).toBeLessThan(800);
    }
  }, 1_800_000);
});

describe("a save after many seasons", () => {
  it.skipIf(!process.env.SOAK)(
    "stays under the size limit, sims fast and reloads to the same league",
    async () => {
      let f = createFranchise({ league: "pro", team: teams[0], teams, seed: "size", now: 1 });
      await createFranchiseSave(f, teams[0]);
      for (let i = 0; i < 50; i++) {
        f = summer(season(f));
        f = await commitFranchise(f, teams[0]);
      }
      const text = exportFranchise(f, await pastSeasons(f.id));
      expect(text.length).toBeLessThan(40e6);
      const t0 = performance.now();
      const next = season(f);
      expect(performance.now() - t0).toBeLessThan(60_000);
      const back = (await loadFranchise(f.id))!;
      expect(season(back).season.championId).toBe(next.season.championId);
    },
    1_800_000,
  );
});
