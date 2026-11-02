// The pro league in Franchise: the 82-game schedule, play-in and best-of-seven playoffs.
import { addDays, proCalendar } from "@/career/calendar";
import { standings } from "@/career/hs/sim";
import { nextSeries, seriesWins } from "@/career/pro/bracket";
import { generateProSchedule } from "@/career/pro/schedule";
import type { ProSeries, ScheduledGame } from "@/career/types";
import type { Team } from "@/engine/types";
import type { Franchise } from "../types";
import type { LeagueModule } from "./index";

const conferenceOf = (t: Team): "East" | "West" => (t.conferenceId === "pro-east" ? "East" : "West");

/** Conference order, best first (win percentage, then point difference). */
export function conferenceSeeds(f: Franchise, teams: Team[], conf: "East" | "West"): string[] {
  const ids = teams.filter((t) => conferenceOf(t) === conf).map((t) => t.id);
  const table = standings(
    f.season.games.filter((g) => g.kind === "region"),
    ids,
  );
  return [...table.values()].sort((a, b) => b.w - a.w || b.pf - b.pa - (a.pf - a.pa) || a.teamId.localeCompare(b.teamId)).map((r) => r.teamId);
}

function postseason(f: Franchise, teams: Team[]): Franchise {
  if (f.phase === "offseason" || f.season.games.some((g) => g.kind === "region" && !g.result)) return f;
  const games = [...f.season.games];
  const series: ProSeries[] = f.season.series.map((x) => ({ ...x, games: [...x.games] }));
  const byId = new Map(games.map((g) => [g.id, g]));
  const seedOrder = { East: conferenceSeeds(f, teams, "East"), West: conferenceSeeds(f, teams, "West") };
  for (let guard = 0; guard < 100; guard++) {
    let changed = false;
    const fresh = nextSeries({ year: f.season.year, games, series, seeds: (conf) => seedOrder[conf] });
    if (fresh.length) {
      series.push(...fresh);
      changed = true;
    }
    for (const x of series) {
      if (x.winner) continue;
      const w = seriesWins(x, byId);
      const need = Math.ceil(x.bestOf / 2);
      if (w.high >= need || w.low >= need) {
        x.winner = w.high >= need ? x.high : x.low;
        changed = true;
        continue;
      }
      const last = x.games.length ? byId.get(x.games[x.games.length - 1]) : undefined;
      if (last && !last.result) continue;
      const i = x.games.length;
      const highHome = x.bestOf === 1 || [0, 1, 4, 6].includes(i);
      const g: ScheduledGame = {
        id: `${x.id}-${f.season.year}-g${i}`,
        date: addDays(x.start, i * 2),
        level: "pro",
        homeId: highHome ? x.high : x.low,
        awayId: highHome ? x.low : x.high,
        kind: "playoff",
        label: x.bestOf === 1 ? x.label : `${x.label} Game ${i + 1}`,
      };
      x.games.push(g.id);
      games.push(g);
      byId.set(g.id, g);
      changed = true;
    }
    if (!changed) break;
  }
  const champion = series.find((x) => x.id === "finals")?.winner;
  const phase = champion ? "offseason" : series.some((x) => x.round >= 1) ? "playoffs" : series.length ? "playIn" : f.phase;
  return { ...f, phase, season: { ...f.season, games, series, ...(champion ? { championId: champion } : {}) } };
}

export const proLeague: LeagueModule = {
  id: "pro",
  calendar: (year) => {
    const c = proCalendar(year);
    return { opening: c.opening, lastGame: c.lastGame, seasonEnd: c.seasonEnd };
  },
  quarterMinutes: 12,
  periods: 4,
  schedule: (teams, year, seed) => generateProSchedule(teams, year, seed),
  postseason,
};
