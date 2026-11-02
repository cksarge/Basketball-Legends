import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Team } from "@/engine/types";
import { resolveLineup } from "../coaching/plan";
import { applyMove, moveLock, prunePlan, undoMove } from "../core/moves";
import { advanceOffseason } from "../core/offseason";
import { simDay } from "../core/season";
import { createFranchise } from "../create";
import { releasePlayer } from "../pro/rosterMoves";
import { applyTrade, type Trade } from "../pro/trades";
import type { Franchise } from "../types";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const make = () => createFranchise({ league: "pro", team: teams[0], teams, seed: "moves2", now: 1 });
const me = teams[0].id;
const them = teams[1].id;
function dealFor(f: Franchise): Trade {
  return {
    teams: [me, them],
    assets: [
      { kind: "player", id: f.rosters[me][0], from: me, to: them },
      { kind: "player", id: f.rosters[them][0], from: them, to: me },
      { kind: "pick", id: `pick-2027-1-${me}`, from: me, to: them },
    ],
  };
}
const even = (f: Franchise): Franchise => {
  const a = f.rosters[me][0],
    b = f.rosters[them][0];
  return {
    ...f,
    players: { ...f.players, [a]: { ...f.players[a], contract: { salary: 5e6, years: 2 } }, [b]: { ...f.players[b], contract: { salary: 5e6, years: 2 } } },
  };
};
const planned = (f: Franchise): Franchise => {
  const starters = f.rosters[me].slice(0, 5);
  return {
    ...f,
    plan: {
      ...f.plan,
      autoRotation: false,
      starters,
      minutes: Object.fromEntries(f.rosters[me].slice(0, 9).map((id) => [id, 25])),
      playerPlans: { [starters[0]]: { focus: "shooting" } },
      tactics: { ...f.plan.tactics, matchups: { [starters[0]]: f.rosters[them][1], [starters[1]]: f.rosters[them][0] }, doubleTarget: f.rosters[them][0] },
    },
  };
};

describe("undo", () => {
  it("undo restores players, rosters, picks, books, free agents and cap use", () => {
    const f = even(make());
    const moved = applyMove(f, "Trade", (x) => releasePlayer(applyTrade(x, dealFor(x)), x.rosters[me][3]));
    expect(moved.undo?.label).toBe("Trade");
    expect(moved.rosters).not.toEqual(f.rosters);
    const back = undoMove(moved);
    expect(back.undo).toBeUndefined();
    expect(back.rosters).toEqual(f.rosters);
    expect(back.picks).toEqual(f.picks);
    expect(back.books).toEqual(f.books);
    expect(back.waivers).toEqual(f.waivers);
    expect(back.freeAgents).toEqual(f.freeAgents);
    expect(back.players).toEqual(f.players);
  });

  it("only the last move can be undone", () => {
    const f = make();
    const one = applyMove(f, "One", (x) => releasePlayer(x, x.rosters[me][14]));
    const two = applyMove(one, "Two", (x) => releasePlayer(x, x.rosters[me][13]));
    expect(two.undo?.label).toBe("Two");
    const back = undoMove(two);
    expect(back.rosters).toEqual(one.rosters);
    expect(back.undo).toBeUndefined();
  });

  it("a move that changes nothing isn't recorded", () => {
    const f = make();
    expect(applyMove(f, "None", (x) => x)).toBe(f);
  });

  it("a simulated day or an offseason step clears undo", () => {
    const f = applyMove(make(), "One", (x) => releasePlayer(x, x.rosters[me][14]));
    expect(simDay(f, teams, { includeUser: true }).franchise.undo).toBeUndefined();
    const off = { ...f, phase: "offseason" as const, offseason: { step: "review" as const, report: null } };
    expect(advanceOffseason(off, teams).undo).toBeUndefined();
  });

  it("undo brings back the plan the move changed", () => {
    const f = even(planned(make()));
    const moved = applyMove(f, "Trade", (x) => applyTrade(x, dealFor(x)));
    expect(moved.plan).not.toEqual(f.plan);
    expect(undoMove(moved).plan).toEqual(f.plan);
  });
});

describe("the coaching plan follows the roster", () => {
  it("trading a starter drops him from starters, minutes, player plans and game plan", () => {
    const f = even(planned(make()));
    const gone = f.rosters[me][0];
    const arrived = f.rosters[them][0];
    const next = prunePlan(applyTrade(f, dealFor(f)));
    expect(next.plan.starters).not.toContain(gone);
    expect(next.plan.starters).toHaveLength(5);
    expect(next.plan.minutes[gone]).toBeUndefined();
    expect(next.plan.playerPlans[gone]).toBeUndefined();
    expect(next.plan.tactics.matchups?.[gone]).toBeUndefined();
    // the player they were doubling is on your team now
    expect(next.plan.tactics.doubleTarget).toBeUndefined();
    expect(Object.values(next.plan.tactics.matchups ?? {})).not.toContain(arrived);
  });

  it("resolveLineup still fills after that trade", () => {
    const f = even(planned(make()));
    const next = prunePlan(applyTrade(f, dealFor(f)));
    const lineup = resolveLineup(
      next.plan,
      next.rosters[me].map((id) => next.players[id]),
      240,
    );
    expect(lineup.starters).toHaveLength(5);
    expect(Object.values(lineup.rotation).reduce((a, b) => a + b, 0)).toBeCloseTo(240, 0);
  });

  it("a plan with nothing to fix stays the same object", () => {
    const f = make();
    expect(prunePlan(f)).toBe(f);
  });
});

describe("the move lock", () => {
  it("moves wait while a game is partway through or suspended", () => {
    const f = make();
    expect(moveLock(f)).toBeNull();
    expect(moveLock(f, "game1")).toMatch(/saved game/i);
    const live = { ...f, live: { gameId: "x", partial: { home: 1, away: 1, box: {}, seconds: 0 } } };
    expect(moveLock(live)).toMatch(/game/i);
  });
});
