// A finished season without simulating it: teams[0] has the worst record and teams[29] the best.
import type { ProSeries, ScheduledGame } from "@/career/types";
import type { Team } from "@/engine/types";
import type { Franchise } from "../types";

export function finishedSeason(f: Franchise, teams: Team[]): Franchise {
  const games: ScheduledGame[] = [];
  teams.forEach((a, i) =>
    teams.slice(i + 1).forEach((b, n) =>
      games.push({
        id: `g${i}-${n}`,
        date: f.date,
        level: "pro",
        homeId: a.id,
        awayId: b.id,
        kind: "region",
        result: { home: 90, away: 100 + i, played: false, overtimes: 0 },
      }),
    ),
  );
  const playoff = teams.slice(14);
  const series: ProSeries[] = playoff.map((t, i) => ({
    id: `s${i}`,
    conf: "East",
    round: 1,
    label: "x",
    high: t.id,
    low: playoff[(i + 1) % 16].id,
    bestOf: 7,
    start: f.date,
    games: [],
  }));
  return { ...f, phase: "offseason", season: { ...f.season, games, series } };
}
