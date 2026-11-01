// A season's games for one college division: conference play from January, non-conference games before it.
import { Rng } from "@/engine/rng";
import type { Team } from "@/engine/types";
import { collegeCalendar, datesOn } from "../calendar";
import { roundRobin } from "../hs/schedule";
import type { IsoDate, ScheduledGame } from "../types";

/** Regular-season games each team aims for. */
export const COLLEGE_TARGET = 30;
export const MAX_CONFERENCE_GAMES = 20;

/** Spreads rounds evenly across the available dates. */
const spread = (dates: IsoDate[], count: number) =>
  Array.from({ length: count }, (_, i) => dates[Math.round((i * (dates.length - 1)) / Math.max(1, count - 1))]);

/** `kind: "region"` marks conference games, so the high school standings code counts them as league play. */
export function generateCollegeSchedule(teams: Team[], year: number, seed: number | string = year): ScheduledGame[] {
  const cal = collegeCalendar(year);
  const rng = new Rng(`college-schedule:${seed}:${teams[0]?.tier}`);
  const games: ScheduledGame[] = [];
  const busy = new Map<string, Set<IsoDate>>(teams.map((t) => [t.id, new Set()]));
  const count = new Map<string, number>(teams.map((t) => [t.id, 0]));
  const met = new Set<string>();
  const book = (date: IsoDate, homeId: string, awayId: string, kind: ScheduledGame["kind"], label?: string) => {
    games.push({ id: `c${year}-${teams[0].tier}-${games.length.toString(36)}`, date, level: "college", homeId, awayId, kind, ...(label ? { label } : {}) });
    for (const t of [homeId, awayId]) {
      busy.get(t)!.add(date);
      count.set(t, count.get(t)! + 1);
    }
  };

  const conferences = new Map<string, Team[]>();
  for (const t of teams) conferences.set(t.conferenceId, [...(conferences.get(t.conferenceId) ?? []), t]);
  const conferenceDates = datesOn(cal.conferenceStart, cal.lastRegular, [2, 3, 6]);
  for (const members of conferences.values()) {
    const first = roundRobin(rng.shuffle(members.map((t) => t.id)));
    // home and away against everyone, cut off at a full conference slate
    const rounds = [...first, ...first.map((r) => r.map(([h, a]) => [a, h] as [string, string]))].slice(0, MAX_CONFERENCE_GAMES);
    const dates = spread(conferenceDates, rounds.length);
    rounds.forEach((pairs, i) => pairs.forEach(([h, a]) => book(dates[i], h, a, "region")));
  }

  // non-conference: teams pair up with programs near their level, and the bigger program usually hosts
  const dates = datesOn(cal.firstGame, `${year}-12-22`, [1, 4, 6]);
  for (const date of dates) {
    const open = teams
      .filter((t) => count.get(t.id)! < COLLEGE_TARGET && !busy.get(t.id)!.has(date))
      .map((t) => ({ t, k: t.prestige + rng.normal(0, 0.18) }))
      .sort((a, b) => b.k - a.k)
      .map((x) => x.t);
    const used = new Set<string>();
    for (let i = 0; i < open.length; i++) {
      const a = open[i];
      if (used.has(a.id)) continue;
      const b = open.slice(i + 1, i + 12).find((x) => !used.has(x.id) && x.conferenceId !== a.conferenceId && !met.has([a.id, x.id].sort().join("|")));
      if (!b) continue;
      used.add(a.id);
      used.add(b.id);
      met.add([a.id, b.id].sort().join("|"));
      const aHosts = a.prestige >= b.prestige ? rng.chance(0.75) : rng.chance(0.25);
      book(
        date,
        aHosts ? a.id : b.id,
        aHosts ? b.id : a.id,
        "nonregion",
        date.slice(5) >= "11-22" && date.slice(5) <= "11-30" ? "Thanksgiving Classic" : undefined,
      );
    }
  }
  return games.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
