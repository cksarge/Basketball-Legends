import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addDays } from "@/career/calendar";
import type { Team } from "@/engine/types";
import { simDay } from "../core/season";
import { createFranchise } from "../create";
import { powerRankings } from "../history/power";
import { finishedSeason } from "./draftHelpers";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const make = () => createFranchise({ league: "pro", team: teams[0], teams, seed: "power", now: 1 });
const finished = finishedSeason(make(), teams);

describe("power rankings", () => {
  it("rankings cover all 30 teams with no ties", () => {
    const r = powerRankings(make());
    expect(r).toHaveLength(30);
    expect(r.map((x) => x.rank)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it("winners rank above losers", () => {
    const r = powerRankings(finished);
    const rank = (id: string) => r.find((x) => x.teamId === id)!.rank;
    expect(rank(teams[29].id)).toBeLessThan(rank(teams[0].id));
  });

  it("recent form counts", () => {
    const id = teams[10].id;
    // the same 15 wins in 29 games, early or late
    const score = (late: boolean) => {
      let n = 0;
      const games = finished.season.games.map((g) => {
        if (g.homeId !== id && g.awayId !== id) return g;
        const won = late ? n >= 14 : n < 15;
        const date = addDays(finished.date, n++);
        return { ...g, date, result: { ...g.result!, home: (g.homeId === id) === won ? 110 : 90, away: 100 } };
      });
      return powerRankings({ ...finished, season: { ...finished.season, games } }).find((x) => x.teamId === id)!.score;
    };
    expect(score(true)).toBeGreaterThan(score(false));
  });

  it("before any games, roster strength sets the order", () => {
    const f = make();
    const top = powerRankings(f)[0].teamId;
    const strongest = [...teams]
      .sort((a, b) => b.prestige - a.prestige)
      .slice(0, 8)
      .map((t) => t.id);
    expect(strongest).toContain(top);
  });

  it("movement compares with last week", () => {
    const f = make();
    const r = powerRankings({ ...f, powerLast: { [teams[3].id]: 1 } });
    expect(r.find((x) => x.teamId === teams[3].id)!.last).toBe(1);
  });

  it("the weekly tick stores last week's ranks", () => {
    let f = make();
    const end = addDays(f.date, 8);
    while (f.date < end) f = simDay(f, teams, { includeUser: true }).franchise;
    expect(Object.keys(f.powerLast)).toHaveLength(30);
  });
});
