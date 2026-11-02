import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generatePlayer, playerOvr } from "@/engine/player";
import { Rng } from "@/engine/rng";
import type { Player, Team } from "@/engine/types";
import { emptyLine } from "@/game/sim/stats";
import { leaderRow } from "../core/awards";
import { leagueProgress, progressPlayer, retires } from "../core/progress";
import { createFranchise } from "../create";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const make = (seed = "progress") => createFranchise({ league: "pro", team: teams[0], teams, seed, now: 1 });

function sample(age: number, targetOvr: number, seed: string, traits?: Partial<Player["traits"]>): Player {
  const rng = new Rng(seed);
  const p = generatePlayer(rng, { pos: "SF", targetOvr, age, league: "pro", teamId: "x" });
  return { ...p, age, potential: Math.min(99, targetOvr + (age < 28 ? 8 : 0)), traits: { ...p.traits, ...traits } };
}
function meanChange(age: number, traits?: Partial<Player["traits"]>, bonus = 0, n = 600) {
  let total = 0;
  for (let i = 0; i < n; i++) {
    const p = sample(age, 72, `s${age}:${i}`, traits);
    total += playerOvr(progressPlayer(p, new Rng(`g${age}:${i}`), bonus)) - playerOvr(p);
  }
  return total / n;
}

describe("progression", () => {
  it("adds a year to everyone", () => {
    const f = make();
    const { franchise } = leagueProgress(f);
    for (const id of f.rosters[teams[3].id]) if (franchise.players[id].teamId) expect(franchise.players[id].age).toBe(f.players[id].age + 1);
  });

  it("young players with room grow on average, and those past 32 decline", () => {
    expect(meanChange(20)).toBeGreaterThan(1);
    expect(meanChange(23)).toBeGreaterThan(0.5);
    expect(meanChange(28)).toBeGreaterThan(-0.4);
    expect(meanChange(33)).toBeLessThan(-1);
    expect(meanChange(36)).toBeLessThan(meanChange(33));
  });

  it("never leaves ratings outside 25..99 or overall above potential for under-29s", () => {
    for (let i = 0; i < 500; i++) {
      const p = sample(19 + (i % 9), 60 + (i % 35), `b${i}`);
      const next = progressPlayer(p, new Rng(`n${i}`));
      for (const v of Object.values(next.ratings)) {
        expect(v).toBeGreaterThanOrEqual(25);
        expect(v).toBeLessThanOrEqual(99);
      }
      expect(playerOvr(next)).toBeLessThanOrEqual(Math.max(playerOvr(p), next.potential));
    }
  });

  it("work ethic and a good development coach help the user's young players", () => {
    expect(meanChange(22, { workEthic: 0.95 })).toBeGreaterThan(meanChange(22, { workEthic: 0.1 }) + 0.5);
    expect(meanChange(22, undefined, 1)).toBeGreaterThan(meanChange(22) + 0.3);
  });

  it("a 28-or-older player's potential falls to his overall", () => {
    const next = progressPlayer({ ...sample(30, 75, "pot"), potential: 90 }, new Rng("x"));
    expect(next.potential).toBe(playerOvr(next));
  });
});

describe("retirement", () => {
  it("a 38-year-old without a deal almost always retires, and a 27-year-old never does", () => {
    const old = sample(38, 68, "old");
    const rate = Array.from({ length: 300 }, (_, i) => retires(old, new Rng(`r${i}`), false)).filter(Boolean).length / 300;
    expect(rate).toBeGreaterThan(0.95);
    expect(Array.from({ length: 300 }, (_, i) => retires(sample(27, 60, "y"), new Rng(`y${i}`), false)).some(Boolean)).toBe(false);
  });

  it("a signed veteran is likelier to keep playing, and nobody plays past 41", () => {
    const vet = sample(35, 72, "vet");
    const count = (signed: boolean) => Array.from({ length: 500 }, (_, i) => retires(vet, new Rng(`v${i}`), signed)).filter(Boolean).length;
    expect(count(true)).toBeLessThan(count(false));
    expect(retires(sample(41, 90, "ancient"), new Rng("z"), true)).toBe(true);
  });

  it("retired players leave rosters but stay readable for this season's awards and leaders", () => {
    const f = make();
    const id = f.rosters[teams[1].id][0];
    const old = { ...f, players: { ...f.players, [id]: { ...f.players[id], age: 41, contract: undefined } } };
    const withStats = { ...old, season: { ...old.season, stats: { [id]: { ...emptyLine(), gp: 60, gs: 60, pts: 1200 } } } };
    const { franchise, report } = leagueProgress(withStats);
    expect(report.retired).toContain(id);
    expect(franchise.rosters[teams[1].id]).not.toContain(id);
    expect(franchise.players[id].teamId).toBeNull();
    const row = leaderRow(franchise, teams, id);
    expect(row.name).toBe(`${f.players[id].firstName} ${f.players[id].lastName}`);
    expect(row.team).toBe("");
  });

  it("reports how the user's players changed", () => {
    const f = make();
    const { report } = leagueProgress(f);
    expect(report.changes.map((c) => c.id).sort()).toEqual(f.rosters[f.teamId].filter((id) => !report.retired.includes(id)).sort());
  });

  it("the same save progresses the same way", () => {
    expect(leagueProgress(make()).report).toEqual(leagueProgress(make()).report);
  });
});
