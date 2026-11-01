// Calendar days as "YYYY-MM-DD" strings, done in UTC so time zones never shift a date,
// and the Arizona high school basketball calendar.
import type { IsoDate } from "./types";

const DAY = 86_400_000;
const toMs = (d: IsoDate) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fromMs = (ms: number): IsoDate => new Date(ms).toISOString().slice(0, 10);

export const iso = (y: number, m: number, d: number): IsoDate => fromMs(Date.UTC(y, m - 1, d));
export const addDays = (d: IsoDate, n: number): IsoDate => fromMs(toMs(d) + n * DAY);
export const daysBetween = (a: IsoDate, b: IsoDate) => Math.round((toMs(b) - toMs(a)) / DAY);
/** 0 = Sunday … 6 = Saturday. */
export const weekday = (d: IsoDate) => new Date(toMs(d)).getUTCDay();
export const isBefore = (a: IsoDate, b: IsoDate) => a < b;
export const maxDate = (a: IsoDate, b: IsoDate) => (a > b ? a : b);

/** The first given weekday on or after a date. */
export function onOrAfter(d: IsoDate, dow: number): IsoDate {
  return addDays(d, (dow - weekday(d) + 7) % 7);
}

/** Every date from `from` to `to` (inclusive) that falls on one of the weekdays. */
export function datesOn(from: IsoDate, to: IsoDate, dows: number[]): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (dows.includes(weekday(d))) out.push(d);
  return out;
}

/**
 * Key dates of an Arizona high school basketball season (boys), modelled on the AIA calendar:
 * November tryouts, games from Thanksgiving week to mid-February with region play after the new year,
 * a holiday tournament between Christmas and New Year's, then the state playoffs.
 */
export interface HsCalendar {
  year: number;
  tryouts: IsoDate;
  firstGame: IsoDate;
  holidayStart: IsoDate;
  regionStart: IsoDate;
  lastRegular: IsoDate;
  playIn: IsoDate;
  playoffRounds: IsoDate[]; // round of 16, quarterfinal, semifinal, final
  fallGrades: IsoDate;
  springGrades: IsoDate;
  summerCamp: IsoDate;
  showcase: IsoDate;
  seasonEnd: IsoDate;
}

export function hsCalendar(year: number): HsCalendar {
  const tryouts = onOrAfter(iso(year, 11, 2), 1); // first Monday in November
  const firstGame = onOrAfter(iso(year, 11, 22), 2); // Tuesday of Thanksgiving week or the one after
  const holidayStart = iso(year, 12, 27);
  const regionStart = onOrAfter(iso(year + 1, 1, 5), 2);
  const lastRegular = onOrAfter(iso(year + 1, 2, 10), 5); // second Friday-ish of February
  const playIn = addDays(lastRegular, 4); // Tuesday
  const r16 = addDays(playIn, 3); // Friday
  return {
    year,
    tryouts,
    firstGame,
    holidayStart,
    regionStart,
    lastRegular,
    playIn,
    playoffRounds: [r16, addDays(r16, 4), addDays(r16, 8), addDays(r16, 15)],
    fallGrades: iso(year, 12, 19),
    springGrades: iso(year + 1, 5, 22),
    summerCamp: iso(year + 1, 6, 16),
    showcase: iso(year + 1, 7, 14),
    seasonEnd: addDays(r16, 16),
  };
}

/** Key dates of a college season: conference play from January, conference tournaments, then the national tournaments. */
export interface CollegeCalendar {
  year: number;
  firstGame: IsoDate;
  conferenceStart: IsoDate;
  lastRegular: IsoDate;
  conferenceTournament: IsoDate[];
  selection: IsoDate;
  /** Opening round, 64, 32, regional semifinal, regional final, national semifinal, championship. */
  national: IsoDate[];
  invitational: IsoDate[];
  seasonEnd: IsoDate;
}

export function collegeCalendar(year: number): CollegeCalendar {
  const firstGame = onOrAfter(iso(year, 11, 4), 1); // first Monday on or after November 4
  const conferenceStart = onOrAfter(iso(year + 1, 1, 2), 2);
  const selection = onOrAfter(iso(year + 1, 3, 12), 0); // Sunday
  const lastRegular = addDays(selection, -8); // the Saturday before tournament week
  const national = [2, 4, 6, 11, 13, 19, 21].map((d) => addDays(selection, d));
  return {
    year,
    firstGame,
    conferenceStart,
    lastRegular,
    conferenceTournament: [3, 4, 5, 6].map((d) => addDays(lastRegular, d)),
    selection,
    national,
    invitational: [3, 5, 10, 17, 19].map((d) => addDays(selection, d)),
    seasonEnd: addDays(selection, 23),
  };
}

/** Key dates of the pre-draft process, by the year of the draft. */
export const draftCalendar = (year: number) => ({
  combine: iso(year, 5, 12),
  workouts: iso(year, 6, 2),
  interviews: iso(year, 6, 16),
  draft: onOrAfter(iso(year, 6, 22), 4),
});

/** The school year a date belongs to (fall year): Aug 1 starts a new one. */
export function schoolYearOf(d: IsoDate) {
  const y = +d.slice(0, 4);
  return +d.slice(5, 7) >= 8 ? y : y - 1;
}
