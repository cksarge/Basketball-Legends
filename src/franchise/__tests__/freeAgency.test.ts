import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addDays, iso } from "@/career/calendar";
import { playerOvr } from "@/engine/player";
import type { Team } from "@/engine/types";
import { advanceOffseason, startNewSeason } from "../core/offseason";
import { simDay } from "../core/season";
import { createFranchise } from "../create";
import { payroll } from "../pro/cap";
import { simDraftToEnd } from "../pro/draft";
import { BIDDING_ROUNDS, aiResign, nextRound, placeBid, roundBar, signNow, staffHandles, weeklyMarket, withdrawBid } from "../pro/freeAgency";
import { askingPrice, marketValue } from "../pro/market";
import { standardCount } from "../pro/rosterMoves";
import { capRules } from "../pro/rules";
import type { Franchise } from "../types";
import { setPayroll } from "./capHelpers";
import { finishedSeason } from "./draftHelpers";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const me = teams[3].id;
function reach(f: Franchise, step: string) {
  let x = f;
  while (x.offseason?.step !== step) {
    if (x.offseason?.step === "draft") x = simDraftToEnd(x);
    if (x.offseason?.step === "contracts") x = staffHandles(x);
    x = advanceOffseason(x, teams);
  }
  return x;
}
const start = () => {
  const f = finishedSeason(createFranchise({ league: "pro", team: teams[3], teams, seed: "fa", now: 1 }), teams);
  return { ...f, offseason: { step: "review" as const, report: null } };
};
const open = reach(start(), "freeAgency");
const year = open.season.year + 1;
/** The best free agents the user has no rights to. */
const best = (f: Franchise) =>
  f.freeAgents.filter((id) => f.players[id].file?.rightsTeamId !== me).sort((a, b) => marketValue(f, f.players[b]) - marketValue(f, f.players[a]));
const allRounds = (f: Franchise) => {
  let x = f;
  while (x.freeAgency?.stage !== "open") x = nextRound(x);
  return x;
};
/** Gives the user cap room. */
const room = (f: Franchise) => setPayroll(f, me, 90e6);
const bid = (f: Franchise, id: string, salary?: number, years = 3) => {
  const r = placeBid(f, id, { teamId: me, salary: salary ?? askingPrice(f, f.players[id], me).salary, years });
  if (!r.ok) throw new Error(r.reason);
  return r.franchise;
};

describe("the market", () => {
  it("opens with a moratorium on July 1, with expired players in the pool", () => {
    expect(open.freeAgency?.stage).toBe("moratorium");
    expect(open.date).toBe(iso(year, 7, 1));
    expect(open.freeAgents.length).toBeGreaterThan(30);
  });

  it("nothing signs during the moratorium", () => {
    const id = best(open)[0];
    const r = signNow(room(open), id, { teamId: me, salary: 30e6, years: 3 });
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/moratorium/i) });
    expect(open.freeAgency!.signed).toEqual([]);
  });

  it("five rounds run on their dates, then the market stays open", () => {
    let f = open;
    const dates: string[] = [];
    for (let i = 0; i < BIDDING_ROUNDS; i++) {
      expect(f.freeAgency?.stage).not.toBe("open");
      f = nextRound(f);
      dates.push(f.date);
    }
    expect(dates).toEqual([6, 8, 10, 12, 14].map((d) => iso(year, 7, d)));
    expect(f.freeAgency?.stage).toBe("open");
    expect(f.freeAgency!.signed.length).toBeGreaterThan(10);
    expect(nextRound(f)).toBe(f);
  });

  it("a player gets less picky each round", () => {
    expect(roundBar(1)).toBeCloseTo(0.9);
    expect(roundBar(BIDDING_ROUNDS)).toBeCloseTo(0.62);
    const f = room(open);
    const id = best(f)[0];
    const ask = askingPrice(f, f.players[id], me);
    const one = nextRound(bid(f, id, ask.salary * 0.75, ask.years));
    const signed = allRounds(open).freeAgency!.signed;
    expect(one.players[id].teamId).not.toBe(me);
    expect(new Set(signed.map((s) => s.round)).size).toBeGreaterThan(2);
  });

  it("nobody signs twice, and every signing uses the cap path it reported", () => {
    const f = allRounds(open);
    const ids = f.freeAgency!.signed.map((s) => s.playerId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of f.freeAgency!.signed) {
      expect(f.players[s.playerId].teamId).toBe(s.teamId);
      expect(f.rosters[s.teamId]).toContain(s.playerId);
      expect(f.freeAgents).not.toContain(s.playerId);
      expect(s.via).toBeTruthy();
      if (s.via === "minimum") expect(s.salary).toBeLessThanOrEqual(capRules(f.cap).minSalary);
    }
  });
});

describe("the user's bids", () => {
  it("the user wins a player only by winning his decision", () => {
    const f = room(open);
    const id = best(f)[0];
    const won = allRounds(bid(f, id, capRules(f.cap).maxSalary(f.players[id].file!.service), 4));
    expect(won.players[id].teamId).toBe(me);
    const low = allRounds(bid(f, id, capRules(f.cap).minSalary, 1));
    expect(low.players[id].teamId).not.toBe(me);
  });

  it("the user's pending bids can't add up past what the team can pay", () => {
    let f = setPayroll(open, me, 110e6);
    const ids = best(f);
    const salary = 15e6;
    f = bid(f, ids[0], salary);
    f = bid(f, ids[1], salary);
    const third = placeBid(f, ids[2], { teamId: me, salary: 15e6, years: 3 });
    expect(third).toEqual({ ok: false, reason: expect.stringMatching(/most/) });
  });

  it("a bid made illegal by an earlier signing is dropped with a reason", () => {
    let f = setPayroll(open, me, 110e6);
    const ids = best(f);
    f = bid(f, ids[1], 26e6, 3);
    const later = setPayroll(f, me, 135e6);
    const after = nextRound(later);
    expect(after.freeAgency!.bids.filter((b) => b.teamId === me)).toEqual([]);
    expect(after.freeAgency!.notices.join(" ")).toMatch(/dropped|can't/i);
    expect(after.players[ids[1]].teamId).not.toBe(me);
  });

  it("a bid can be withdrawn", () => {
    const f = room(open);
    const id = best(f)[0];
    const g = withdrawBid(bid(f, id), id);
    expect(g.freeAgency!.bids.filter((b) => b.teamId === me)).toEqual([]);
  });

  it("the user's team keeps veteran rights through the rounds", () => {
    const f = { ...open };
    const id = f.freeAgents.find((x) => f.players[x].file?.rightsTeamId && f.players[x].file!.teamSeasons >= 3)!;
    const own = f.players[id].file!.rightsTeamId!;
    const mine = { ...f, teamId: own };
    const capped = setPayroll(mine, own, 170e6);
    const r = placeBid(capped, id, { teamId: own, salary: askingPrice(capped, capped.players[id], own).salary, years: 2 });
    expect(r.ok).toBe(true);
  });
});

describe("AI teams", () => {
  it("AI teams re-sign most of the players they value before the market opens", () => {
    const f = open;
    const kept = Object.values(f.players).filter((p) => p.file?.teamSeasons && p.contract && p.contract.years >= 1 && playerOvr(p) >= 85 && p.teamId);
    expect(kept.length).toBeGreaterThan(30);
    const stars = f.freeAgents.filter((id) => playerOvr(f.players[id]) >= 88).length;
    expect(stars).toBeLessThan(12);
  });

  it("aiResign never touches the user's own expired players", () => {
    const id = open.freeAgents.find((x) => open.players[x].file?.rightsTeamId === me);
    if (id) expect(aiResign(open).players[id].teamId).toBeNull();
  });

  it("every AI team ends camp with 13 to 15 players and stays legal", () => {
    const camp = reach(open, "camp");
    const season = startNewSeason(staffHandles(camp), teams);
    for (const t of teams) {
      const n = standardCount(season, t.id);
      expect(n).toBeGreaterThanOrEqual(13);
      expect(n).toBeLessThanOrEqual(15);
      expect(payroll(season, t.id)).toBeGreaterThan(0);
    }
    expect(season.waivers).toEqual([]);
    expect(season.freeAgency).toBeUndefined();
  });

  it("an unsigned player's ask falls through the season, and AI teams fill injury gaps", () => {
    const season = startNewSeason(staffHandles(reach(open, "camp")), teams);
    const id = best(season)[0];
    const p = season.players[id];
    const offer = { teamId: me, salary: capRules(season.cap).minSalary * 1.5, years: 1 };
    const room2 = setPayroll(season, me, 90e6);
    const short = { ...room2, rosters: { ...room2.rosters, [me]: room2.rosters[me].slice(0, 14) } };
    const ask = askingPrice(short, p, me);
    const low = { ...offer, salary: ask.salary * 0.6, years: ask.years };
    const early = signNow(short, id, low);
    const late = signNow({ ...short, date: addDays(short.date, 110) }, id, low);
    expect(early.ok).toBe(false);
    expect(late.ok).toBe(true);
    const other = teams[6].id;
    const thin = { ...season, rosters: { ...season.rosters, [other]: season.rosters[other].slice(0, 12) } };
    expect(standardCount(weeklyMarket(thin).franchise, other)).toBeGreaterThanOrEqual(13);
  });

  it("signing in season needs a roster spot", () => {
    const season = startNewSeason(staffHandles(reach(open, "camp")), teams);
    const full = setPayroll(season, me, 90e6);
    const room2 = { ...full, rosters: { ...full.rosters } };
    while (standardCount(room2, me) < 15) room2.rosters[me] = [...room2.rosters[me], room2.freeAgents[0]];
    const id = best(room2).at(-1)!;
    const r = signNow(room2, id, { teamId: me, salary: 30e6, years: 1 });
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/roster/i) });
  });

  it("a whole season of weekly market work adds under 5 seconds", () => {
    let f = startNewSeason(staffHandles(reach(open, "camp")), teams);
    const t = performance.now();
    for (let i = 0; i < 26; i++) f = weeklyMarket(f).franchise;
    expect(performance.now() - t).toBeLessThan(5000);
  });

  it("simDay runs the market", () => {
    const f = startNewSeason(staffHandles(reach(open, "camp")), teams);
    const other = teams[6].id;
    let g = { ...f, rosters: { ...f.rosters, [other]: f.rosters[other].slice(0, 12) } };
    const end = addDays(f.date, 8);
    while (g.date < end) g = simDay(g, teams, { includeUser: true }).franchise;
    expect(standardCount(g, other)).toBeGreaterThanOrEqual(13);
  });
});
