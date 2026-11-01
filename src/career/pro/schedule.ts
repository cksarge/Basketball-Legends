// The 82-game pro schedule: 4 games against each division rival, 3 or 4 against the rest of the conference,
// and 2 against every team in the other conference, 41 at home and 41 away.
import { Rng } from "@/engine/rng";
import type { Team } from "@/engine/types";
import { datesOn, proCalendar } from "../calendar";
import type { ScheduledGame } from "../types";

export const GAMES_PER_TEAM = 82;
export const DEV_GAMES = 30;

/** Lines a conference up so a team's division is its position mod 3: the 4-game opponents then form an even pattern. */
function conferenceOrder(teams: Team[]) {
  const divisions = [...new Set(teams.map((t) => t.divisionId))];
  const byDiv = divisions.map((d) => teams.filter((t) => t.divisionId === d));
  return Array.from({ length: teams.length }, (_, i) => byDiv[i % byDiv.length][Math.floor(i / byDiv.length)]);
}

/** Every matchup of the season as [home, away], before dates are set. */
export function matchups(teams: Team[]): [string, string][] {
  const out: [string, string][] = [];
  const series = (a: string, b: string, aHome: number, bHome: number) => {
    for (let i = 0; i < aHome; i++) out.push([a, b]);
    for (let i = 0; i < bHome; i++) out.push([b, a]);
  };
  const confs = [...new Set(teams.map((t) => t.conferenceId))].map((c) => conferenceOrder(teams.filter((t) => t.conferenceId === c)));
  for (const list of confs) {
    const n = list.length;
    for (let i = 0; i < n; i++)
      for (const d of [1, 2, 3, 4, 5, 6, 7]) {
        const j = (i + d) % n;
        const a = list[i].id,
          b = list[j].id;
        // steps of 3 and 6 are division rivals (4 games), 1, 2 and 4 are 4-game conference foes, 5 and 7 play 3
        if (d === 5 || d === 7) series(a, b, 2, 1);
        else series(a, b, 2, 2);
      }
  }
  const [east, west] = confs;
  for (const a of east) for (const b of west) series(a.id, b.id, 1, 1);
  return out;
}

export function generateProSchedule(teams: Team[], year: number, seed: number | string = year): ScheduledGame[] {
  const cal = proCalendar(year);
  const rng = new Rng(`pro-schedule:${seed}:${year}`);
  const dates = datesOn(cal.opening, cal.lastGame, [0, 1, 2, 3, 4, 5, 6]).filter((d) => Math.abs(Date.parse(d) - Date.parse(cal.allStar)) > 3 * 86_400_000);
  let queue = rng.shuffle(matchups(teams));
  const games: ScheduledGame[] = [];
  const left = new Map(teams.map((t) => [t.id, GAMES_PER_TEAM]));
  dates.forEach((date, i) => {
    const busy = new Set<string>();
    const rest: [string, string][] = [];
    const remaining = dates.length - i;
    // teams furthest behind pace go first so everyone finishes by the last day
    queue = [...queue].sort((a, b) => Math.max(left.get(b[0])!, left.get(b[1])!) - Math.max(left.get(a[0])!, left.get(a[1])!));
    const cap = Math.max(4, Math.ceil(queue.length / remaining) + 1);
    let booked = 0;
    for (const [h, a] of queue) {
      if (booked < cap && !busy.has(h) && !busy.has(a)) {
        busy.add(h);
        busy.add(a);
        games.push({ id: `p${year}-${games.length.toString(36)}`, date, level: "pro", homeId: h, awayId: a, kind: "region" });
        left.set(h, left.get(h)! - 1);
        left.set(a, left.get(a)! - 1);
        booked++;
      } else rest.push([h, a]);
    }
    queue = rest;
  });
  return games;
}

/** A development league season: 30 games against other affiliates, one team per pro club. */
export function generateDevSchedule(teams: Team[], teamId: string, year: number, seed: number | string): ScheduledGame[] {
  const cal = proCalendar(year);
  const rng = new Rng(`dev-schedule:${seed}:${year}`);
  const dates = datesOn(cal.opening, cal.lastGame, [2, 5]);
  const others = teams.filter((t) => t.id !== teamId);
  const step = (dates.length - 1) / Math.max(1, DEV_GAMES - 1);
  return Array.from({ length: Math.min(DEV_GAMES, dates.length) }, (_, i) => {
    const opp = others[i % others.length].id;
    const home = rng.chance(0.5);
    return {
      id: `dev${year}-${i}`,
      date: dates[Math.round(i * step)],
      level: "pro" as const,
      homeId: home ? teamId : opp,
      awayId: home ? opp : teamId,
      kind: "nonregion" as const,
      label: "Development league",
    };
  });
}
