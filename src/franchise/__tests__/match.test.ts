import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Team } from "@/engine/types";
import { emptyLine } from "@/game/sim/stats";
import type { MatchResult } from "@/state/matchStore";
import { applyGame, nextFranchiseEvent, simDay } from "../core/season";
import { createFranchise } from "../create";
import { applyFinishedFranchiseMatch, franchisePending, resultToBox } from "../match";
import type { Franchise } from "../types";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const team = teams[0];
const make = () => createFranchise({ league: "pro", team, teams, seed: "match", now: 1 });
const firstGame = (f: Franchise) => {
  const ev = nextFranchiseEvent(f);
  if (ev.kind !== "game") throw new Error("no game");
  return ev.game;
};
function result(f: Franchise, o: Partial<MatchResult> = {}): MatchResult {
  const g = firstGame(f);
  const id = f.rosters[team.id][0];
  return {
    mode: "franchise",
    homeId: g.homeId,
    awayId: g.awayId,
    homeScore: 50,
    awayScore: 40,
    box: { [id]: { ...emptyLine(), min: 720, pts: 10, fgm: 5, fga: 8 } },
    periods: 4,
    playByPlay: [],
    playerOfGame: id,
    quarterMinutes: 6,
    simulated: false,
    injuries: [],
    franchise: { franchiseId: f.id, gameId: g.id },
    ...o,
  };
}

describe("franchisePending", () => {
  it("sets up the home team, the user's controller and the way back", () => {
    const f = make();
    const g = firstGame(f);
    const p = franchisePending(f, g, teams, "keyboard");
    expect(p.mode).toBe("franchise");
    expect(p.home.team.id).toBe(g.homeId);
    expect(p.away.team.id).toBe(g.awayId);
    const mine = g.homeId === team.id ? p.home : p.away;
    const theirs = g.homeId === team.id ? p.away : p.home;
    expect(mine.controllers).toEqual(["keyboard"]);
    expect(theirs.controllers).toEqual([]);
    expect(p.returnTo).toContain(encodeURIComponent(f.id));
    expect(p.lockPlayerId).toBeUndefined();
    expect(p.franchise).toEqual({ franchiseId: f.id, gameId: g.id });
    expect(p.quarterMinutes).toBe(f.settings.quarterMinutes);
    expect(p.difficulty).toBe(f.settings.difficulty);
  });

  it("leaves hurt players at home", () => {
    const f = make();
    const id = f.rosters[team.id][0];
    const hurt = { ...f, players: { ...f.players, [id]: { ...f.players[id], injury: { name: "Sprain", gamesOut: 3 } } } };
    const p = franchisePending(hurt, firstGame(hurt), teams, "keyboard");
    expect([...p.home.roster, ...p.away.roster].map((x) => x.id)).not.toContain(id);
  });
});

describe("the coaching plan in games", () => {
  const coached = (): Franchise => {
    const f = make();
    const ids = f.rosters[team.id];
    const starters = [ids[9], ids[1], ids[2], ids[3], ids[4]];
    const minutes = Object.fromEntries(ids.slice(0, 10).map((id) => [id, 24]));
    return { ...f, plan: { ...f.plan, autoRotation: false, starters, minutes, tactics: { ...f.plan.tactics, defense: "zone23" as const } } };
  };

  it("goes into a played game on the user's side only", () => {
    const f = coached();
    const g = firstGame(f);
    const p = franchisePending(f, g, teams, "keyboard");
    const [mine, theirs] = g.homeId === team.id ? [p.home, p.away] : [p.away, p.home];
    expect(mine.starters).toEqual(f.plan.starters);
    expect(mine.rotation?.[f.plan.starters[0]]).toBe(24);
    expect(mine.tactics?.defense).toBe("zone23");
    expect(theirs.tactics).toBeUndefined();
    expect(theirs.rotation).toBeUndefined();
  });

  it("leaves rotation to the game on auto", () => {
    const f = make();
    const g = firstGame(f);
    const p = franchisePending(f, g, teams, "keyboard");
    expect((g.homeId === team.id ? p.home : p.away).rotation).toBeUndefined();
  });

  it("starts the chosen players in a simmed game", () => {
    let f = coached();
    for (let i = 0; i < 30 && !f.season.games.some((g) => g.result && (g.homeId === team.id || g.awayId === team.id)); i++)
      f = simDay(f, teams, { includeUser: true }).franchise;
    expect(f.season.stats[f.plan.starters[0]]).toMatchObject({ gs: 1 });
  });
});

describe("matchups", () => {
  it("last for one game", () => {
    const f = make();
    const set = { ...f, plan: { ...f.plan, tactics: { ...f.plan.tactics, matchups: { a: "b" }, doubleTarget: "b" } } };
    const next = applyFinishedFranchiseMatch(set, result(set), teams);
    expect(next.plan.tactics.matchups).toBeUndefined();
    expect(next.plan.tactics.doubleTarget).toBeUndefined();
  });

  it("clear when the user's game is simmed, but not for someone else's game", () => {
    const f = make();
    const set = { ...f, plan: { ...f.plan, tactics: { ...f.plan.tactics, matchups: { a: "b" } } } };
    const other = applyGame(set, set.season.games.find((g) => g.homeId !== team.id && g.awayId !== team.id)!.id, resultToBox(result(set), 4), false);
    expect(other.plan.tactics.matchups).toEqual({ a: "b" });
    const mine = simDay({ ...set, date: firstGame(set).date }, teams, { includeUser: true }).franchise;
    expect(mine.plan.tactics.matchups).toBeUndefined();
  });
});

describe("resultToBox", () => {
  it("counts overtimes past regulation", () => {
    expect(resultToBox(result(make(), { periods: 6 }), 4).overtimes).toBe(2);
    expect(resultToBox(result(make()), 4).overtimes).toBe(0);
  });
});

describe("applyFinishedFranchiseMatch", () => {
  it("records the score as played, with league stats at full game length", () => {
    const f = make();
    const next = applyFinishedFranchiseMatch(f, result(f), teams);
    const g = next.season.games.find((x) => x.id === firstGame(f).id)!;
    expect(g.result).toMatchObject({ home: 50, away: 40, played: true });
    const id = f.rosters[team.id][0];
    expect(g.result!.box![id].pts).toBe(10);
    expect(next.season.stats[id]).toMatchObject({ gp: 1, pts: 20, fga: 16 });
  });

  it("marks a game simmed from the pause menu as not played", () => {
    const f = make();
    const next = applyFinishedFranchiseMatch(f, result(f, { simulated: true }), teams);
    expect(next.season.games.find((x) => x.id === firstGame(f).id)!.result!.played).toBe(false);
  });

  it("applies once, however many times the result comes back", () => {
    const f = make();
    const r = result(f);
    const once = applyFinishedFranchiseMatch(f, r, teams);
    expect(applyFinishedFranchiseMatch(once, r, teams)).toBe(once);
  });

  it("ignores a result from another franchise", () => {
    const f = make();
    expect(applyFinishedFranchiseMatch(f, result(f, { franchise: { franchiseId: "other", gameId: "x" } }), teams)).toBe(f);
  });

  it("lands a played game's injuries", () => {
    const f = make();
    const id = f.rosters[team.id][0];
    const next = applyFinishedFranchiseMatch(
      f,
      result(f, { injuries: [{ playerId: id, team: 0, name: "Sore knee", gamesOut: 4, period: 2, clock: 100 }] }),
      teams,
    );
    expect(next.players[id].injury).toEqual({ name: "Sore knee", gamesOut: 4 });
  });

  it("lets the next day run after a played game", () => {
    const f = make();
    const next = applyFinishedFranchiseMatch(f, result(f), teams);
    expect(simDay({ ...next, date: firstGame(f).date }, teams, { includeUser: false }).blocked).toBe(false);
  });
});
