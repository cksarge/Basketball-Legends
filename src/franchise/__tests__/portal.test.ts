import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { emptyLine } from "@/game/sim/stats";
import { Rng } from "@/engine/rng";
import type { Conference, Player, Team } from "@/engine/types";
import { nilAsk, nilBudget, nilRoom, promiseNil, retain, rollNil } from "../college/nil";
import { closePortal, openPortal, portalChance, portalRound } from "../college/portal";
import { recruitAction, returning } from "../college/recruiting";
import { simDay } from "../core/season";
import { createFranchise } from "../create";
import { commitFranchise, createFranchiseSave, loadFranchise, openFranchiseDb } from "../storage";
import type { Franchise } from "../types";

const data = JSON.parse(readFileSync("src/data/generated/college.json", "utf8")) as { teams: Team[]; conferences: Conference[] };
const teams = data.teams;
const d1 = teams.filter((t) => t.tier === "D1");
const byPrestige = [...d1].sort((a, b) => b.prestige - a.prestige);
const top = byPrestige[0];
const make = (team = top, seed = "portal") => createFranchise({ league: "college", team, teams, conferences: data.conferences, seed, now: 1 });
const base = make();
const isErr = (x: Franchise | { error: string }): x is { error: string } => "error" in x;
const ok = (x: Franchise | { error: string }) => {
  if (isErr(x)) throw new Error(x.error);
  return x;
};
/** Puts in a season line: minutes per game over 30 games. */
const withMinutes = (f: Franchise, id: string, perGame: number): Franchise => ({
  ...f,
  season: { ...f.season, stats: { ...f.season.stats, [id]: { ...emptyLine(), gp: 30, gs: 0, min: perGame * 60 * 30 } } },
});
const withPlayer = (f: Franchise, p: Player): Franchise => ({ ...f, players: { ...f.players, [p.id]: p } });
/** A player who'll be back next year, from the user's roster. */
const underclassman = (f: Franchise) => f.rosters[f.teamId].find((id) => f.players[id].file!.eligibility!.used < 2)!;
const chanceOf = (f: Franchise, id: string) => portalChance(f, f.players[id]);

beforeEach(() => {
  openFranchiseDb(`test-${Math.random()}`);
});

describe("NIL", () => {
  it("NIL budgets follow prestige and division", () => {
    const low = byPrestige.at(-1)!;
    expect(nilBudget(top, "D1")).toBeGreaterThan(nilBudget(low, "D1"));
    expect(nilBudget(top, "D1")).toBe(Math.round(400_000 + top.prestige ** 2 * 9_600_000));
    expect(nilBudget(top, "D2")).toBe(Math.round(nilBudget(top, "D1") * 0.08));
    expect(nilBudget(top, "D3")).toBe(Math.round(nilBudget(top, "D1") * 0.02));
    expect(base.college!.nil[top.id].next.budget).toBe(nilBudget(top, "D1"));
  });

  it("promises can't pass next season's budget, and pulling an offer frees its money", () => {
    // free the top program's scholarships, so it can offer
    const open: Franchise = {
      ...base,
      college: { ...base.college!, recruits: base.college!.recruits.map((x) => (x.committed === top.id ? { ...x, committed: undefined } : x)) },
    };
    const room = nilRoom(open, top.id);
    expect(room).toBeGreaterThan(0);
    const r = open.college!.recruits.find((x) => !x.committed && x.offers[top.id] === undefined)!;
    const offered = ok(recruitAction(open, r.id, "offer", teams, Math.min(room, 200_000)));
    expect(nilRoom(offered, top.id)).toBe(room - Math.min(room, 200_000));
    const pulled = ok(recruitAction(offered, r.id, "pullOffer", teams));
    expect(nilRoom(pulled, top.id)).toBe(room);
    const tooMuch = recruitAction(open, r.id, "offer", teams, room + 1);
    expect(isErr(tooMuch) && tooMuch.error).toMatch(/NIL/);
    const id = underclassman(base);
    expect(isErr(promiseNil(base, top.id, id, room + 1))).toBe(true);
  });

  it("camp rolls next season's deals into this season and opens a fresh budget", () => {
    const id = underclassman(base);
    const promised = ok(promiseNil(base, top.id, id, 50_000));
    const rolled = rollNil(promised, d1);
    expect(rolled.college!.nil[top.id].now.deals[id]).toBe(50_000);
    expect(rolled.college!.nil[top.id].now.budget).toBe(promised.college!.nil[top.id].next.budget);
    expect(rolled.college!.nil[top.id].next).toEqual({ budget: nilBudget(top, "D1"), deals: {} });
  });
});

describe("the transfer portal", () => {
  const id = underclassman(base);
  const p = base.players[id];
  const shape = (traits: Partial<Player["traits"]>) => withPlayer(base, { ...p, traits: { ...p.traits, ...traits } });

  it("bench players with talent, big egos and unmet asks enter the portal more often", () => {
    const calm = shape({ ego: 0.1, loyalty: 0.5 });
    const best = [...calm.rosters[top.id]].sort((a, b) => calm.players[b].potential - calm.players[a].potential)[0];
    expect(chanceOf(withMinutes(calm, best, 4), best)).toBeGreaterThan(chanceOf(withMinutes(calm, best, 30), best));
    expect(chanceOf(shape({ ego: 0.95, loyalty: 0.5 }), id)).toBeGreaterThan(chanceOf(calm, id));
  });

  it("loyal players and those whose ask is met stay more often", () => {
    expect(chanceOf(shape({ loyalty: 0.95 }), id)).toBeLessThan(chanceOf(shape({ loyalty: 0.05 }), id));
    const met = ok(retain(base, id, nilAsk(p, "D1")));
    expect(chanceOf(met, id)).toBeLessThan(chanceOf(base, id));
  });

  it("a coaching change sends more players into the portal", () => {
    const newCoach: Franchise = { ...base, job: { ...base.job, stints: [{ ...base.job.stints[0], from: base.season.year + 1 }] } };
    expect(chanceOf(newCoach, id)).toBeGreaterThan(chanceOf(base, id));
  });

  const opened = openPortal({ ...base, phase: "offseason" }, d1, new Rng("open"));

  it("opens with players from across the division, who leave their teams", () => {
    const entered = opened.college!.portal!.entered;
    expect(opened.college!.portal!.round).toBe(1);
    expect(entered.length).toBeGreaterThan(100);
    for (const x of entered) {
      expect(opened.players[x].teamId).toBeNull();
      expect(Object.values(opened.rosters).some((ids) => ids.includes(x))).toBe(false);
      const r = opened.college!.recruits.find((y) => y.id === x)!;
      expect(r).toMatchObject({ kind: "transfer" });
      expect(r.from).toBeDefined();
    }
  });

  it("portal players can be called, visited and offered like recruits", () => {
    const x = opened.college!.portal!.entered.find((e) => opened.college!.recruits.find((r) => r.id === e)!.from !== top.id)!;
    let f = ok(recruitAction(opened, x, "call", d1));
    f = ok(recruitAction(f, x, "homeVisit", d1));
    f = ok(recruitAction(f, x, "offer", d1, 0));
    const r = f.college!.recruits.find((y) => y.id === x)!;
    expect(r.interest[top.id]).toBeGreaterThan(0);
    expect(r.offers[top.id]).toBe(0);
  });

  it("after three rounds every portal player signs or leaves", () => {
    let f = opened;
    for (let i = 0; i < 3; i++) f = portalRound(f, d1, new Rng(`round${i}`));
    expect(f.college!.portal!.round).toBe(4);
    const entered = opened.college!.portal!.entered;
    const closed = closePortal(f, d1);
    expect(closed.college!.portal).toBeNull();
    expect(closed.college!.recruits.some((r) => r.kind === "transfer")).toBe(false);
    const landed = entered.filter((x) => closed.players[x]);
    expect(landed.length).toBeGreaterThan(0);
    for (const x of landed) {
      const team = closed.players[x].teamId!;
      expect(closed.rosters[team]).toContain(x);
    }
    for (const x of entered.filter((y) => !closed.players[y])) expect(Object.values(closed.rosters).some((ids) => ids.includes(x))).toBe(false);
    // seniors are still on rosters until they graduate, so the limit is on next season's players
    for (const [team, ids] of Object.entries(closed.rosters)) {
      const next = ids.filter((x) => returning(closed, x)).length + closed.college!.recruits.filter((x) => x.committed === team).length;
      expect(next, team).toBeLessThanOrEqual(15);
    }
  });

  it("a transfer keeps his eligibility and plays right away", () => {
    let f = opened;
    for (let i = 0; i < 3; i++) f = portalRound(f, d1, new Rng(`round${i}`));
    const closed = closePortal(f, d1);
    const x = opened.college!.portal!.entered.find((y) => closed.players[y])!;
    expect(closed.players[x].file!.eligibility).toEqual(base.players[x].file!.eligibility);
    // back in season, he's on the floor for his new team
    const team = closed.players[x].teamId!;
    const inSeason: Franchise = { ...closed, phase: "regular", teamId: team };
    const played = simDay(inSeason, teams, { includeUser: true });
    expect(played.franchise.rosters[team]).toContain(x);
  });

  it("the portal survives a reload mid-round and finishes the same way", async () => {
    let f = await createFranchiseSave(opened, top);
    f = await commitFranchise(portalRound(f, d1, new Rng("r0")), top);
    const reloaded = (await loadFranchise(f.id))!;
    const a = closePortal(portalRound(portalRound(reloaded, d1, new Rng("r1")), d1, new Rng("r2")), d1);
    const b = closePortal(portalRound(portalRound(portalRound(opened, d1, new Rng("r0")), d1, new Rng("r1")), d1, new Rng("r2")), d1);
    expect(a.rosters).toEqual(b.rosters);
    expect(a.college).toEqual(b.college);
  });
});
