import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateRoster, teamTalentTarget } from "@/engine/player";
import type { Player, Team, TeamTactics } from "@/engine/types";
import { emptyLine, type StatLine } from "@/game/sim/stats";
import { simBox } from "../boxsim";
import { defaultRotation } from "../rotation";
import baseline from "./tactics-baseline.json";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const byTalent = [...teams].sort((a, b) => teamTalentTarget(a) - teamTalentTarget(b));
const [home, away] = [byTalent[14], byTalent[15]];
const rh = generateRoster(home, 1),
  ra = generateRoster(away, 2);
const GAMES = 300;
const side = (t: Team, roster: Player[], tactics?: Partial<TeamTactics>) => {
  const rotation = defaultRotation(roster, 240);
  return { teamId: t.id, roster, rotation, starters: Object.keys(rotation).slice(0, 5), tactics };
};
type Stat = keyof StatLine;
function measure(tactics: Partial<TeamTactics>, oppTactics?: Partial<TeamTactics>) {
  const own = emptyLine(),
    opp = emptyLine();
  const by: Record<string, StatLine> = {};
  for (let i = 0; i < GAMES; i++) {
    const r = simBox({ league: "pro", quarterMinutes: 12, periods: 4, home: side(home, rh, tactics), away: side(away, ra, oppTactics), seed: `t${i}` });
    for (const [id, l] of Object.entries(r.box)) {
      const t = rh.some((p) => p.id === id) ? own : opp;
      for (const k of Object.keys(l) as Stat[]) t[k] += l[k];
      by[id] ??= emptyLine();
      for (const k of Object.keys(l) as Stat[]) by[id][k] += l[k];
    }
  }
  return { own, opp, by };
}
const base = measure({});

type Check = [
  name: keyof typeof baseline,
  side: "own" | "opp",
  stat: "pts" | "fga" | "fgm" | "tpa" | "tpm" | "fta" | "oreb" | "dreb" | "ast" | "stl" | "tov",
  dir: 1 | -1,
];
/** The effects big enough to rise above noise in the real engine baseline. */
const CHECKS: Check[] = [
  ["zone23", "opp", "tpa", 1],
  ["zone32", "opp", "tpa", -1],
  ["zone32", "opp", "fta", 1],
  ["press", "own", "stl", 1],
  ["press", "opp", "tov", 1],
  ["press", "opp", "fta", 1],
  ["threeHigh", "own", "tpa", 1],
  ["threeLow", "own", "tpa", -1],
  ["paceFast", "own", "fga", 1],
];
const TACTICS: Record<string, Partial<TeamTactics>> = {
  zone23: { defense: "zone23" },
  zone32: { defense: "zone32" },
  press: { defense: "press" },
  threeHigh: { threeRate: 0.9 },
  threeLow: { threeRate: 0.1 },
  paceFast: { pace: 0.9 },
  crashHigh: { crashBoards: 0.9 },
};

describe("simBox tactics move the same way as the real engine", () => {
  for (const [name, who, stat, dir] of CHECKS)
    it(`${name}: ${who} ${stat} ${dir > 0 ? "rises" : "falls"}`, () => {
      expect(Math.sign(baseline[name][who][stat])).toBe(dir);
      const r = measure(TACTICS[name]);
      expect(Math.sign(r[who][stat] - base[who][stat])).toBe(dir);
    });

  it("crashing the glass gets more offensive rebounds than staying back", () => {
    expect(measure({ crashBoards: 0.9 }).own.oreb).toBeGreaterThan(measure({ crashBoards: 0.1 }).own.oreb);
  });
});

describe("coaching a star", () => {
  const star = ra.slice(0, 5).sort((a, b) => base.by[b.id].pts - base.by[a.id].pts)[0];

  it("doubling him cuts his shots and lifts his assists", () => {
    const r = measure({ doubleTarget: star.id });
    expect(r.by[star.id].fga).toBeLessThan(base.by[star.id].fga * 0.92);
    expect(r.by[star.id].ast).toBeGreaterThan(base.by[star.id].ast * 1.05);
  });

  it("an elite defender on him lowers his shooting", () => {
    const stopper = { ...rh[1], ratings: { ...rh[1].ratings, perimeterD: 99, interiorD: 99 } };
    const roster = rh.map((p) => (p.id === stopper.id ? stopper : p));
    const pct = (matchups?: Record<string, string>) => {
      let m = 0,
        a = 0;
      for (let i = 0; i < GAMES; i++) {
        const r = simBox({ league: "pro", quarterMinutes: 12, periods: 4, home: side(home, roster, { matchups }), away: side(away, ra), seed: `m${i}` });
        m += r.box[star.id].fgm;
        a += r.box[star.id].fga;
      }
      return m / a;
    };
    expect(pct({ [stopper.id]: star.id })).toBeLessThan(pct() - 0.01);
  });
});
