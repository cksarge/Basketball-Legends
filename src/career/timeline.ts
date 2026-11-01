// A career seen as a whole: season-by-season numbers, this season's games, the calendar, and goals to chase.
import { playerOvr } from "@/engine/player";
import { collegeCalendar, draftCalendar, hsCalendar, proCalendar } from "./calendar";
import { currentCollege } from "./college/season";
import { averages, currentSeason, userGames, type HsContext } from "./hs/season";
import { legendStatus, RANKS } from "./legend";
import { HALL_OF_FAME_POINTS, careerTotals } from "./pro/retire";
import { currentPro, userProGames } from "./pro/season";
import { contactDate, cumulativeGpa, earlySigning } from "./recruiting";
import type { Career, HsLevel, IsoDate, ScheduledGame } from "./types";

export interface SeasonRow {
  key: string;
  label: string;
  stage: "High school" | "College" | "Pro";
  gp: number;
  ppg: number;
  rpg: number;
  apg: number;
  mpg: number;
  ovr?: number;
}

const yearLabel = (y: number) => `${String(y).slice(2)}-${String(y + 1).slice(2)}`;

/** Every season you played, oldest first. High school uses the highest level you reached that year. */
export function seasonRows(c: Career): SeasonRow[] {
  const out: SeasonRow[] = [];
  const ovr = (year: number) => c.history?.find((h) => h.year === year)?.ovr;
  const add = (key: string, y: number, stage: SeasonRow["stage"], t: Parameters<typeof averages>[0]) => {
    const a = averages(t);
    if (a) out.push({ key, label: yearLabel(y), stage, gp: a.gp, ppg: a.ppg, rpg: a.rpg, apg: a.apg, mpg: a.mpg, ovr: ovr(y) });
  };
  for (const s of c.hs.seasons) {
    const level = (["varsity", "jv", "frso"] as HsLevel[]).find((l) => s.stats[l]?.gp);
    if (level) add(`hs-${s.year}`, s.year, "High school", s.stats[level]);
  }
  for (const s of c.college?.seasons ?? []) add(`col-${s.year}`, s.year, "College", s.stats);
  for (const s of c.pro?.seasons ?? []) add(`pro-${s.year}`, s.year, "Pro", s.stats);
  return out;
}

/** Your current season's games in order. */
export function seasonGames(c: Career): ScheduledGame[] {
  if (c.stage === "pro" || c.stage === "retired") {
    const s = currentPro(c);
    return s ? userProGames(s) : [];
  }
  if (c.stage === "college") {
    const s = currentCollege(c);
    return (s?.games ?? []).filter((g) => g.homeId === s!.teamId || g.awayId === s!.teamId);
  }
  const s = currentSeason(c);
  return s ? userGames(s) : [];
}

/** The team you play for at the stage you're at. */
export function currentTeamId(c: Career) {
  if (c.stage === "pro" || c.stage === "retired") return currentPro(c)?.teamId ?? c.player.teamId;
  if (c.stage === "college") return currentCollege(c)?.teamId ?? c.player.teamId;
  return currentSeason(c)?.schoolId ?? c.hs.schoolId;
}

/** Your points in each game this season. */
export const gameLog = (c: Career) =>
  seasonGames(c)
    .filter((g) => g.result?.userLine && g.kind !== "allstar")
    .map((g, i) => ({
      n: i + 1,
      date: g.date,
      pts: g.result!.userLine!.pts,
      reb: g.result!.userLine!.oreb + g.result!.userLine!.dreb,
      ast: g.result!.userLine!.ast,
    }));

export interface CalendarItem {
  date: IsoDate;
  label: string;
  kind: "game" | "key";
  result?: "W" | "L";
  score?: string;
}

/** Everything on the calendar this year: your games and the dates that matter. */
export function calendarItems(c: Career, ctx: HsContext): CalendarItem[] {
  const out: CalendarItem[] = [];
  const key = (date: IsoDate, label: string) => out.push({ date, label, kind: "key" });
  const teamId = currentTeamId(c);
  const name = (id: string) => (ctx.byId.get(id) ?? ctx.collegeById?.get(id) ?? ctx.proById?.get(id))?.abbrev ?? "All-Star";
  for (const g of seasonGames(c)) {
    const home = g.homeId === teamId;
    const r = g.result;
    const won = r ? home === r.home > r.away : undefined;
    out.push({
      date: g.date,
      kind: "game",
      label: `${home || g.neutral ? "vs" : "at"} ${name(home ? g.awayId : g.homeId)}`,
      ...(r ? { result: won ? ("W" as const) : ("L" as const), score: home ? `${r.home}-${r.away}` : `${r.away}-${r.home}` } : {}),
    });
  }
  if (c.stage === "pro") {
    const s = currentPro(c);
    if (s) {
      const cal = proCalendar(s.year);
      key(cal.opening, "Opening night");
      key(cal.tradeDeadline, "Trade deadline");
      key(cal.allStar, "All-Star Sunday");
      key(cal.playoffs, "Playoffs begin");
    } else if (c.pro) {
      const d = draftCalendar(c.pro.preDraft.year);
      key(d.combine, "The combine");
      key(d.workouts, "Team workouts");
      key(d.interviews, "GM interviews");
      key(d.draft, "Draft night");
    }
  } else if (c.stage === "college") {
    const s = currentCollege(c);
    if (s) {
      const cal = collegeCalendar(s.year);
      key(cal.firstGame, "First game");
      key(cal.conferenceStart, "Conference play");
      key(cal.conferenceTournament[0], "Conference tournament");
      key(cal.selection, "Selection Sunday");
      key(cal.national[6], "National championship");
    }
  } else if (c.stage === "hs") {
    const s = currentSeason(c);
    const year = s?.year ?? c.startYear;
    const cal = hsCalendar(year);
    key(cal.tryouts, "Tryouts");
    key(cal.fallGrades, "Fall finals");
    key(cal.regionStart, "Region play");
    key(cal.playoffRounds[0], "State playoffs");
    key(cal.springGrades, "Spring finals");
    key(cal.summerCamp, "Summer camp");
    key(cal.showcase, "AAU showcase");
    if (s?.grade === 10) key(contactDate(c.startYear), "Recruiting opens");
    if (s?.grade === 12) key(earlySigning(s.year), "Early signing day");
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export interface Goal {
  label: string;
  done: boolean;
  /** Where you stand, when it's a number. */
  progress?: { value: number; of: number };
}

export interface GoalGroup {
  stage: string;
  goals: Goal[];
}

/** What to chase at every stage of a career. Everything here is read from what you've done. */
export function careerGoals(c: Career): GoalGroup[] {
  const hsAwards = c.hs.seasons.flatMap((s) => s.awards);
  const colAwards = (c.college?.seasons ?? []).flatMap((s) => s.awards);
  const proAwards = (c.pro?.seasons ?? []).flatMap((s) => s.awards);
  const has = (list: string[], re: RegExp) => list.some((a) => re.test(a));
  const stars = Math.max(0, ...c.hs.seasons.map((s) => s.ranking?.stars ?? 0));
  const gpa = cumulativeGpa(c);
  const st = legendStatus(c);
  const t = careerTotals(c);
  const pick = c.pro?.draft?.picks.find((p) => p.isUser)?.pick;
  const rankAt = RANKS.indexOf(st.rank);
  return [
    {
      stage: "High school",
      goals: [
        { label: "Make varsity", done: c.hs.seasons.some((s) => s.stats.varsity?.gp) },
        { label: "Make varsity as an underclassman", done: c.hs.seasons.some((s) => s.grade <= 10 && s.stats.varsity?.gp) },
        { label: "All-Region", done: has(hsAwards, /Region (First|Second) Team$/) },
        { label: "All-State", done: has(hsAwards, /^All-State/) },
        { label: "Win a state title", done: has(hsAwards, /(State|Open Division) champion$/) },
        { label: "Become a 4-star recruit", done: stars >= 4, progress: { value: Math.min(stars, 4), of: 4 } },
        { label: "Become a 5-star recruit", done: stars >= 5, progress: { value: stars, of: 5 } },
        { label: "Graduate with a 3.5 GPA", done: c.stage !== "hs" && gpa !== null && gpa >= 3.5 },
      ],
    },
    {
      stage: "College",
      goals: [
        { label: "Earn a starting job", done: (c.college?.seasons ?? []).some((s) => s.stats.gs > 0) },
        { label: "All-Conference", done: has(colAwards, /^All-.* (First|Second) Team$/) },
        { label: "Win your conference tournament", done: has(colAwards, /Tournament champion$/) },
        { label: "All-American", done: has(colAwards, /All-American/) },
        { label: "Win a national title", done: has(colAwards, /National champion$/) },
        { label: "National Player of the Year", done: has(colAwards, /National Player of the Year/) },
      ],
    },
    {
      stage: "The pros",
      goals: [
        { label: "Get drafted", done: !!pick },
        { label: "Go in the first round", done: !!pick && pick <= 30 },
        { label: "All-Star", done: t.allStars > 0 },
        { label: "All-League", done: has(proAwards, /^All-League/) },
        { label: "Win a championship", done: t.rings > 0 },
        { label: "Most Valuable Player", done: t.mvps > 0 },
        { label: "10,000 career points", done: t.pts >= 10_000, progress: { value: Math.min(t.pts, 10_000), of: 10_000 } },
        { label: "20,000 career points", done: t.pts >= 20_000, progress: { value: Math.min(t.pts, 20_000), of: 20_000 } },
      ],
    },
    {
      stage: "The Road to Legend",
      goals: [
        { label: "Superstar", done: rankAt >= RANKS.indexOf("Superstar") },
        { label: "Icon", done: rankAt >= RANKS.indexOf("Icon") },
        { label: "Hall of Fame", done: !!c.retirement?.hallOfFame, progress: { value: Math.min(st.points, HALL_OF_FAME_POINTS), of: HALL_OF_FAME_POINTS } },
        { label: "Basketball Legend", done: !!c.retirement?.legend },
      ],
    },
  ];
}

/** Keeps one overall rating per year, for the rating chart. */
export function trackHistory(c: Career): Career {
  const year = +c.date.slice(0, 4) - (+c.date.slice(5, 7) >= 8 ? 0 : 1);
  const ovr = playerOvr(c.player);
  const list = c.history ?? [];
  const last = list.at(-1);
  const best = ovr > (c.peak?.ovr ?? 0);
  if (last?.year === year && last.ovr === ovr && !best) return c;
  return { ...c, history: [...list.filter((h) => h.year !== year), { year, ovr }], ...(best ? { peak: { ovr, ratings: c.player.ratings } } : {}) };
}
