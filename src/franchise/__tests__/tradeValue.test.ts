import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generatePlayer } from "@/engine/player";
import { Rng } from "@/engine/rng";
import type { Player, Team } from "@/engine/types";
import { createFranchise } from "../create";
import { pickTradeValue, playerTradeValue, teamDirection } from "../pro/tradeValue";
import { finishedSeason } from "./draftHelpers";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const f = finishedSeason(createFranchise({ league: "pro", team: teams[0], teams, seed: "value", now: 1 }), teams);
const bad = teams[0].id;
const good = teams[29].id;
const neutral = teams[15].id;

function player(ovr: number, age = 26, salary = 5e6, years = 2, potential = ovr): Player {
  const p = generatePlayer(new Rng(`${ovr}:${age}`), { pos: "SF", targetOvr: ovr, age, league: "pro", teamId: "x" });
  return { ...p, age, potential, contract: { salary, years }, file: { service: 6, teamSeasons: 2 } };
}

describe("direction", () => {
  it("winners contend and losers rebuild", () => {
    expect(teamDirection(f, good)).toBe("contending");
    expect(teamDirection(f, bad)).toBe("rebuilding");
  });
});

describe("player value", () => {
  it("a star is worth far more than two good players", () => {
    expect(playerTradeValue(f, player(92, 26, 30e6), neutral)).toBeGreaterThan(2 * playerTradeValue(f, player(80, 26, 10e6), neutral));
  });

  it("a contending team pays more for veterans and a rebuilding one for youth and picks", () => {
    const vet = player(84, 32, 10e6);
    const kid = player(74, 20, 3e6, 2, 90);
    expect(playerTradeValue(f, vet, good)).toBeGreaterThan(playerTradeValue(f, vet, bad));
    expect(playerTradeValue(f, kid, bad)).toBeGreaterThan(playerTradeValue(f, kid, good));
    const pick = f.picks.find((p) => p.round === 1 && p.originalTeamId === neutral && p.year === 2027)!;
    expect(pickTradeValue(f, pick, bad)).toBeGreaterThan(pickTradeValue(f, pick, good));
  });

  it("a bad contract has negative value, and a bargain adds value", () => {
    expect(playerTradeValue(f, player(72, 31, 40e6, 4), neutral)).toBeLessThan(0);
    expect(playerTradeValue(f, player(85, 26, 3e6, 3), neutral)).toBeGreaterThan(playerTradeValue(f, player(85, 26, 30e6, 3), neutral));
  });
});

describe("pick value", () => {
  it("a bad team's pick is worth more than a good team's", () => {
    const of = (id: string) => f.picks.find((p) => p.round === 1 && p.originalTeamId === id && p.year === 2027)!;
    expect(pickTradeValue(f, of(bad), neutral)).toBeGreaterThan(pickTradeValue(f, of(good), neutral));
  });

  it("a first is worth more than a second, and later years count for less", () => {
    const at = (round: number, year: number) => f.picks.find((p) => p.round === round && p.originalTeamId === bad && p.year === year)!;
    expect(pickTradeValue(f, at(1, 2027), neutral)).toBeGreaterThan(pickTradeValue(f, at(2, 2027), neutral));
    expect(pickTradeValue(f, at(1, 2027), neutral)).toBeGreaterThan(pickTradeValue(f, at(1, 2030), neutral));
  });
});
