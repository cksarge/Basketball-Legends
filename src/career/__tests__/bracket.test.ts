import { describe, expect, it } from "vitest";
import type { ProSeries, ScheduledGame } from "../types";
import { makeSeries, nextSeries, roundStart, seriesScore, seriesWins, type BracketInput } from "../pro/bracket";

const seed = (conf: string) => Array.from({ length: 15 }, (_, i) => `${conf}${i + 1}`);
const input = (series: ProSeries[], games: ScheduledGame[] = []): BracketInput => ({ year: 2026, games, series, seeds: seed });
/** Runs the bracket with the high seed always winning, collecting each batch of new series. */
function run(stopAfter = 40) {
  const series: ProSeries[] = [];
  const batches: ProSeries[][] = [];
  for (let i = 0; i < stopAfter; i++) {
    const fresh = nextSeries(input(series, finalsGames(series)));
    if (!fresh.length) break;
    batches.push(fresh);
    series.push(...fresh);
    for (const x of series) x.winner ??= x.high;
  }
  return { series, batches };
}
/** Regular season wins so the East champion has the better record. */
const finalsGames = (series: ProSeries[]): ScheduledGame[] => {
  const e = series.find((x) => x.id === "East-r3-0")?.winner;
  const w = series.find((x) => x.id === "West-r3-0")?.winner;
  if (!e || !w) return [];
  return [{ id: "g", date: "2026-11-01", level: "pro", homeId: w, awayId: e, kind: "region", result: { home: 90, away: 100, played: false, overtimes: 0 } }];
};

describe("pro bracket", () => {
  it("starts with two play-in games per conference", () => {
    const first = nextSeries(input([]));
    expect(first.map((x) => [x.id, x.high, x.low])).toEqual([
      ["East-pi1", "East7", "East8"],
      ["East-pi2", "East9", "East10"],
      ["West-pi1", "West7", "West8"],
      ["West-pi2", "West9", "West10"],
    ]);
  });

  it("adds the final play-in game with the 7-8 loser and the 9-10 winner", () => {
    const { batches } = run();
    const pi3 = batches[1].find((x) => x.id === "East-pi3")!;
    expect([pi3.high, pi3.low]).toEqual(["East8", "East9"]);
  });

  it("pairs 1v8, 4v5, 3v6 and 2v7 in the first round", () => {
    const { series } = run();
    const r1 = series.filter((x) => x.conf === "East" && x.round === 1);
    expect(r1.map((x) => [x.high, x.low])).toEqual([
      ["East1", "East8"],
      ["East4", "East5"],
      ["East3", "East6"],
      ["East2", "East7"],
    ]);
    expect(r1.every((x) => x.bestOf === 7)).toBe(true);
  });

  it("runs through the semifinals and conference finals to the Finals", () => {
    const { series } = run();
    expect(series.filter((x) => x.conf === "West" && x.round === 2)).toHaveLength(2);
    expect(series.filter((x) => x.conf === "West" && x.round === 3)).toHaveLength(1);
    const f = series.find((x) => x.id === "finals")!;
    expect(f.label).toBe("The Finals");
    expect(f.start).toBe(roundStart(2026, 4));
  });

  it("gives the better record home court in the Finals", () => {
    const { series } = run();
    const f = series.find((x) => x.id === "finals")!;
    expect(f.high).toBe("East1");
    expect(f.low).toBe("West1");
  });

  it("counts wins from either side's home games", () => {
    const x = makeSeries("s", "East", 1, "a", "b", 7, "2027-04-19");
    const result = { played: false, overtimes: 0 };
    const games: ScheduledGame[] = [
      { id: "1", date: "2027-04-19", level: "pro", homeId: "a", awayId: "b", kind: "playoff", result: { ...result, home: 100, away: 90 } },
      { id: "2", date: "2027-04-21", level: "pro", homeId: "b", awayId: "a", kind: "playoff", result: { ...result, home: 100, away: 90 } },
      { id: "3", date: "2027-04-23", level: "pro", homeId: "b", awayId: "a", kind: "playoff", result: { ...result, home: 80, away: 90 } },
    ];
    x.games = ["1", "2", "3"];
    expect(seriesScore(x, games)).toEqual({ high: 2, low: 1 });
    expect(seriesWins(x, new Map(games.map((g) => [g.id, g])))).toEqual({ high: 2, low: 1 });
  });
});
