// Varsity schedules for every Arizona school in a season: region round robins after the new year,
// non-region games before it, and a holiday tournament (4-team pools) between Christmas and New Year's.
import { Rng } from "@/engine/rng";
import type { Team } from "@/engine/types";
import { datesOn, hsCalendar, iso } from "../calendar";
import type { IsoDate, ScheduledGame } from "../types";

/** Regular-season games each team aims for, not counting the holiday tournament. */
export const REGULAR_TARGET = 18;
export const HOLIDAY_GAMES = 3;
/** Regions this big play each other once; smaller ones play home and away. */
export const SINGLE_ROUND_ROBIN_FROM = 8;

const CLASS_ORDER = ["6A", "5A", "4A", "3A", "2A", "1A"];

/** Circle-method round robin. Returns rounds of [home, away] pairs; odd team counts get a bye each round. */
export function roundRobin<T>(items: T[]): [T, T][][] {
  const list: (T | null)[] = [...items];
  if (list.length % 2) list.push(null);
  const n = list.length;
  const rounds: [T, T][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [T, T][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i],
        b = list[n - 1 - i];
      if (a !== null && b !== null) pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    list.splice(1, 0, list.pop()!); // rotate everyone but the first
  }
  return rounds;
}

/** Spreads `count` dates as evenly as possible over the available ones. */
function spread(dates: IsoDate[], count: number): IsoDate[] {
  if (count >= dates.length) return dates.slice(0, count);
  return Array.from({ length: count }, (_, i) => dates[Math.round((i * (dates.length - 1)) / Math.max(1, count - 1))]);
}

const gid = (year: number, n: number) => `g${year}-${n.toString(36)}`;

export const HOLIDAY_NAMES = [
  "Holiday Classic",
  "Winter Invitational",
  "Desert Holiday Tournament",
  "Christmas Classic",
  "New Year's Shootout",
  "Saguaro Classic",
];

export function generateVarsitySchedule(teams: Team[], year: number, seed: number | string = year): ScheduledGame[] {
  const cal = hsCalendar(year);
  const rng = new Rng(`hs-schedule:${seed}`);
  const games: ScheduledGame[] = [];
  let n = 0;
  const busy = new Map<string, Set<IsoDate>>(); // team -> dates with a game
  const count = new Map<string, number>();
  const met = new Set<string>(); // "a|b" non-region pairs already scheduled
  const book = (date: IsoDate, homeId: string, awayId: string, kind: ScheduledGame["kind"], label?: string) => {
    games.push({ id: gid(year, n++), date, level: "varsity", homeId, awayId, kind, ...(label ? { label } : {}) });
    for (const t of [homeId, awayId]) {
      if (!busy.has(t)) busy.set(t, new Set());
      busy.get(t)!.add(date);
      if (kind !== "tournament") count.set(t, (count.get(t) ?? 0) + 1);
    }
  };

  // region play: Tuesdays, Wednesdays and Fridays from early January to mid-February
  const regionDates = datesOn(cal.regionStart, cal.lastRegular, [2, 3, 5]);
  const regions = new Map<string, Team[]>();
  for (const t of teams) regions.set(t.conferenceId, [...(regions.get(t.conferenceId) ?? []), t]);
  for (const members of regions.values()) {
    const ids = rng.shuffle(members.map((t) => t.id));
    const first = roundRobin(ids);
    const rounds = ids.length >= SINGLE_ROUND_ROBIN_FROM ? first : [...first, ...first.map((r) => r.map(([h, a]) => [a, h] as [string, string]))];
    const dates = spread(regionDates, rounds.length);
    rounds.forEach((pairs, i) => pairs.forEach(([h, a]) => book(dates[i], h, a, "region")));
  }

  // holiday tournament: every school plays three games in a 4-team pool of nearby classes
  const holidayDates = [cal.holidayStart, iso(year, 12, 28), iso(year, 12, 29)];
  const byClass = [...teams].sort((a, b) => CLASS_ORDER.indexOf(a.tier!) - CLASS_ORDER.indexOf(b.tier!) || rng.next() - 0.5);
  for (let i = 0; i < byClass.length; i += 4) {
    const pool = byClass.slice(i, i + 4).map((t) => t.id);
    if (pool.length < 2) break;
    const name = `${rng.pick(HOLIDAY_NAMES)}`;
    roundRobin(pool).forEach((pairs, r) => pairs.forEach(([h, a]) => book(holidayDates[r], h, a, "tournament", name)));
  }

  // non-region: Tuesdays and Fridays from Thanksgiving week to just before the holidays, plus early January
  const nonRegionDates = [...datesOn(cal.firstGame, iso(year, 12, 20), [2, 5]), ...datesOn(iso(year + 1, 1, 1), iso(year + 1, 1, 4), [5])];
  const classIdx = new Map(teams.map((t) => [t.id, CLASS_ORDER.indexOf(t.tier!)]));
  const regionOf = new Map(teams.map((t) => [t.id, t.conferenceId]));
  // a second pass on Thursdays and Saturdays catches schools in tiny regions that still need games
  const extraDates = [...datesOn(cal.firstGame, iso(year, 12, 20), [4, 6]), ...datesOn(cal.regionStart, cal.lastRegular, [6])];
  const passes: [IsoDate[], number][] = [
    [nonRegionDates, 1],
    [extraDates, 2],
    // last resort for the most isolated schools: any free weekday before region play, any classification
    [datesOn(cal.firstGame, iso(year, 12, 23), [1, 3]), 5],
  ];
  for (const [dates, maxGap] of passes)
    for (const date of dates) {
      const need = rng.shuffle(teams.filter((t) => (count.get(t.id) ?? 0) < REGULAR_TARGET && !busy.get(t.id)?.has(date)).map((t) => t.id));
      // in the last-resort pass, schools already at their target can take one or two extra games as the opponent
      const hosts =
        maxGap >= 5 ? rng.shuffle(teams.filter((t) => (count.get(t.id) ?? 0) < REGULAR_TARGET + 2 && !busy.get(t.id)?.has(date)).map((t) => t.id)) : need;
      const taken = new Set<string>();
      for (const a of need) {
        if (taken.has(a)) continue;
        // nearest classification first, never a region rival (they meet in region play)
        const b = hosts
          .filter((x) => x !== a && !taken.has(x) && regionOf.get(x) !== regionOf.get(a) && !met.has([a, x].sort().join("|")))
          .sort((x, y) => Math.abs(classIdx.get(x)! - classIdx.get(a)!) - Math.abs(classIdx.get(y)! - classIdx.get(a)!))[0];
        if (!b || Math.abs(classIdx.get(b)! - classIdx.get(a)!) > maxGap) continue;
        taken.add(a);
        taken.add(b);
        met.add([a, b].sort().join("|"));
        const homeFirst = rng.chance(0.5);
        book(date, homeFirst ? a : b, homeFirst ? b : a, "nonregion");
      }
    }
  return games.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Games for one team, in date order. */
export const teamGames = (games: ScheduledGame[], teamId: string) => games.filter((g) => g.homeId === teamId || g.awayId === teamId);
