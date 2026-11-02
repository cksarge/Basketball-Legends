import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateRoster } from "@/engine/player";
import type { Team } from "@/engine/types";
import { finishPartial, nextFranchiseEvent, startFourth } from "../core/season";
import { finishBox, simBox, simQuarters, type BoxInput } from "../boxsim";
import { createFranchise } from "../create";
import { defaultRotation } from "../rotation";
import type { Franchise } from "../types";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const team = teams[0];
const ra = generateRoster(teams[1], 1),
  rb = generateRoster(teams[2], 2);
const side = (t: Team, r: typeof ra) => {
  const rotation = defaultRotation(r, 240);
  return { teamId: t.id, roster: r, rotation, starters: Object.keys(rotation).slice(0, 5) };
};
const input = (seed: string): BoxInput => ({ league: "pro", quarterMinutes: 12, periods: 4, home: side(teams[1], ra), away: side(teams[2], rb), seed });
const make = (): Franchise => createFranchise({ league: "pro", team, teams, seed: "partial", now: 1 });
const nextGame = (f: Franchise) => {
  const ev = nextFranchiseEvent(f);
  if (ev.kind !== "game") throw new Error("no game");
  return ev.game;
};

describe("simQuarters", () => {
  it("plays three quarters' minutes, with totals that match the score", () => {
    const p = simQuarters(input("a"), 3);
    const lines = (r: typeof ra) => r.map((x) => p.box[x.id]);
    const sum = (r: typeof ra, k: "min" | "pts") => lines(r).reduce((s, l) => s + (l?.[k] ?? 0), 0);
    expect(sum(ra, "min")).toBe(36 * 60 * 5);
    expect(sum(ra, "pts")).toBe(p.home);
    expect(sum(rb, "pts")).toBe(p.away);
    expect(p.seconds).toBe(36 * 60);
    expect(p.home).toBeGreaterThan(50);
    expect(p.home).toBeLessThan(120);
  });

  it("repeats for a seed", () => {
    expect(simQuarters(input("b"), 3)).toEqual(simQuarters(input("b"), 3));
  });

  it("can end level", () => {
    const ties = Array.from({ length: 400 }, (_, i) => simQuarters(input(`t${i}`), 3)).filter((p) => p.home === p.away);
    expect(ties.length).toBeGreaterThan(0);
  });
});

describe("injuries", () => {
  it("happen as often in a game finished from a partial as in a whole one", () => {
    let whole = 0,
      split = 0;
    for (let i = 0; i < 1500; i++) {
      const g = input(`i${i}`);
      whole += simBox(g).injuries.length;
      split += finishBox(g, simQuarters(g, 3)).injuries.length;
    }
    expect(split).toBeGreaterThan(whole * 0.7);
    expect(split).toBeLessThan(whole * 1.3);
  });
});

describe("startFourth and finishPartial", () => {
  it("keeps one saved partial however often it's opened", () => {
    const f = make();
    const g = nextGame(f);
    const once = startFourth(f, g);
    expect(once.live?.gameId).toBe(g.id);
    expect(startFourth(once, g)).toBe(once);
  });

  it("finishes from the saved score, once, with a winner", () => {
    const f = make();
    const g = nextGame(f);
    const live = startFourth(f, g);
    const done = finishPartial(live, g.id, teams);
    const r = done.season.games.find((x) => x.id === g.id)!.result!;
    expect(r.home).toBeGreaterThanOrEqual(live.live!.partial.home);
    expect(r.away).toBeGreaterThanOrEqual(live.live!.partial.away);
    expect(r.home).not.toBe(r.away);
    expect(done.live).toBeUndefined();
    const gp = done.season.stats[f.rosters[team.id][0]]?.gp;
    expect(gp).toBe(1);
    expect(finishPartial(done, g.id, teams)).toBe(done);
  });

  it("counts the whole game in the league's stats", () => {
    const f = make();
    const g = nextGame(f);
    const done = finishPartial(startFourth(f, g), g.id, teams);
    const r = done.season.games.find((x) => x.id === g.id)!.result!;
    const pts = done.rosters[g.homeId].reduce((s, id) => s + (done.season.stats[id]?.pts ?? 0), 0);
    expect(pts).toBe(r.home);
  });
});
