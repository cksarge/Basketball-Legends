import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Team } from "@/engine/types";
import { emptyLine } from "@/game/sim/stats";
import type { MatchResult } from "@/state/matchStore";
import { isClose, nextFranchiseEvent, simDay, startFourth } from "../core/season";
import { createFranchise } from "../create";
import { applyFinishedFranchiseMatch, fourthPending } from "../match";
import type { Franchise } from "../types";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const team = teams[0];
const make = (settings = {}): Franchise => {
  let f = createFranchise({ league: "pro", team, teams, seed: "fourth", now: 1, settings });
  // up to game day
  for (let i = 0; i < 60; i++) {
    const r = simDay(f, teams, { includeUser: false });
    f = r.franchise;
    if (r.blocked) break;
  }
  return f;
};
const gameOf = (f: Franchise) => {
  const ev = nextFranchiseEvent(f);
  if (ev.kind !== "game") throw new Error("no game");
  return ev.game;
};
function played(f: Franchise): MatchResult {
  const g = gameOf(f);
  const id = f.rosters[team.id][0];
  const before = f.live!.partial.box[id] ?? emptyLine();
  const homeUp = 10;
  return {
    mode: "franchise",
    homeId: g.homeId,
    awayId: g.awayId,
    homeScore: f.live!.partial.home + homeUp,
    awayScore: f.live!.partial.away + 5,
    box: { ...f.live!.partial.box, [id]: { ...before, pts: before.pts + 4, fgm: before.fgm + 2, fga: before.fga + 3 } },
    periods: 4,
    playByPlay: [],
    playerOfGame: id,
    quarterMinutes: 6,
    simulated: false,
    injuries: [],
    franchise: { franchiseId: f.id, gameId: g.id },
  };
}

describe("isClose", () => {
  const partial = (home: number, away: number) => ({ home, away, box: {}, seconds: 2160 });
  it("counts a margin of 8 as close and 9 as not", () => {
    expect(isClose(partial(80, 72), 8)).toBe(true);
    expect(isClose(partial(72, 80), 8)).toBe(true);
    expect(isClose(partial(81, 72), 8)).toBe(false);
  });
});

describe("playing the 4th quarter", () => {
  it("opens the game in the last period with the saved score", () => {
    const f = startFourth(make(), gameOf(make()));
    const p = fourthPending(f, gameOf(f), teams, "keyboard");
    expect(p.startFrom).toMatchObject({ period: 4, homeScore: f.live!.partial.home, awayScore: f.live!.partial.away });
    expect(p.franchise?.gameId).toBe(gameOf(f).id);
  });

  it("scales only the quarter that was played", () => {
    const f = startFourth(make(), gameOf(make()));
    const id = f.rosters[team.id][0];
    const before = f.live!.partial.box[id]?.pts ?? 0;
    const next = applyFinishedFranchiseMatch(f, played(f), teams);
    expect(next.season.stats[id].pts).toBe(before + 8);
    const r = next.season.games.find((g) => g.id === gameOf(f).id)!.result!;
    expect(r.played).toBe(true);
    expect(r.home).toBe(f.live!.partial.home + 10);
  });

  it("applies once and clears the partial", () => {
    const f = startFourth(make(), gameOf(make()));
    const r = played(f);
    const once = applyFinishedFranchiseMatch(f, r, teams);
    expect(once.live).toBeUndefined();
    expect(applyFinishedFranchiseMatch(once, r, teams)).toBe(once);
  });

  it("keeps the same three quarters if you leave and sim it", () => {
    const f = startFourth(make(), gameOf(make()));
    const g = gameOf(f);
    const after = simDay(f, teams, { includeUser: true, simLive: true }).franchise;
    const r = after.season.games.find((x) => x.id === g.id)!.result!;
    expect(r.home).toBeGreaterThanOrEqual(f.live!.partial.home);
    expect(r.away).toBeGreaterThanOrEqual(f.live!.partial.away);
    expect(r.played).toBe(false);
    expect(after.live).toBeUndefined();
    const again = simDay(startFourth(f, g), teams, { includeUser: true, simLive: true }).franchise;
    expect(again.season.games.find((x) => x.id === g.id)!.result).toEqual(r);
  });
});

describe("close games only", () => {
  it("stops at a close game with the score saved", () => {
    const f = make({ closeGamesOnly: true, closeGameMargin: 1000 });
    const r = simDay(f, teams, { includeUser: true });
    expect(r.blocked).toBe(true);
    expect(r.franchise.live?.gameId).toBe(gameOf(f).id);
    expect(r.franchise.season.games.find((g) => g.id === gameOf(f).id)!.result).toBeUndefined();
  });

  it("finishes a game that isn't close", () => {
    const f = make({ closeGamesOnly: true, closeGameMargin: -1 });
    const g = gameOf(f);
    const r = simDay(f, teams, { includeUser: true });
    expect(r.blocked).toBe(false);
    expect(r.franchise.season.games.find((x) => x.id === g.id)!.result).toBeDefined();
    expect(r.franchise.live).toBeUndefined();
  });

  it("doesn't stop with the setting off", () => {
    const f = make({ closeGameMargin: 1000 });
    expect(simDay(f, teams, { includeUser: true }).blocked).toBe(false);
  });

  it("keeps stopping on the same game until you decide", () => {
    const f = make({ closeGamesOnly: true, closeGameMargin: 1000 });
    const r = simDay(f, teams, { includeUser: true });
    const again = simDay(r.franchise, teams, { includeUser: true });
    expect(again.blocked).toBe(true);
    expect(again.franchise.live).toEqual(r.franchise.live);
  });

  it("sim the rest settles it", () => {
    const f = make({ closeGamesOnly: true, closeGameMargin: 1000 });
    const g = gameOf(f);
    const r = simDay(f, teams, { includeUser: true });
    const done = simDay(r.franchise, teams, { includeUser: true, simLive: true });
    expect(done.blocked).toBe(false);
    expect(done.franchise.season.games.find((x) => x.id === g.id)!.result).toBeDefined();
  });
});
