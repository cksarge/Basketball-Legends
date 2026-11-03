import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateRoster, teamTalentTarget } from "@/engine/player";
import type { Player, Team } from "@/engine/types";
import { emptyLine, type StatLine } from "@/game/sim/stats";
import { simBox, type BoxInput } from "../boxsim";
import baseline from "./engine-baseline.json";
import { defaultRotation } from "../rotation";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const byTalent = [...teams].sort((a, b) => teamTalentTarget(a) - teamTalentTarget(b));
const REG_SECONDS = 48 * 60 * 5;

function side(t: Team, roster: Player[]) {
  const rotation = defaultRotation(roster, 240);
  const starters = Object.keys(rotation).slice(0, 5);
  return { teamId: t.id, roster, rotation, starters };
}
function game(a: Team, b: Team, seed: string, ra = generateRoster(a, 1), rb = generateRoster(b, 2)): BoxInput {
  return { league: "pro", quarterMinutes: 12, periods: 4, home: side(a, ra), away: side(b, rb), seed };
}
const sumLines = (ids: Player[], box: Record<string, StatLine>) =>
  ids.reduce((t, p) => {
    const l = box[p.id] ?? emptyLine();
    return Object.fromEntries(Object.keys(t).map((k) => [k, t[k as keyof StatLine] + l[k as keyof StatLine]])) as unknown as StatLine;
  }, emptyLine());

describe("defaultRotation", () => {
  const roster = generateRoster(teams[0], 1);
  const hurt = (p: Player, gamesOut: number): Player => ({ ...p, injury: { name: "Sprained ankle", gamesOut } });
  const total = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

  it("adds up to the game's minutes, best players first", () => {
    const r = defaultRotation(roster, 240);
    expect(total(r)).toBe(240);
    const [first] = Object.keys(r);
    expect(r[first]).toBe(Math.max(...Object.values(r)));
  });

  it("leaves hurt players out", () => {
    const r = defaultRotation([hurt(roster[0], 5), ...roster.slice(1)], 240);
    expect(r[roster[0].id]).toBeUndefined();
    expect(total(r)).toBe(240);
  });

  it("caps nobody above the game's length with only 6 healthy players", () => {
    const r = defaultRotation([...roster.slice(0, 6), ...roster.slice(6).map((p) => hurt(p, 9))], 240);
    expect(Object.keys(r)).toHaveLength(6);
    expect(total(r)).toBe(240);
    expect(Math.max(...Object.values(r))).toBeLessThanOrEqual(48);
  });

  it("calls up the least hurt players when fewer than 5 are healthy", () => {
    const r = defaultRotation(
      roster.map((p, i) => (i < 3 ? p : hurt(p, i))),
      240,
    );
    expect(Object.keys(r)).toHaveLength(5);
    expect(r[roster[3].id]).toBeGreaterThan(0);
    expect(r[roster[4].id]).toBeGreaterThan(0);
    expect(total(r)).toBe(240);
  });
});

describe("simBox", () => {
  const mid = [byTalent[14], byTalent[15]] as const;

  it("matches the real engine's stat averages over 300 games", () => {
    const ra = generateRoster(mid[0], 1),
      rb = generateRoster(mid[1], 2);
    const totals = emptyLine();
    for (let i = 0; i < 300; i++) {
      const r = simBox(game(mid[0], mid[1], `cal${i}`, ra, rb));
      for (const roster of [ra, rb]) {
        const l = sumLines(roster, r.box);
        for (const k of Object.keys(totals) as (keyof StatLine)[]) totals[k] += l[k];
      }
    }
    const mean = (k: keyof StatLine) => totals[k] / 600;
    expect(Math.abs(mean("pts") - baseline.perTeam.pts.mean)).toBeLessThanOrEqual(4);
    for (const k of ["fga", "fgm", "tpa", "tpm", "fta", "ftm", "oreb", "dreb", "ast", "stl", "blk", "tov", "pf"] as const) {
      const want = baseline.perTeam[k].mean;
      expect(Math.abs(mean(k) - want) / want, `${k}: ${mean(k).toFixed(1)} vs ${want}`).toBeLessThanOrEqual(0.08);
    }
  });

  it("lets the best roster beat the worst more than 85% of the time", () => {
    const [low, high] = [byTalent[0], byTalent[29]];
    const rl = generateRoster(low, 1),
      rh = generateRoster(high, 2);
    let wins = 0;
    for (let i = 0; i < 200; i++) {
      const r = simBox(game(i % 2 ? high : low, i % 2 ? low : high, `gap${i}`, i % 2 ? rh : rl, i % 2 ? rl : rh));
      if (r.home > r.away === (i % 2 === 1)) wins++;
    }
    expect(wins / 200).toBeGreaterThan(0.85);
  });

  it("keeps home wins near the real engine's rate", () => {
    let wins = 0;
    const ra = generateRoster(mid[0], 1),
      rb = generateRoster(mid[1], 2);
    for (let i = 0; i < 300; i++) {
      const swap = i % 2 === 1;
      const r = simBox(game(swap ? mid[1] : mid[0], swap ? mid[0] : mid[1], `home${i}`, swap ? rb : ra, swap ? ra : rb));
      if (r.home > r.away) wins++;
    }
    expect(Math.abs(wins / 300 - baseline.homeWinRate)).toBeLessThanOrEqual(0.06);
  });

  it("repeats exactly for a seed", () => {
    const ra = generateRoster(mid[0], 1),
      rb = generateRoster(mid[1], 2);
    expect(simBox(game(mid[0], mid[1], "same", ra, rb))).toEqual(simBox(game(mid[0], mid[1], "same", ra, rb)));
    expect(simBox(game(mid[0], mid[1], "same", ra, rb)).box).not.toEqual(simBox(game(mid[0], mid[1], "other", ra, rb)).box);
  });

  it("keeps every box score consistent", () => {
    const ra = generateRoster(mid[0], 1),
      rb = generateRoster(mid[1], 2);
    for (let i = 0; i < 50; i++) {
      const r = simBox(game(mid[0], mid[1], `box${i}`, ra, rb));
      expect(r.home).not.toBe(r.away);
      for (const line of Object.values(r.box)) expect(line.pts).toBe(2 * line.fgm + line.tpm + line.ftm);
      const h = sumLines(ra, r.box),
        a = sumLines(rb, r.box);
      expect(h.pts).toBe(r.home);
      expect(a.pts).toBe(r.away);
      if (r.overtimes === 0) {
        expect(h.min).toBe(REG_SECONDS);
        expect(a.min).toBe(REG_SECONDS);
      }
      expect(h.fgm).toBeLessThanOrEqual(h.fga);
      expect(h.ftm).toBeLessThanOrEqual(h.fta);
      expect(h.tpm).toBeLessThanOrEqual(h.tpa);
    }
  });

  it("still plays a full game with only 6 healthy players", () => {
    const ra = generateRoster(mid[0], 1).map((p, i) => (i < 6 ? p : { ...p, injury: { name: "Sprain", gamesOut: 9 } }));
    const r = simBox(game(mid[0], mid[1], "thin", ra));
    if (r.overtimes === 0) expect(sumLines(ra, r.box).min).toBe(REG_SECONDS);
    expect(Object.values(r.box).filter((l) => l.min > 0).length).toBeGreaterThanOrEqual(6);
  });

  it("still plays a full game with only 3 healthy players", () => {
    const ra = generateRoster(mid[0], 1).map((p, i) => (i < 3 ? p : { ...p, injury: { name: "Sprain", gamesOut: i } }));
    const r = simBox(game(mid[0], mid[1], "emergency", ra));
    if (r.overtimes === 0) expect(sumLines(ra, r.box).min).toBe(REG_SECONDS);
    expect(r.home + r.away).toBeGreaterThan(100);
  });

  it("gives injuries to players in the game", () => {
    const ra = generateRoster(mid[0], 1),
      rb = generateRoster(mid[1], 2);
    let hurt = 0;
    for (let i = 0; i < 400; i++) {
      const r = simBox(game(mid[0], mid[1], `hurt${i}`, ra, rb));
      for (const x of r.injuries) {
        hurt++;
        expect(r.box[x.playerId].min).toBeGreaterThan(0);
        expect(x.gamesOut).toBeGreaterThanOrEqual(1);
      }
    }
    expect(hurt).toBeGreaterThan(5);
    expect(hurt).toBeLessThan(120);
  });

  it("names a player of the game from the box score", () => {
    const r = simBox(game(mid[0], mid[1], "pog"));
    expect(r.box[r.playerOfGame!]).toBeDefined();
  });

  it("simulates 200 games in under 4 seconds", () => {
    const ra = generateRoster(mid[0], 1),
      rb = generateRoster(mid[1], 2);
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) simBox(game(mid[0], mid[1], `speed${i}`, ra, rb));
    expect(performance.now() - t0).toBeLessThan(4000);
  });
});

describe.each([
  { league: "college" as const, quarterMinutes: 20, periods: 2, file: "college", pick: (t: Team) => t.tier === "D1" },
  { league: "hs" as const, quarterMinutes: 8, periods: 4, file: "hs", pick: (t: Team) => t.levels?.includes("varsity") ?? true },
])("simBox in $league", ({ league, quarterMinutes, periods, file, pick }) => {
  const want = JSON.parse(readFileSync(`src/franchise/__tests__/engine-baseline-${file}.json`, "utf8")) as typeof baseline;
  const all = (JSON.parse(readFileSync(`src/data/generated/${file}.json`, "utf8")) as { teams: Team[] }).teams.filter(pick);
  const ranked = [...all].sort((a, b) => teamTalentTarget(a) - teamTalentTarget(b));
  const minutes = quarterMinutes * periods * 5;
  const sideOf = (t: Team, roster: Player[]) => {
    const rotation = defaultRotation(roster, minutes);
    return { teamId: t.id, roster, rotation, starters: Object.keys(rotation).slice(0, 5) };
  };
  const play = (a: Team, b: Team, seed: string, ra: Player[], rb: Player[]): BoxInput => ({
    league,
    quarterMinutes,
    periods,
    home: sideOf(a, ra),
    away: sideOf(b, rb),
    seed,
  });

  it("matches the real engine's stat averages over 300 games", () => {
    const totals = emptyLine();
    for (let i = 0; i < 300; i++) {
      // the real baseline mixes every kind of matchup, so these do too
      const a = all[(i * 7) % all.length],
        b = all[(i * 11 + 3) % all.length];
      const ra = generateRoster(a, i),
        rb = generateRoster(b, i + 100);
      const r = simBox(play(a, b, `cal${i}`, ra, rb));
      for (const roster of [ra, rb]) {
        const l = sumLines(roster, r.box);
        for (const k of Object.keys(totals) as (keyof StatLine)[]) totals[k] += l[k];
      }
    }
    const mean = (k: keyof StatLine) => totals[k] / 600;
    expect(Math.abs(mean("pts") - want.perTeam.pts.mean), `pts: ${mean("pts").toFixed(1)} vs ${want.perTeam.pts.mean}`).toBeLessThanOrEqual(4);
    for (const k of ["fga", "fgm", "tpa", "tpm", "fta", "ftm", "oreb", "dreb", "ast", "stl", "blk", "tov", "pf"] as const) {
      const target = want.perTeam[k].mean;
      expect(Math.abs(mean(k) - target) / target, `${k}: ${mean(k).toFixed(1)} vs ${target}`).toBeLessThanOrEqual(0.08);
    }
  });

  it("lets the best roster beat the worst more than 85% of the time", () => {
    const [low, high] = [ranked[0], ranked[ranked.length - 1]];
    const rl = generateRoster(low, 1),
      rh = generateRoster(high, 2);
    let wins = 0;
    for (let i = 0; i < 200; i++) {
      const r = simBox(play(i % 2 ? high : low, i % 2 ? low : high, `gap${i}`, i % 2 ? rh : rl, i % 2 ? rl : rh));
      if (r.home > r.away === (i % 2 === 1)) wins++;
    }
    expect(wins / 200).toBeGreaterThan(0.85);
  });

  it("keeps home wins near the real engine's rate", () => {
    const mid = [ranked[Math.floor(ranked.length / 2)], ranked[Math.floor(ranked.length / 2) + 1]];
    const ra = generateRoster(mid[0], 1),
      rb = generateRoster(mid[1], 2);
    let wins = 0;
    for (let i = 0; i < 300; i++) {
      const swap = i % 2 === 1;
      const r = simBox(play(swap ? mid[1] : mid[0], swap ? mid[0] : mid[1], `home${i}`, swap ? rb : ra, swap ? ra : rb));
      if (r.home > r.away) wins++;
    }
    expect(Math.abs(wins / 300 - want.homeWinRate)).toBeLessThanOrEqual(0.06);
  });

  it(`adds up to ${minutes} minutes per team in regulation`, () => {
    const [a, b] = [ranked[10], ranked[20]];
    const ra = generateRoster(a, 1),
      rb = generateRoster(b, 2);
    for (let i = 0; i < 30; i++) {
      const r = simBox(play(a, b, `min${i}`, ra, rb));
      if (r.overtimes) continue;
      expect(sumLines(ra, r.box).min).toBe(minutes * 60);
      expect(sumLines(rb, r.box).min).toBe(minutes * 60);
    }
  });
});
