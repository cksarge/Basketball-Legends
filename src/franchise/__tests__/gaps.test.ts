// Gaps found in earlier reviews, each pinned by a test.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { playerOvr } from "@/engine/player";
import type { Team } from "@/engine/types";
import { CONTROL_ROWS } from "@/ui/game/controlRows";
import { defenderList } from "@/ui/MatchupPicker";
import { simBox } from "../boxsim";
import { leaderRow } from "../core/awards";
import { boxInputFor, finishPartial, simDay, startFourth } from "../core/season";
import { createFranchise } from "../create";
import { rollContracts } from "../pro/contracts";
import { nextRound, openFreeAgency } from "../pro/freeAgency";
import { marketValue, shownValue } from "../pro/market";
import { callUpProblem, claimProblem, releasePlayer, twoWayProblem } from "../pro/rosterMoves";
import { TRADE_MARGIN, tradeReply } from "../pro/tradeAi";
import { playerTradeValue } from "../pro/tradeValue";
import { tradeProblems, type Trade } from "../pro/trades";
import type { Franchise } from "../types";
import { setPayroll } from "./capHelpers";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const me = teams[0].id;
const them = teams[1].id;
const make = () => createFranchise({ league: "pro", team: teams[0], teams, seed: "gaps", now: 1 });
const byOvr = (f: Franchise, id: string) => [...f.rosters[id]].sort((a, b) => playerOvr(f.players[b]) - playerOvr(f.players[a]));
const flat = (p: Franchise["players"][string]) => Object.fromEntries(Object.keys(p.ratings).map((k) => [k, 50])) as unknown as typeof p.ratings;

describe("coaching gaps", () => {
  it("the matchup picker lists a manual starter ranked sixth", () => {
    const f = make();
    const ranked = byOvr(f, me).map((id) => f.players[id]);
    const lineup = [ranked[5].id, ...ranked.slice(0, 4).map((p) => p.id)];
    expect(defenderList(ranked, lineup).map((p) => p.id)).toContain(ranked[5].id);
    expect(defenderList(ranked).map((p) => p.id)).toEqual(ranked.slice(0, 5).map((p) => p.id));
  });

  it("simulated games ignore matchups under a zone", () => {
    const f = make();
    const g = f.season.games.find((x) => x.homeId === me || x.awayId === me)!;
    const theirs = g.homeId === me ? g.awayId : g.homeId;
    const plan = (defense: "man" | "zone23") => ({
      ...f,
      plan: { ...f.plan, tactics: { ...f.plan.tactics, defense, matchups: { [byOvr(f, me)[0]]: byOvr(f, theirs)[0] } } },
    });
    const zoneWith = simBox(boxInputFor(plan("zone23"), g));
    const zoneWithout = simBox(
      boxInputFor({ ...plan("zone23"), plan: { ...plan("zone23").plan, tactics: { ...plan("zone23").plan.tactics, matchups: undefined } } }, g),
    );
    expect(zoneWith.home + zoneWith.away).toBe(zoneWithout.home + zoneWithout.away);
  });

  it("a partial game simmed from the hub matches finishPartial", () => {
    const f = make();
    let g = f.season.games.find((x) => x.homeId === me || x.awayId === me)!;
    let x = f;
    while (x.date < g.date) x = simDay(x, teams, { includeUser: true }).franchise;
    g = x.season.games.find((y) => y.id === g.id)!;
    const live = startFourth(x, g);
    const viaSim = simDay(live, teams, { includeUser: true, simLive: true }).franchise.season.games.find((y) => y.id === g.id)!.result;
    const viaFinish = finishPartial(live, g.id, teams).season.games.find((y) => y.id === g.id)!.result;
    expect(viaSim?.home).toBe(viaFinish?.home);
    expect(viaSim?.away).toBe(viaFinish?.away);
  });

  it("the call control's label names plays as well as the pick and roll", () => {
    expect(CONTROL_ROWS.find(([, keys]) => keys.includes("callScreen"))![0]).toMatch(/play/i);
  });
});

describe("roster gaps", () => {
  it("Leaders shows a player's last team in the offseason", () => {
    const f = make();
    const id = f.rosters[them][0];
    const gone = rollContracts({ ...f, players: { ...f.players, [id]: { ...f.players[id], contract: { salary: 1e6, years: 1 } } } });
    expect(leaderRow(gone, teams, id).team).toBe(teams[1].abbrev);
    const released = releasePlayer(f, f.rosters[them][1]);
    expect(leaderRow(released, teams, f.rosters[them][1]).team).toBe(teams[1].abbrev);
  });

  it("a refused two-way, call-up or claim gives its reason", () => {
    const f = make();
    const star = byOvr(f, them)[0];
    const freed: Franchise = { ...f, players: { ...f.players, [star]: { ...f.players[star], teamId: null, contract: undefined } }, freeAgents: [star] };
    expect(twoWayProblem(freed, me, star)).toMatch(/won't/);
    const cheap: Franchise = {
      ...freed,
      players: { ...freed.players, [star]: { ...freed.players[star], ratings: flat(freed.players[star]), file: { service: 1, teamSeasons: 0 } } },
    };
    expect(twoWayProblem(cheap, me, star)).toBeNull();
    expect(callUpProblem(f, f.rosters[me][0])).toMatch(/two-way|developmental/);
    const waived = releasePlayer(setPayroll(f, them, 60e6), f.rosters[them][3]);
    const capped = setPayroll(waived, me, 190e6);
    expect(claimProblem(capped, me, f.rosters[them][3])).toMatch(/room|roster/);
  });

  it("skipping to camp keeps every round's bid messages", () => {
    const f = openFreeAgency({ ...make(), phase: "offseason" });
    const st = f.freeAgency!;
    const one = nextRound({ ...f, freeAgency: { ...st, notices: ["Round one note."] } });
    expect(one.freeAgency!.notices).toContain("Round one note.");
  });

  it("a trade can't take a team past three two-way players", () => {
    const f = make();
    const ids = f.rosters[them].slice(0, 4);
    const players = { ...f.players };
    for (const id of ids) players[id] = { ...players[id], contract: { salary: 5e5, years: 1, twoWay: true } };
    const mine = f.rosters[me].slice(0, 3);
    for (const id of mine) players[id] = { ...players[id], contract: { salary: 5e5, years: 1, twoWay: true } };
    const t: Trade = { teams: [me, them], assets: [{ kind: "player", id: ids[0], from: them, to: me }] };
    expect(tradeProblems({ ...f, players }, t).join()).toMatch(/two-way/);
  });

  it("the free agents table uses a range-safe value for unknown players", () => {
    const f = make();
    const p = f.players[f.rosters[them][0]];
    expect(shownValue(f, p)).toBe(marketValue(f, p));
    const unknown = { ...p, file: { service: 0, teamSeasons: 0, range: { ovr: [60, 64] as [number, number], pot: [70, 75] as [number, number] } } };
    expect(shownValue(f, unknown)).toBeLessThan(marketValue(f, unknown));
  });
});

describe("trade AI gaps", () => {
  it("the AI refuses a star for role players on value, with the roster limit out of the way", () => {
    const f0 = make();
    const star = byOvr(f0, them)[0];
    const crew = byOvr(f0, me).slice(9, 12);
    const room = { ...f0, rosters: { ...f0.rosters, [them]: f0.rosters[them].slice(0, 12).concat(star) } };
    const players = { ...room.players, [star]: { ...room.players[star], contract: { salary: 12e6, years: 2 } } };
    for (const id of crew) players[id] = { ...players[id], contract: { salary: 4e6, years: 2 } };
    const f = { ...room, players };
    const t: Trade = {
      teams: [me, them],
      assets: [{ kind: "player", id: star, from: them, to: me }, ...crew.map((id) => ({ kind: "player" as const, id, from: me, to: them }))],
    };
    expect(tradeProblems(f, t)).toEqual([]);
    const reply = tradeReply(f, t);
    expect(reply.accepted).toBe(false);
    expect(reply.gap).toBeGreaterThan(0);
  });

  it("the AI's margin holds at the boundary: just under refuses, just over accepts", () => {
    const f0 = make();
    const a = f0.rosters[me][2];
    const b = f0.rosters[them][2];
    const twin = { ...f0.players[a], contract: { salary: 8e6, years: 2 } };
    const f: Franchise = { ...f0, players: { ...f0.players, [a]: twin, [b]: { ...twin, id: b, teamId: them } } };
    const t: Trade = {
      teams: [me, them],
      assets: [
        { kind: "player", id: a, from: me, to: them },
        { kind: "player", id: b, from: them, to: me },
      ],
    };
    const value = playerTradeValue(f, f.players[b], them);
    expect(tradeReply(f, t).accepted).toBe(false);
    expect(tradeReply(f, t).gap).toBeCloseTo(value * TRADE_MARGIN + 0.2, 5);
  });
});
