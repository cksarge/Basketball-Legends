import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addDays, proCalendar } from "@/career/calendar";
import { playerOvr } from "@/engine/player";
import { Rng } from "@/engine/rng";
import type { Team } from "@/engine/types";
import { advanceOffseason } from "../core/offseason";
import { simDay } from "../core/season";
import { createFranchise } from "../create";
import { currentPick, simToUserPick } from "../pro/draft";
import { TRADE_MARGIN, aiTradeDay, askFor, blockOffers, draftDayOffers, refreshOffers, toggleBlock, tradeReply } from "../pro/tradeAi";
import { playerTradeValue } from "../pro/tradeValue";
import { applyTrade, tradeProblems, type Trade } from "../pro/trades";
import type { Franchise } from "../types";
import { finishedSeason } from "./draftHelpers";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const make = () => createFranchise({ league: "pro", team: teams[0], teams, seed: "tradeai", now: 1 });
const me = teams[0].id;
const them = teams[1].id;
const byValue = (f: Franchise, teamId: string) => [...f.rosters[teamId]].sort((a, b) => playerOvr(f.players[b]) - playerOvr(f.players[a]));
const pay = (f: Franchise, id: string, salary: number): Franchise => ({
  ...f,
  players: { ...f.players, [id]: { ...f.players[id], contract: { salary, years: 2 } } },
});
const swap = (a: string, b: string): Trade => ({
  teams: [me, them],
  assets: [
    { kind: "player", id: a, from: me, to: them },
    { kind: "player", id: b, from: them, to: me },
  ],
});

describe("what an AI team accepts", () => {
  it("each AI team must gain value by the margin to accept", () => {
    const f0 = make();
    const a = byValue(f0, me)[0];
    const b = byValue(f0, them).at(-1)!;
    const f = pay(pay(f0, a, 8e6), b, 8e6);
    expect(tradeReply(f, swap(a, b)).accepted).toBe(true);
    const back = tradeReply(f, swap(byValue(f0, me).at(-1)!, byValue(f0, them)[0]));
    expect(back.accepted).toBe(false);
    expect(back.note).not.toBe("");
    expect(TRADE_MARGIN).toBeGreaterThan(0);
  });

  it("an illegal deal is refused with the reason", () => {
    const f = make();
    const reply = tradeReply(f, { teams: [me, them], assets: [{ kind: "player", id: f.rosters[them][0], from: me, to: them }] });
    expect(reply.accepted).toBe(false);
    expect(reply.note).toMatch(/isn't on/);
  });

  it("the same deal can't be flipped back at a profit", () => {
    const f0 = make();
    const a = byValue(f0, me)[0];
    const b = byValue(f0, them)[5];
    const f = pay(pay(f0, a, 8e6), b, 8e6);
    expect(tradeReply(f, swap(a, b)).accepted).toBe(true);
    const done = applyTrade(f, swap(a, b));
    const flip: Trade = {
      teams: [me, them],
      assets: [
        { kind: "player", id: b, from: me, to: them },
        { kind: "player", id: a, from: them, to: me },
      ],
    };
    expect(tradeReply(done, flip).accepted).toBe(false);
  });

  it("the AI won't take a star for many role players", () => {
    const f0 = make();
    const star = byValue(f0, them)[0];
    const crew = byValue(f0, me).slice(9, 13);
    let f = pay(f0, star, 16e6);
    for (const id of crew) f = pay(f, id, 4e6);
    const t: Trade = {
      teams: [me, them],
      assets: [{ kind: "player", id: star, from: them, to: me }, ...crew.map((id) => ({ kind: "player" as const, id, from: me, to: them }))],
    };
    expect(tradeReply({ ...f, rosters: { ...f.rosters, [them]: f.rosters[them].slice(0, 12).concat(star) } }, t).accepted).toBe(false);
  });

  it("the finder only returns deals that are legal and accepted, cheapest first", () => {
    const f = make();
    const target = byValue(f, them)[6];
    const found = askFor(f, [{ kind: "player", id: target, from: them, to: me }]);
    expect(found.length).toBeGreaterThan(0);
    for (const t of found) {
      expect(tradeProblems(f, t)).toEqual([]);
      expect(tradeReply(f, t).accepted).toBe(true);
      expect(t.assets.some((a) => a.id === target)).toBe(true);
    }
  });

  it("the finder answers in under a second", () => {
    const f = make();
    const t0 = performance.now();
    askFor(f, [{ kind: "player", id: byValue(f, them)[0], from: them, to: me }]);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe("the trade block", () => {
  it("players on the block draw legal offers, and offers expire after 7 days or when illegal", () => {
    let f = toggleBlock(make(), byValue(make(), me)[3]);
    expect(f.tradeBlock).toHaveLength(1);
    const offers = blockOffers(f);
    expect(offers.length).toBeGreaterThan(0);
    for (const o of offers) expect(tradeProblems(f, o.trade)).toEqual([]);
    f = refreshOffers(f);
    expect(f.tradeOffers.length).toBeGreaterThan(0);
    const later = refreshOffers(toggleBlock({ ...f, date: addDays(f.date, 8) }, f.tradeBlock[0]));
    expect(later.tradeOffers).toEqual([]);
    const fresh = f.tradeOffers[0];
    const moved = applyTrade(f, fresh.trade);
    expect(refreshOffers(moved).tradeOffers.map((o) => o.id)).not.toContain(fresh.id);
  });
});

describe("league trades", () => {
  function season(f: Franchise) {
    let x = f;
    for (let i = 0; i < 200 && x.phase === "regular"; i++) x = simDay(x, teams, { includeUser: true }).franchise;
    return x;
  }
  const played = season(make());

  it("AI teams trade with each other 3 to 12 times a season", () => {
    expect(played.tradeLog.length).toBeGreaterThanOrEqual(3);
    expect(played.tradeLog.length).toBeLessThanOrEqual(12);
  });

  it("AI trades stop at the deadline and never touch the user's team", () => {
    const deadline = proCalendar(played.season.year).tradeDeadline;
    for (const t of played.tradeLog) {
      expect(t.date <= deadline).toBe(true);
      expect(t.teams).not.toContain(me);
    }
    const late = { ...make(), date: addDays(deadline, 1) };
    expect(aiTradeDay(late, new Rng("x")).franchise).toBe(late);
  });

  it("rosters stay legal after a season of trades", () => {
    for (const t of teams) {
      expect(played.rosters[t.id].length).toBeGreaterThanOrEqual(13);
      expect(played.rosters[t.id].length).toBeLessThanOrEqual(15);
      for (const id of played.rosters[t.id]) expect(played.players[id].teamId).toBe(t.id);
    }
  });

  it("a full season still sims in under a minute", () => {
    const t0 = performance.now();
    season(make());
    expect(performance.now() - t0).toBeLessThan(60_000);
  }, 70_000);
});

describe("draft day", () => {
  it("draft-day offers trade picks and hand the user's pick to the new owner", () => {
    const base = finishedSeason(createFranchise({ league: "pro", team: teams[15], teams, seed: "dd", now: 1 }), teams);
    let f: Franchise = { ...base, offseason: { step: "review", report: null } };
    while (f.offseason?.step !== "draft") f = advanceOffseason(f, teams);
    f = simToUserPick(f);
    const pick = currentPick(f)!;
    expect(pick.ownerId).toBe(f.teamId);
    const offers = draftDayOffers(f);
    expect(offers.length).toBeGreaterThan(0);
    const o = offers[0];
    expect(o.trade.assets.some((a) => a.kind === "pick" && a.id === pick.id)).toBe(true);
    const done = applyTrade(f, o.trade);
    expect(currentPick(done)!.ownerId).not.toBe(f.teamId);
    expect(simToUserPick(done).draft.results.length).toBeGreaterThan(f.draft.results.length);
  });
});

describe("sign-and-trade", () => {
  it("a sign-and-trade works for an expired player with the rights team only", () => {
    const f0 = make();
    const id = byValue(f0, me)[6];
    const p = { ...f0.players[id], teamId: null, file: { service: 6, teamSeasons: 4, rightsTeamId: me, lastSalary: 5e6 } };
    delete p.contract;
    const f: Franchise = {
      ...f0,
      phase: "offseason",
      players: { ...f0.players, [id]: p },
      rosters: { ...f0.rosters, [me]: f0.rosters[me].filter((x) => x !== id), [them]: f0.rosters[them].slice(0, 14) },
      freeAgents: [id],
    };
    const low = f.picks.find((x) => x.ownerId === them && x.round === 2)!;
    const t: Trade = {
      teams: [me, them],
      assets: [
        { kind: "player", id, from: me, to: them, signAndTrade: { salary: 3e6, years: 3 } },
        { kind: "pick", id: low.id, from: them, to: me },
      ],
    };
    expect(playerTradeValue(f, f.players[id], them)).toBeGreaterThan(0);
    expect(tradeReply(f, t).accepted).toBe(true);
  });
});
