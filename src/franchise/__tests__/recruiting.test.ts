import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { playerOvr } from "@/engine/player";
import { Rng } from "@/engine/rng";
import type { Conference, Team } from "@/engine/types";
import {
  COSTS,
  MAX_OFFICIAL_VISITS,
  classRank,
  earlySigning,
  earlySigningDate,
  fit,
  openScholarships,
  recruitAction,
  resolveWeek,
  signingDay,
  weeklyPoints,
} from "../college/recruiting";
import { simDay } from "../core/season";
import { createFranchise } from "../create";
import { leagueModule } from "../leagues";
import { shownOvr } from "../pro/scouting";
import { commitFranchise, createFranchiseSave, loadFranchise, openFranchiseDb } from "../storage";
import type { Franchise, Recruit } from "../types";

const data = JSON.parse(readFileSync("src/data/generated/college.json", "utf8")) as { teams: Team[]; conferences: Conference[] };
const teams = data.teams;
const d1 = teams.filter((t) => t.tier === "D1");
const d3 = teams.filter((t) => t.tier === "D3");
const top = [...d1].sort((a, b) => b.prestige - a.prestige)[0];
const make = (team = top, seed = "recruit") => createFranchise({ league: "college", team, teams, conferences: data.conferences, seed, now: 1 });
const base = make();
const recruitsOf = (f: Franchise) => f.college!.recruits;
const get = (f: Franchise, id: string) => recruitsOf(f).find((r) => r.id === id)!;
const isErr = (x: Franchise | { error: string }): x is { error: string } => "error" in x;
const act = (f: Franchise, id: string, action: Parameters<typeof recruitAction>[2], nil?: number) => {
  const r = recruitAction(f, id, action, teams, nil);
  if (isErr(r)) throw new Error(r.error);
  return r;
};
/** A recruit nobody has touched yet, from the bottom of the class. */
const fresh = (f: Franchise, n = 0) => recruitsOf(f).filter((r) => r.kind === "hs" && !r.committed && Object.keys(r.interest).length === 0)[n];
const withRecruit = (f: Franchise, r: Recruit): Franchise => ({
  ...f,
  college: { ...f.college!, recruits: recruitsOf(f).map((x) => (x.id === r.id ? r : x)) },
});
function simDays(f: Franchise, days: number) {
  for (let i = 0; i < days; i++) f = simDay(f, teams, { includeUser: true }).franchise;
  return f;
}

beforeEach(() => {
  openFranchiseDb(`test-${Math.random()}`);
});

describe("recruiting", () => {
  it("a class has about 4.2 recruits per program with the star bands by rank", () => {
    const list = recruitsOf(base).filter((r) => r.kind === "hs");
    expect(list.length).toBe(Math.round(4.2 * d1.length));
    const ranked = [...list].sort((a, b) => a.rank - b.rank);
    const n = list.length;
    expect(ranked.slice(0, Math.round(n * 0.02)).every((r) => r.stars === 5)).toBe(true);
    expect(ranked.filter((r) => r.stars === 5)).toHaveLength(Math.round(n * 0.02));
    expect(ranked.filter((r) => r.stars === 4)).toHaveLength(Math.round(n * 0.2) - Math.round(n * 0.02));
    expect(ranked.filter((r) => r.stars === 3)).toHaveLength(Math.round(n * 0.6) - Math.round(n * 0.2));
    expect(base.college!.classYear).toBe(base.season.year + 1);
    for (const r of list) expect(r.wants).toHaveLength(3);
  });

  it("five-star recruits are the best by true potential, give or take", () => {
    const mean = (stars: number) => {
      const xs = recruitsOf(base).filter((r) => r.stars === stars);
      return xs.reduce((s, r) => s + r.player!.potential, 0) / xs.length;
    };
    expect(mean(5)).toBeGreaterThan(mean(4));
    expect(mean(4)).toBeGreaterThan(mean(3));
    expect(mean(3)).toBeGreaterThan(mean(2));
  });

  it("points follow prestige and the assistant, and don't carry over", () => {
    const low = [...d1].sort((a, b) => a.prestige - b.prestige)[0];
    expect(weeklyPoints(base, top.id, top)).toBeGreaterThan(weeklyPoints(base, low.id, low));
    const better = { ...base, plan: { ...base.plan, staff: [{ id: "a", role: "assistant" as const, name: "A", rating: 95, salary: 1 }] } };
    const worse = { ...base, plan: { ...base.plan, staff: [{ id: "a", role: "assistant" as const, name: "A", rating: 50, salary: 1 }] } };
    expect(weeklyPoints(better, top.id, top)).toBeGreaterThan(weeklyPoints(worse, top.id, top));
    expect(base.college!.points[top.id]).toBe(weeklyPoints(base, top.id, top));
    const week = simDays(base, 8);
    expect(week.college!.points[top.id]).toBe(weeklyPoints(week, top.id, top));
  });

  it("each action costs its points and is refused with a reason when points run out", () => {
    const r = fresh(base);
    const called = act(base, r.id, "call");
    expect(called.college!.points[top.id]).toBe(base.college!.points[top.id] - COSTS.call);
    expect(get(called, r.id).interest[top.id]).toBeGreaterThan(0);
    const scouted = act(called, r.id, "scout");
    expect(scouted.college!.points[top.id]).toBe(called.college!.points[top.id] - COSTS.scout);
    const broke = { ...base, college: { ...base.college!, points: { ...base.college!.points, [top.id]: 3 } } };
    const refused = recruitAction(broke, r.id, "call", teams);
    expect(isErr(refused) && refused.error).toMatch(/points/);
  });

  it("home and official visits happen once per recruit, and a recruit takes 5 official visits at most", () => {
    const r = fresh(base);
    const once = act(base, r.id, "homeVisit");
    expect(isErr(recruitAction(once, r.id, "homeVisit", teams))).toBe(true);
    const official = act(once, r.id, "officialVisit");
    expect(isErr(recruitAction(official, r.id, "officialVisit", teams))).toBe(true);
    const busy = withRecruit(base, { ...r, officialVisits: d1.slice(1, 1 + MAX_OFFICIAL_VISITS).map((t) => t.id) });
    const full = recruitAction(busy, r.id, "officialVisit", teams);
    expect(isErr(full) && full.error).toMatch(/official visits/);
  });

  it("an offer needs an open scholarship, and Division III offers need a roster spot", () => {
    expect(openScholarships(base, top.id)).toBeGreaterThan(0);
    const r = fresh(base);
    const offered = act(base, r.id, "offer");
    expect(get(offered, r.id).offers[top.id]).toBe(0);
    // fill every open scholarship with commitments
    const open = openScholarships(base, top.id);
    const others = recruitsOf(base)
      .filter((x) => !x.committed && x.id !== r.id)
      .slice(0, open);
    let full = base;
    for (const x of others) full = withRecruit(full, { ...x, committed: top.id });
    expect(openScholarships(full, top.id)).toBe(0);
    const refused = recruitAction(full, r.id, "offer", teams);
    expect(isErr(refused) && refused.error).toMatch(/scholarship/);
    const small = make(d3[0], "d3");
    const spots = openScholarships(small, d3[0].id);
    const roster = small.rosters[d3[0].id].filter((id) => small.players[id].file!.eligibility!.used < 3).length;
    const committed = recruitsOf(small).filter((x) => x.committed === d3[0].id).length;
    expect(spots).toBe(Math.max(0, 15 - roster - committed));
  });

  it("fit rewards what the recruit wants most", () => {
    const r = fresh(base);
    const nilFirst: Recruit = { ...r, wants: ["nil", "distance", "coach"], offers: { [top.id]: r.nilAsk } };
    const nilLast: Recruit = { ...r, wants: ["distance", "coach", "nil"], offers: { [top.id]: r.nilAsk } };
    expect(fit(base, nilFirst, top)).toBeGreaterThan(fit(base, nilLast, top));
    for (const x of [nilFirst, nilLast]) {
      expect(fit(base, x, top)).toBeGreaterThanOrEqual(0.5);
      expect(fit(base, x, top)).toBeLessThanOrEqual(1.5);
    }
  });

  it("a recruit commits only to a program that offered, at 120 interest with a 25% lead", () => {
    const r = fresh(base);
    const [a, b] = [d1[10].id, d1[11].id];
    const rng = () => new Rng("commit");
    const noOffer = withRecruit(base, { ...r, interest: { [a]: 200, [b]: 50 } });
    expect(get(resolveWeek(noOffer, rng()), r.id).committed).toBeUndefined();
    const close = withRecruit(base, { ...r, interest: { [a]: 140, [b]: 120 }, offers: { [a]: 0 } });
    expect(get(resolveWeek(close, rng()), r.id).committed).toBeUndefined();
    const low = withRecruit(base, { ...r, interest: { [a]: 110 }, offers: { [a]: 0 } });
    expect(get(resolveWeek(low, rng()), r.id).committed).toBeUndefined();
    const ready = withRecruit(base, { ...r, interest: { [a]: 150, [b]: 119 }, offers: { [a]: 0 } });
    expect(get(resolveWeek(ready, rng()), r.id).committed).toBe(a);
  });

  it("a commitment can flip before signing, but not after the early signing date", () => {
    const r = fresh(base);
    const [a, b] = [d1[10].id, d1[11].id];
    const shaky = withRecruit(base, { ...r, committed: a, interest: { [a]: 130, [b]: 400 }, offers: { [a]: 0, [b]: 0 } });
    let flipped = false;
    for (let i = 0; i < 80 && !flipped; i++) flipped = get(resolveWeek(shaky, new Rng(`flip${i}`)), r.id).committed === b;
    expect(flipped).toBe(true);
    const signed = earlySigning(shaky);
    expect(get(signed, r.id).signed).toBe(true);
    for (let i = 0; i < 40; i++) expect(get(resolveWeek(signed, new Rng(`flip${i}`)), r.id).committed).toBe(a);
    expect(earlySigningDate(2026)).toBe("2026-11-11");
  });

  it("signing day puts every commitment on its team, and leftovers take their best offer with room", () => {
    const [r, s] = [fresh(base, 0), fresh(base, 1)];
    const [a, b] = [d1[10].id, d1[11].id];
    let f = withRecruit(base, { ...r, committed: a, interest: { [a]: 130 }, offers: { [a]: 0 } });
    f = withRecruit(f, { ...s, interest: { [a]: 20, [b]: 60 }, offers: { [a]: 0, [b]: 0 } });
    const done = signingDay(f, d1);
    expect(get(done, r.id)).toMatchObject({ committed: a, signed: true });
    expect(get(done, s.id)).toMatchObject({ committed: b, signed: true });
    expect(recruitsOf(done).every((x) => x.signed || !x.committed)).toBe(true);
    // recruits with no offer leave the class
    expect(recruitsOf(done).filter((x) => !x.signed)).toHaveLength(0);
  });

  it("no program signs more than its scholarships", () => {
    let f = base;
    const last = leagueModule("college").calendar(f.season.year).lastGame;
    for (let i = 0; i < 160 && f.date <= last; i++) f = simDay(f, teams, { includeUser: true }).franchise;
    const done = signingDay(f, d1);
    for (const t of d1) {
      const signed = recruitsOf(done).filter((x) => x.committed === t.id && x.signed).length;
      expect(signed, t.id).toBeLessThanOrEqual(openScholarships({ ...done, college: { ...done.college!, recruits: [] } }, t.id));
    }
  });

  it("AI programs land classes that match their prestige over a season", () => {
    let f = base;
    const last = leagueModule("college").calendar(f.season.year).lastGame;
    for (let i = 0; i < 160 && f.date <= last; i++) f = simDay(f, teams, { includeUser: true }).franchise;
    const sorted = [...d1].sort((a, b) => b.prestige - a.prestige);
    const avgRank = (xs: Team[]) => xs.reduce((s, t) => s + classRank(f, t.id), 0) / xs.length;
    expect(avgRank(sorted.slice(0, 40))).toBeLessThan(avgRank(sorted.slice(-40)) - 100);
    const stars = (xs: Team[]) => recruitsOf(f).filter((r) => r.stars >= 4 && xs.some((t) => t.id === r.committed)).length;
    expect(stars(sorted.slice(0, 40))).toBeGreaterThan(stars(sorted.slice(-40)) * 3);
  });

  it("scouting narrows a recruit's range, and the true rating shows once he plays", () => {
    const r = recruitsOf(base).find((x) => x.stars === 2 && !x.committed)!;
    const width = (x: Recruit) => x.player!.file!.range!.ovr[1] - x.player!.file!.range!.ovr[0];
    const before = width(r);
    const once = act(base, r.id, "scout");
    const twice = act({ ...once, college: { ...once.college!, points: base.college!.points } }, r.id, "scout");
    expect(width(get(once, r.id))).toBeLessThan(before);
    expect(width(get(twice, r.id))).toBeLessThanOrEqual(width(get(once, r.id)));
    const ovr = playerOvr(r.player!);
    const range = get(twice, r.id).player!.file!.range!.ovr;
    expect(ovr).toBeGreaterThanOrEqual(range[0]);
    expect(ovr).toBeLessThanOrEqual(range[1]);
    expect(shownOvr(r.player!)).toMatch(/-/);
    // on a roster, he plays and the range goes
    const id = base.rosters[top.id][0];
    const joined = { ...base, players: { ...base.players, [id]: { ...base.players[id], file: { ...base.players[id].file!, range: r.player!.file!.range } } } };
    const played = simDays(joined, 12);
    if (played.season.stats[id]?.gp) expect(played.players[id].file?.range).toBeUndefined();
  });

  it("the class rank orders programs by their signed and committed stars", () => {
    const list = recruitsOf(base).filter((r) => !r.committed);
    const fives = list.filter((r) => r.stars === 5).slice(0, 2);
    const twos = list.filter((r) => r.stars === 2).slice(0, 2);
    const [a, b] = [d1[200].id, d1[201].id];
    let f: Franchise = { ...base, college: { ...base.college!, recruits: recruitsOf(base).map((r) => ({ ...r, committed: undefined, signed: false })) } };
    for (const r of fives) f = withRecruit(f, { ...get(f, r.id), committed: a });
    for (const r of twos) f = withRecruit(f, { ...get(f, r.id), committed: b });
    expect(classRank(f, a)).toBe(1);
    expect(classRank(f, b)).toBe(2);
  });

  it("recruiting state survives a partial commit and reload, and the next week matches", async () => {
    const team = top;
    let f = await createFranchiseSave(base, team);
    let kept = base;
    const r = fresh(base);
    f = await commitFranchise(act(f, r.id, "call"), team, []);
    kept = act(kept, r.id, "call");
    for (let i = 0; i < 10; i++) {
      const step = simDay(f, teams, { includeUser: true });
      f = await commitFranchise(step.franchise, team, step.changedPlayers);
      kept = simDay(kept, teams, { includeUser: true }).franchise;
      if (i === 3) f = (await loadFranchise(f.id))!;
    }
    const reloaded = (await loadFranchise(f.id))!;
    expect(reloaded.college).toEqual(kept.college);
  });

  it("a week of Division I recruiting adds under 2 seconds", () => {
    const m = leagueModule("college");
    const start = Date.now();
    m.weekly(base, d1, base.date);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
