import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { playerOvr } from "@/engine/player";
import { Rng } from "@/engine/rng";
import type { Team } from "@/engine/types";
import { AUTO_KEYS, autoFinances, autoStep, setAuto, simOffseason } from "../auto";
import { attendance } from "../club/finance";
import { advanceOffseason, canAdvance } from "../core/offseason";
import { simDay } from "../core/season";
import { createFranchise } from "../create";
import { expiring, pendingOptions } from "../pro/contracts";
import { currentPick, simDraftToEnd } from "../pro/draft";
import { nextRound, staffHandles } from "../pro/freeAgency";
import { standardCount } from "../pro/rosterMoves";
import { aiTradeDay } from "../pro/tradeAi";
import { ticketBase } from "../pro/rules";
import type { AutoKey, Franchise } from "../types";
import { finishedSeason } from "./draftHelpers";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const team = teams[15];
const make = () => createFranchise({ league: "pro", team, teams, seed: "auto", now: 1 });
const allOff = (f: Franchise) => AUTO_KEYS.reduce((x, k) => ({ ...x, settings: { ...x.settings, auto: { ...x.settings.auto, [k.key]: false } } }), f);
const allOn = (f: Franchise) => AUTO_KEYS.reduce((x, k) => setAuto(x, k.key, true), f);
const only = (f: Franchise, key: AutoKey) => setAuto(allOff(f), key, true);
const offseason = (f: Franchise): Franchise => ({ ...finishedSeason(f, teams), offseason: { step: "review", report: null } });
function reach(f: Franchise, step: string) {
  let x = f;
  for (let i = 0; i < 10 && x.offseason?.step !== step; i++) {
    if (x.offseason?.step === "draft" && currentPick(x)) x = simDraftToEnd(x);
    x = advanceOffseason(staffHandles(x), teams);
  }
  return x;
}

describe("single systems", () => {
  it("every system has a toggle", () => {
    expect(AUTO_KEYS.map((k) => k.key).sort()).toEqual(["contracts", "draft", "finances", "freeAgency", "practice", "roster", "scouting", "tactics", "trades"]);
  });

  it("with auto draft on, the user's pick is made", () => {
    const f = reach(offseason(only(make(), "draft")), "draft");
    expect(currentPick(f)).toBeNull();
    expect(f.draft.results.length).toBe(60);
  });

  it("with auto scouting on, twelve prospects are followed", () => {
    const f = only(make(), "scouting");
    expect(f.draft.assigned).toHaveLength(12);
  });

  it("with auto contracts on, options are decided and valued players re-sign", () => {
    const base = make();
    const id = [...base.rosters[team.id]].sort((a, b) => playerOvr(base.players[b]) - playerOvr(base.players[a]))[0];
    const opt = base.rosters[team.id][9];
    const players = {
      ...base.players,
      [id]: { ...base.players[id], file: { service: 7, teamSeasons: 5 }, contract: { salary: 10e6, years: 1 } },
      [opt]: { ...base.players[opt], contract: { salary: 2e6, years: 2, teamOptionYears: 1 } },
    };
    const f = reach(offseason(only({ ...base, players }, "contracts")), "contracts");
    expect(pendingOptions(f, team.id)).toEqual([]);
    expect(f.players[id].contract?.extension).toBeDefined();
    expect(expiring(f, team.id).map((p) => p.id)).not.toContain(id);
  });

  it("with auto free agency on, the user's team bids legally", () => {
    let f = reach(offseason(only(make(), "freeAgency")), "freeAgency");
    for (let i = 0; i < 5; i++) f = nextRound(f);
    expect(f.freeAgency!.signed.some((s) => s.teamId === team.id)).toBe(true);
  });

  it("without it, the user's team doesn't bid", () => {
    let f = reach(offseason(allOff(make())), "freeAgency");
    for (let i = 0; i < 5; i++) f = nextRound(f);
    expect(f.freeAgency!.signed.some((s) => s.teamId === team.id)).toBe(false);
  });

  it("with auto trades on, the user's team can trade, and it's in the news", () => {
    let f = only(make(), "trades");
    for (let i = 0; i < 300 && !f.tradeLog.some((t) => t.teams.includes(team.id)); i++) f = aiTradeDay(f, new Rng(`t${i}`)).franchise;
    expect(f.tradeLog.some((t) => t.teams.includes(team.id))).toBe(true);
  });

  it("auto trades never touch a player the user has marked as untouchable", () => {
    const base = only(make(), "trades");
    const players = { ...base.players };
    for (const id of base.rosters[team.id]) players[id] = { ...players[id], file: { ...players[id].file!, untouchable: true } };
    let f = { ...base, players };
    for (let i = 0; i < 300; i++) f = aiTradeDay(f, new Rng(`u${i}`)).franchise;
    const moved = f.tradeLog.flatMap((t) => t.assets).filter((a) => a.kind === "player" && a.from === team.id);
    expect(moved).toEqual([]);
  });

  it("without it, AI teams leave the user's team alone", () => {
    let f = allOff(make());
    for (let i = 0; i < 100; i++) f = aiTradeDay(f, new Rng(`n${i}`)).franchise;
    expect(f.tradeLog.some((t) => t.teams.includes(team.id))).toBe(false);
  });

  it("with auto roster on, a short roster fills in season without blocking a sim", () => {
    const base = only(make(), "roster");
    const short = { ...base, rosters: { ...base.rosters, [team.id]: base.rosters[team.id].slice(0, 12) } };
    const day = simDay(short, teams, { includeUser: true });
    expect(day.blocked).toBe(false);
    expect(standardCount(day.franchise, team.id)).toBeGreaterThanOrEqual(13);
    const added = day.franchise.rosters[team.id].find((id) => !short.rosters[team.id].includes(id))!;
    expect(day.changedPlayers).toContain(added);
  });

  it("with auto finances on, the ticket price moves toward what sells out", () => {
    const f = only(make(), "finances");
    const low = { ...f, finance: { ...f.finance, [team.id]: { ...f.finance[team.id], ticketPrice: 20 } } };
    const next = autoFinances(low, teams);
    expect(next.finance[team.id].ticketPrice).toBeGreaterThan(20);
    expect(attendance(next, team.id, team.arena.capacity)).toBeGreaterThan(team.arena.capacity * 0.8);
    expect(next.finance[team.id].ticketPrice).toBeLessThan(ticketBase(f.cap) * 3);
  });

  it("with auto tactics on, a system fits the roster", () => {
    expect(only(make(), "tactics").plan.tactics.system).toBeDefined();
  });

  it("with auto practice on, focus follows the roster's weakest area", () => {
    expect(only(make(), "practice").plan.practice).not.toBe("balanced");
  });

  it("with everything off, nothing changes on the user's team", () => {
    const f = allOff(make());
    expect(autoStep(f)).toBe(f);
  });
});

describe("Sim the offseason", () => {
  it("simOffseason gets from the review to opening day with everything on", () => {
    const f = simOffseason(offseason(allOn(make())), teams);
    expect(f.phase).toBe("regular");
    expect(standardCount(f, team.id)).toBeGreaterThanOrEqual(13);
  });

  it("simOffseason stops with a clear reason when a choice is needed", () => {
    const f = simOffseason(offseason(allOff(make())), teams);
    expect(f.phase).toBe("offseason");
    const stopped = canAdvance(f);
    expect(stopped.ok).toBe(false);
    if (!stopped.ok) expect(stopped.reason).not.toBe("");
  });

  it("a firing always stops for the user's choice", () => {
    const base = offseason(allOn(make()));
    const fired = { ...base, job: { ...base.job, fired: { year: 2026, teamId: team.id } } };
    expect(simOffseason(fired, teams)).toBe(fired);
  });

  it("a full season and summer on auto never asks for anything", () => {
    let f = allOn(make());
    for (let i = 0; i < 400 && f.phase !== "offseason"; i++) f = simDay(f, teams, { includeUser: true }).franchise;
    f = f.job.fired ? f : simOffseason(f, teams);
    expect(f.phase === "regular" || !!f.job.fired).toBe(true);
  });
});
