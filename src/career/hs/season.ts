// The high school career loop: seasons, tryouts, simulating the league, your games, call-ups,
// XP, awards and the move to the next school year. Pure functions over the Career save.
import { overall, playerOvr } from "@/engine/player";
import { Rng, clamp } from "@/engine/rng";
import type { ClassYear, Player, Team } from "@/engine/types";
import { addLine, emptyLine, gameScore, type BoxScore, type StatLine } from "@/game/sim/stats";
import { pickStarters, type MatchSetup } from "@/game/sim/match";
import { addDays, hsCalendar, iso } from "../calendar";
import { heightAtAge, weightAtAge } from "../create";
import { LEVEL_LABEL, LEVEL_SHORT, formatDate } from "../format";
import type { Career, CareerLogEntry, GameResult, HsLevel, HsSeason, InboxMessage, IsoDate, ScheduledGame, TryoutResult } from "../types";
import { advanceBracket, bracketFor, createBrackets, winnerOf } from "./playoffs";
import { estimatedStrength, levelRoster, rollRosters, rosterStrength, schoolLevels } from "./rosters";
import { generateVarsitySchedule } from "./schedule";
import { simScore, standings } from "./sim";
import { ELIGIBLE_GPA, gpaLabel, practiceMultiplier, semesterGpa } from "./academics";
import { rankCareer, rankingText } from "./rankings";
import { refreshRecruiting } from "../recruiting";
import { CAMPS, attendCamp, campDate, clubRoster, scheduleShowcase, showcaseExposure, showcaseFor } from "./summer";

export interface HsContext {
  teams: Team[];
  byId: Map<string, Team>;
  /** College programs, for recruiting (optional so pure high school tests can skip them). */
  colleges?: Team[];
  collegeById?: Map<string, Team>;
}
export const hsContext = (teams: Team[], colleges?: Team[]): HsContext => ({
  teams,
  byId: new Map(teams.map((t) => [t.id, t])),
  colleges,
  collegeById: colleges ? new Map(colleges.map((t) => [t.id, t])) : undefined,
});

/** Recruiting refresh, when the context knows the colleges. */
export const recruitStep = (c: Career, ctx: HsContext, date: IsoDate) => (ctx.colleges ? refreshRecruiting(c, ctx.colleges, date) : c);

const GRADE_CLASS: Record<number, ClassYear> = { 9: "FR", 10: "SO", 11: "JR", 12: "SR" };
export const XP_PER_POINT = 40;
/** Share of the remaining gap to each cap closed per week of natural development (about +6-8 overall a year for a freshman). */
export const DEV_RATE = 0.0034;

/**
 * Natural development: every rating grows toward its cap, faster with more room, a good work ethic and youth.
 * Applied in chunks of at least four weeks; fractional gains round randomly (seeded) so nothing is lost on average.
 */
export function develop(c: Career, date: IsoDate): Career {
  const p = c.player;
  const from = p.devDate ?? iso(c.startYear, 8, 1);
  const weeks = Math.floor((Date.parse(date) - Date.parse(from)) / (7 * 86_400_000));
  if (weeks < 4) return c;
  const rng = new Rng(`${c.seed}:dev:${date}`);
  const youth = p.age <= 16 ? 1.1 : p.age <= 18 ? 1 : p.age <= 22 ? 0.85 : p.age <= 27 ? 0.5 : 0.15;
  const ethic = 0.75 + p.traits.workEthic * 0.5;
  const share = 1 - Math.pow(1 - DEV_RATE * youth * ethic, weeks);
  const ratings = { ...p.ratings };
  for (const k of Object.keys(ratings) as (keyof typeof ratings)[]) {
    const gain = Math.max(0, p.caps[k] - ratings[k]) * share;
    ratings[k] = Math.min(p.caps[k], ratings[k] + Math.floor(gain) + (rng.next() < gain % 1 ? 1 : 0));
  }
  const devDate = addDays(from, weeks * 7);
  return { ...c, player: { ...p, ratings, devDate } };
}

export const currentSeason = (c: Career): HsSeason | undefined => c.hs.seasons[c.hs.seasons.length - 1];
export const gradeFor = (c: Career, year: number) => (9 + (year - c.startYear)) as 9 | 10 | 11 | 12;

const msg = (date: IsoDate, from: string, subject: string, body: string): InboxMessage => ({
  id: `m-${date}-${Math.random().toString(36).slice(2, 8)}`,
  date,
  from,
  subject,
  body,
  read: false,
});
const log = (date: IsoDate, text: string, kind: CareerLogEntry["kind"] = "milestone"): CareerLogEntry => ({ date, text, kind });

/** Your school's games at one level (derived from its varsity schedule against opponents who field that level). */
function lowerLevelGames(varsity: ScheduledGame[], school: Team, level: HsLevel, ctx: HsContext): ScheduledGame[] {
  return varsity
    .filter((g) => (g.homeId === school.id || g.awayId === school.id) && g.kind !== "playoff")
    .filter((g) => {
      const opp = ctx.byId.get(g.homeId === school.id ? g.awayId : g.homeId);
      return opp && schoolLevels(opp).includes(level);
    })
    .map((g) => ({ ...g, id: `${g.id}-${level}`, level, kind: g.kind === "tournament" ? ("nonregion" as const) : g.kind, label: undefined }));
}

/** Starts a school year: rosters (carried over from last year), every varsity schedule, your school's lower-level games. */
export function startSeason(c: Career, year: number, ctx: HsContext): Career {
  const school = ctx.byId.get(c.hs.schoolId)!;
  const prev = currentSeason(c);
  const levels = schoolLevels(school);
  const rosters =
    prev && prev.schoolId === school.id ? rollRosters(school, prev.rosters, year) : Object.fromEntries(levels.map((l) => [l, levelRoster(school, l, year)]));
  const varsity = generateVarsitySchedule(ctx.teams, year, `${c.seed}:${year}`);
  const lower = levels.filter((l) => l !== "varsity").flatMap((l) => lowerLevelGames(varsity, school, l, ctx));
  const grade = gradeFor(c, year);
  const season: HsSeason = {
    year,
    grade,
    schoolId: school.id,
    level: levels[0],
    moves: [],
    rosters,
    games: [...varsity, ...lower].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    stats: {},
    awards: [],
    grades: {},
    focus: prev?.focus ?? 0.5,
  };
  const age = c.player.age;
  const player = {
    ...c.player,
    classYear: GRADE_CLASS[grade],
    heightIn: heightAtAge(c.player.body.adultHeightIn, age),
    weightLb: weightAtAge(c.player.body.weightLb, age),
    wingspanIn: heightAtAge(c.player.body.wingspanIn, age),
    teamId: school.id,
  };
  return { ...c, player, hs: { ...c.hs, seasons: [...c.hs.seasons, season] } };
}

/** Overall of the player in the last regular rotation spot (8th best) on a roster: the bar to play real minutes at that level. */
export function levelCutoff(roster: Player[]) {
  const ovrs = roster.map(playerOvr).sort((a, b) => b - a);
  return ovrs[Math.min(7, ovrs.length - 1)] ?? 0;
}

/**
 * Tryout placement. `drillBonus` (-4..+4) comes from the tryout drills; seniors always make varsity,
 * juniors never play freshman/sophomore, and a school without a lower level starts you on the next one up.
 */
export function placeAtTryout(c: Career, ctx: HsContext, drillBonus = 0, rng = new Rng(`${c.seed}:tryout:${c.date}`)): TryoutResult {
  const s = currentSeason(c)!;
  const school = ctx.byId.get(s.schoolId)!;
  const levels = schoolLevels(school);
  const ovr = playerOvr(c.player);
  const eff = ovr + clamp(drillBonus, -4, 4) + rng.normal(0, 1);
  const cut = (l: HsLevel) => (s.rosters[l] ? levelCutoff(s.rosters[l]!) : 0);
  let level: HsLevel;
  if (!levels.includes("jv") && !levels.includes("frso")) level = "varsity";
  else if (s.grade === 12 || eff >= cut("varsity")) level = "varsity";
  else if (levels.includes("jv") && (s.grade === 11 || eff >= cut("jv") || !levels.includes("frso"))) level = "jv";
  else level = levels.includes("frso") ? "frso" : "jv";
  const score = Math.round(clamp(55 + (eff - cut(levels.includes("jv") ? "jv" : "varsity")) * 4 + drillBonus * 3, 5, 99));
  const note =
    level === "varsity"
      ? s.grade <= 10
        ? `You made varsity as a ${s.grade === 9 ? "freshman" : "sophomore"}. That almost never happens here. Earn your minutes.`
        : "You're on varsity. Compete every day and the minutes will come."
      : level === "jv"
        ? "You'll start on JV. Play well and you'll get a look with varsity."
        : "You're on the freshman/sophomore team. Dominate there and we'll move you up.";
  return { date: c.date, score, level, note };
}

export function applyTryout(c: Career, t: TryoutResult): Career {
  const s = currentSeason(c)!;
  const seasons = [...c.hs.seasons.slice(0, -1), { ...s, tryout: t, level: t.level }];
  return {
    ...c,
    hs: { ...c.hs, seasons },
    inbox: [...c.inbox, msg(t.date, "Coach", `Tryout results: ${LEVEL_LABEL[t.level]}`, t.note)],
    log: [...c.log, log(t.date, `Made the ${LEVEL_LABEL[t.level]} team after tryouts (score ${t.score}).`, "move")],
  };
}

/** Your games this season at your current level (including playoff games your team reached). */
export function userGames(s: HsSeason): ScheduledGame[] {
  return s.games.filter((g) => g.level === s.level && (g.homeId === s.schoolId || g.awayId === s.schoolId));
}

/** Your games you can actually play (not the ones you sit out while academically ineligible). */
export const playableGames = (s: HsSeason) => userGames(s).filter((g) => !s.ineligibleFrom || g.date < s.ineligibleFrom);

export type NextEvent =
  | { kind: "season"; date: IsoDate }
  | { kind: "tryout"; date: IsoDate }
  | { kind: "game"; date: IsoDate; game: ScheduledGame }
  | { kind: "finals"; date: IsoDate; semester: "fall" | "spring" }
  | { kind: "seasonEnd"; date: IsoDate }
  | { kind: "camp"; date: IsoDate }
  | { kind: "showcase"; date: IsoDate; game?: ScheduledGame }
  | { kind: "nextYear"; date: IsoDate }
  | { kind: "graduated"; date: IsoDate };

/** What the career is waiting on next. */
export function nextEvent(c: Career): NextEvent {
  const s = currentSeason(c);
  const year = s?.year ?? c.startYear;
  if (!s) return { kind: "season", date: iso(c.startYear, 8, 1) };
  const cal = hsCalendar(year);
  if (!s.tryout) return { kind: "tryout", date: cal.tryouts };
  const next = playableGames(s).find((g) => !g.result);
  // fall finals come before the first game after them
  if (!s.grades.fall && (!next || next.date > cal.fallGrades)) return { kind: "finals", date: cal.fallGrades, semester: "fall" };
  if (next) return { kind: "game", date: next.date, game: next };
  if (!s.wrapped) return { kind: "seasonEnd", date: cal.seasonEnd };
  if (!s.grades.spring) return { kind: "finals", date: cal.springGrades, semester: "spring" };
  if (s.grade === 12 || c.recruiting?.reclassified) return { kind: "graduated", date: iso(year + 1, 5, 28) };
  if (!s.summer?.camp) return { kind: "camp", date: campDate(year) };
  // AAU showcase: first pick up the club (no game yet), then play its games
  if (!s.summer.showcase) return { kind: "showcase", date: campDate(year) };
  const show = s.summer.showcase.find((g) => !g.result);
  if (show) return { kind: "showcase", date: show.date, game: show };
  return { kind: "nextYear", date: iso(year + 1, 8, 1) };
}

function teamStrength(s: HsSeason, teamId: string, level: HsLevel, ctx: HsContext, c: Career) {
  if (teamId === s.schoolId) {
    const roster = [...(s.rosters[level] ?? [])];
    if (s.level === level) roster.push(c.player);
    return rosterStrength(roster);
  }
  return estimatedStrength(ctx.byId.get(teamId)!, level, s.year);
}

/** A game the career waits on you to play or sim (your level, your school, while eligible). */
const isUserGame = (s: HsSeason, g: ScheduledGame) =>
  g.level === s.level && (g.homeId === s.schoolId || g.awayId === s.schoolId) && (!s.ineligibleFrom || g.date < s.ineligibleFrom);

/**
 * Simulates every game up to and including `date` except your own, creates and advances playoff brackets,
 * awards XP for practice time, and moves the career date forward. Never passes one of your unplayed games.
 */
export function advanceTo(c: Career, date: IsoDate, ctx: HsContext): Career {
  let s = currentSeason(c);
  if (!s) return { ...c, date };
  let until = date;
  // playoff rounds appear as results come in, so repeat until no new game of yours turns up before the target
  for (let guard = 0; guard < 24; guard++) {
    const stop = playableGames(s).find((g) => !g.result);
    until = stop && stop.date <= date ? stop.date : date;
    const rng = new Rng(`${c.seed}:sim:${until}:${guard}`);
    const cur: HsSeason = s;
    const games = cur.games.map((g) => {
      if (g.result || g.date > until || isUserGame(cur, g)) return g;
      const lvl = g.level as HsLevel;
      const sitting = lvl === cur.level && (g.homeId === cur.schoolId || g.awayId === cur.schoolId);
      const result = simScore(teamStrength(cur, g.homeId, lvl, ctx, c), teamStrength(cur, g.awayId, lvl, ctx, c), rng, g.neutral);
      return { ...g, result: sitting ? { ...result, dnp: true } : result };
    });
    s = runPlayoffs({ ...cur, games }, ctx, c, until, rng);
    if (playableGames(s).find((g) => !g.result)?.id === stop?.id) break;
  }
  // practice: a little XP for every week that passes during the school year
  const weeks = Math.max(0, Math.floor((Date.parse(until) - Date.parse(c.date)) / (7 * 86_400_000)));
  const practiceXp = Math.round(weeks * (8 + c.player.traits.workEthic * 6) * practiceMultiplier(s.focus ?? 0.5));
  const moved = { ...c, date: until > c.date ? until : c.date, hs: { ...c.hs, seasons: [...c.hs.seasons.slice(0, -1), s] } };
  return develop(withXp(moved, practiceXp, until), until);
}

/** Creates brackets when the regular season is done, then fills in rounds as results arrive (sims non-user playoff games). */
function runPlayoffs(s: HsSeason, ctx: HsContext, c: Career, until: IsoDate, rng: Rng): HsSeason {
  const regularLeft = s.games.some((g) => g.level === "varsity" && g.kind !== "playoff" && !g.result);
  if (regularLeft) return s;
  let games = [...s.games];
  const playoffs = s.playoffs ? s.playoffs.map((b) => ({ ...b, rounds: b.rounds.map((r) => [...r]) })) : createBrackets(ctx.teams, games);
  for (let guard = 0; guard < 12; guard++) {
    const byId = new Map(games.map((g) => [g.id, g]));
    let changed = false;
    for (const b of playoffs) {
      const fresh = advanceBracket(b, byId, s.year);
      if (fresh.length) {
        games.push(...fresh);
        changed = true;
      }
    }
    // sim newly created playoff games up to the date, except yours when you're on varsity
    games = games.map((g) => {
      if (g.result || g.kind !== "playoff" || g.date > until) return g;
      if (isUserGame(s, g)) return g;
      changed = true;
      return { ...g, result: simScore(teamStrength(s, g.homeId, "varsity", ctx, c), teamStrength(s, g.awayId, "varsity", ctx, c), rng, g.neutral) };
    });
    if (!changed) break;
  }
  return { ...s, games, playoffs };
}

function withXp(c: Career, xp: number, date: IsoDate): Career {
  if (xp <= 0) return c;
  const total = c.player.xp + xp;
  const points = Math.floor(total / XP_PER_POINT);
  const extra: Partial<Career> = {};
  if (points > 0)
    extra.inbox = [
      ...c.inbox,
      msg(date, "Trainer", `${points} new skill point${points > 1 ? "s" : ""}`, "Spend them on the Player tab to raise your ratings."),
    ];
  return { ...c, ...extra, player: { ...c.player, xp: total % XP_PER_POINT, skillPoints: c.player.skillPoints + points } };
}

/** Cost in skill points to raise a rating by one: more as you near the cap. */
export function upgradeCost(value: number, cap: number) {
  if (value >= cap) return Infinity;
  return cap - value <= 5 ? 3 : cap - value <= 15 ? 2 : 1;
}

export function spendPoint(c: Career, key: keyof Player["ratings"]): Career {
  const p = c.player;
  const cost = upgradeCost(p.ratings[key], p.caps[key]);
  if (cost > p.skillPoints) return c;
  return { ...c, player: { ...p, skillPoints: p.skillPoints - cost, ratings: { ...p.ratings, [key]: p.ratings[key] + 1 } } };
}

/** The match for one of your games: your level's roster with you on it, against the opponent's roster at that level. */
export function userMatchSetup(c: Career, game: ScheduledGame, ctx: HsContext): MatchSetup & { level: HsLevel } {
  const s = currentSeason(c)!;
  const level = game.level as HsLevel;
  const mine = withUser(s.rosters[level] ?? [], c.player);
  const oppId = game.homeId === s.schoolId ? game.awayId : game.homeId;
  const opp = levelRoster(ctx.byId.get(oppId)!, level, s.year);
  const school = ctx.byId.get(s.schoolId)!;
  const side = (team: Team, roster: Player[]) => ({ team, roster, starters: pickStarters(roster) });
  return {
    league: "hs",
    level,
    home: game.homeId === s.schoolId ? side(school, mine) : side(ctx.byId.get(oppId)!, opp),
    away: game.homeId === s.schoolId ? side(ctx.byId.get(oppId)!, opp) : side(school, mine),
    lockPlayerId: c.player.id,
    difficulty: c.settings.difficulty,
    seed: Math.abs(hashGame(game.id)) % 1_000_000,
  };
}

function hashGame(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}

/** Adds your player to a roster, giving a teammate a new number if one already wears yours. */
export function withUser(roster: Player[], user: Player): Player[] {
  const used = new Set(roster.map((p) => p.jersey));
  const list = roster.map((p) => {
    if (p.jersey !== user.jersey) return p;
    let n = (p.jersey + 10) % 100;
    while (used.has(n) || n === user.jersey) n = (n + 1) % 100;
    used.add(n);
    return { ...p, jersey: n };
  });
  return [...list, user];
}

export interface UserGameOutcome {
  homeScore: number;
  awayScore: number;
  overtimes: number;
  box: BoxScore;
  played: boolean;
  playerOfGame: string | null;
}

/** Records one of your games: result, your line and season totals, XP, a possible call-up or demotion, and the log. */
export function applyUserGame(c: Career, gameId: string, o: UserGameOutcome, ctx: HsContext): Career {
  const s = currentSeason(c)!;
  const game = s.games.find((g) => g.id === gameId);
  if (!game || game.result) return c;
  const mySide = new Set([...(s.rosters[game.level as HsLevel] ?? []).map((p) => p.id), c.player.id]);
  const line = o.box[c.player.id];
  const dnp = !line || line.min < 1;
  const result: GameResult = {
    home: o.homeScore,
    away: o.awayScore,
    played: o.played,
    overtimes: o.overtimes,
    ...(dnp ? { dnp: true } : { userLine: line }),
    box: Object.fromEntries(Object.entries(o.box).filter(([id]) => mySide.has(id))),
    playerOfGame: o.playerOfGame,
  };
  const games = s.games.map((g) => (g.id === gameId ? { ...g, result } : g));
  const level = game.level as HsLevel;
  const prevTotals = s.stats[level] ?? { ...emptyLine(), gp: 0, gs: 0 };
  const started = pickStarters(withUser(s.rosters[level] ?? [], c.player)).includes(c.player.id);
  const totals = dnp ? prevTotals : { ...addLine(prevTotals, line), gp: prevTotals.gp + 1, gs: prevTotals.gs + (started ? 1 : 0) };
  let next: Career = {
    ...c,
    date: game.date,
    hs: { ...c.hs, seasons: [...c.hs.seasons.slice(0, -1), { ...s, games, stats: { ...s.stats, [level]: totals } }] },
  };

  const won = (game.homeId === s.schoolId) === o.homeScore > o.awayScore;
  const gs = dnp ? 0 : gameScore(line);
  const mult = { rookie: 0.8, pro: 1, allstar: 1.15, superstar: 1.3, hof: 1.45, legend: 1.6 }[c.settings.difficulty];
  const xp = Math.round((dnp ? 5 : clamp(15 + gs * 3, 5, 90) + (won ? 10 : 0)) * mult * (o.played ? 1.25 : 1));
  next = withXp(next, xp, game.date);

  // notable games go in the log
  const opp = ctx.byId.get(game.homeId === s.schoolId ? game.awayId : game.homeId);
  if (!dnp && (line.pts >= 25 || (line.pts >= 10 && line.oreb + line.dreb >= 10) || line.ast >= 10))
    next = { ...next, log: [...next.log, log(game.date, `${line.pts} points vs ${opp?.name ?? "opponent"} (${LEVEL_SHORT[level]}).`, "game")] };
  if (game.kind === "playoff") {
    const ourWin = winnerOf({ ...game, result }) === s.schoolId;
    if (game.label?.endsWith("State Championship") && ourWin)
      next = { ...next, log: [...next.log, log(game.date, `Won the ${game.label.replace(" State Championship", "")} state championship!`, "award")] };
  }
  // college coaches check in every few games
  const played = userGames(currentSeason(next)!).filter((g) => g.result).length;
  if (played % 4 === 0) next = recruitStep(next, ctx, game.date);
  return checkLevelMove(next, ctx);
}

/** Coach's mid-season decision after each game: call you up, send you down, or keep you where you are. */
export function checkLevelMove(c: Career, ctx: HsContext): Career {
  const s = currentSeason(c)!;
  const school = ctx.byId.get(s.schoolId)!;
  const levels = schoolLevels(school);
  const idx = levels.indexOf(s.level);
  // only games you were part of at this level (your school's simulated games before you joined it don't count)
  const recent = userGames(s)
    .filter((g) => g.result && (g.result.userLine || g.result.dnp) && g.kind !== "playoff")
    .slice(-3);
  if (recent.length < 3 || s.games.some((g) => g.kind === "playoff")) return c;
  const avg = recent.reduce((a, g) => a + (g.result!.userLine ? gameScore(g.result!.userLine) : 0), 0) / recent.length;
  const ovr = playerOvr(c.player);
  const up = levels[idx + 1];
  const down = levels[idx - 1];
  let to: HsLevel | null = null;
  let reason = "";
  if (up && s.rosters[up] && (ovr >= levelCutoff(s.rosters[up]!) + 2 || (avg >= 13 && ovr >= levelCutoff(s.rosters[up]!)))) {
    to = up;
    reason = avg >= 13 ? `averaging a game score of ${avg.toFixed(1)} over your last three games` : "you've outgrown this level";
  } else if (down && s.grade < 12 && !(down === "frso" && s.grade >= 11) && avg < 1.5 && ovr < levelCutoff(s.rosters[s.level] ?? []) - 6) {
    to = down;
    reason = "you need more minutes to develop";
  }
  if (!to) return c;
  const date = c.date;
  const moves = [...s.moves, { date, from: s.level, to, reason }];
  const upMove = levels.indexOf(to) > idx;
  return {
    ...c,
    hs: { ...c.hs, seasons: [...c.hs.seasons.slice(0, -1), { ...s, level: to, moves }] },
    inbox: [
      ...c.inbox,
      msg(
        date,
        "Coach",
        upMove ? `You're moving up to ${LEVEL_LABEL[to]}` : `Back to ${LEVEL_LABEL[to]} for now`,
        upMove
          ? `Starting with the next game you're with ${LEVEL_SHORT[to]}: ${reason}. Keep it going.`
          : `I'm sending you to ${LEVEL_SHORT[to]} because ${reason}. Play well and you'll be back.`,
      ),
    ],
    log: [...c.log, log(date, upMove ? `Called up to ${LEVEL_LABEL[to]}.` : `Moved to ${LEVEL_LABEL[to]}.`, "move")],
  };
}

/** Season averages for your player at a level (per game). */
export function averages(t: (StatLine & { gp: number }) | undefined) {
  if (!t || !t.gp) return null;
  const pg = (v: number) => v / t.gp;
  return {
    gp: t.gp,
    mpg: pg(t.min / 60),
    ppg: pg(t.pts),
    rpg: pg(t.oreb + t.dreb),
    apg: pg(t.ast),
    spg: pg(t.stl),
    bpg: pg(t.blk),
    fgPct: t.fga ? t.fgm / t.fga : 0,
    tpPct: t.tpa ? t.tpm / t.tpa : 0,
    ftPct: t.fta ? t.ftm / t.fta : 0,
  };
}

/** End-of-season honors for your player, from varsity production and team success. */
export function seasonAwards(c: Career, ctx: HsContext): string[] {
  const s = currentSeason(c)!;
  const school = ctx.byId.get(s.schoolId)!;
  const avg = averages(s.stats.varsity);
  const out: string[] = [];
  // team honors belong to the varsity players
  const onVarsity = s.level === "varsity" && (s.stats.varsity?.gp ?? 0) > 0;
  const champ = s.playoffs?.find((b) => b.champion === s.schoolId);
  if (champ && onVarsity) out.push(`${champ.name} champion`);
  const regionGames = s.games.filter((g) => g.level === "varsity" && g.kind !== "playoff");
  const table = standings(
    regionGames,
    ctx.teams.filter((t) => t.conferenceId === school.conferenceId).map((t) => t.id),
  );
  const regionRank = [...table.values()].sort((a, b) => b.rw - b.rl - (a.rw - a.rl) || b.w - a.w).findIndex((x) => x.teamId === s.schoolId);
  if (regionRank === 0 && onVarsity) out.push("Region champion");
  if (!avg || avg.gp < 8) return out;
  const impact = avg.ppg + avg.rpg * 0.7 + avg.apg * 0.9 + (avg.spg + avg.bpg) * 1.2;
  const region = school.conferenceId.split("-").slice(2).join(" ");
  const regionName = region.replace(/\b\w/g, (m) => m.toUpperCase());
  if (impact >= 30) out.push(`${regionName} Region Player of the Year`);
  if (impact >= 24) out.push(`All-${regionName} Region First Team`);
  else if (impact >= 18) out.push(`All-${regionName} Region Second Team`);
  if (impact >= 34) out.push(`All-State ${school.tier} First Team`);
  else if (impact >= 28) out.push(`All-State ${school.tier} Second Team`);
  if (impact >= 40) out.push(`${school.tier} Player of the Year`);
  return out;
}

/** Closes out a season: awards, a wrap-up message, an updated recruiting ranking, and the season trimmed to your school's games. */
export function finishSeason(c: Career, ctx: HsContext): Career {
  const s = currentSeason(c)!;
  if (s.wrapped) return c;
  const awards = seasonAwards(c, ctx);
  const end = hsCalendar(s.year).seasonEnd;
  // keep the region table, then trim the season to your school's games and the playoffs
  const school = ctx.byId.get(s.schoolId)!;
  const regionIds = ctx.teams.filter((t) => t.conferenceId === school.conferenceId).map((t) => t.id);
  const table = standings(
    s.games.filter((g) => g.level === "varsity" && g.kind !== "playoff"),
    regionIds,
  );
  const regionTable = [...table.values()].map(({ teamId, w, l, rw, rl }) => ({ teamId, w, l, rw, rl }));
  const kept = s.games
    .filter((g) => g.homeId === s.schoolId || g.awayId === s.schoolId || g.kind === "playoff")
    .map((g) => (g.result?.box && g.level !== s.level ? { ...g, result: { ...g.result, box: undefined } } : g));
  const wrappedSeason: HsSeason = { ...s, awards, regionTable, games: kept, wrapped: true };
  let next: Career = {
    ...c,
    date: end > c.date ? end : c.date,
    hs: { ...c.hs, seasons: [...c.hs.seasons.slice(0, -1), wrappedSeason] },
    log: [...c.log, ...awards.map((a) => log(end, a, "award"))],
  };
  next = recruitStep(rerank(next, end), ctx, end);
  const champion = s.playoffs?.find((b) => b.champion === s.schoolId);
  return {
    ...next,
    inbox: [
      ...next.inbox,
      msg(
        end,
        "Coach",
        "Season wrap-up",
        `${champion ? "State champions. What a ride. " : ""}${awards.length ? `Honors: ${awards.join(", ")}. ` : ""}${
          s.grade < 12 ? "Finish the school year strong, then get back in the gym this summer." : "Finish the school year strong. College is next."
        }`,
      ),
    ],
  };
}

/** Refreshes your recruiting ranking and tells you when your stars change. */
export function rerank(c: Career, date: IsoDate, extraExposure = 0): Career {
  const s = currentSeason(c);
  if (!s) return c;
  const r = rankCareer(c, date, extraExposure);
  const before = s.ranking?.stars ?? 0;
  const seasons = [...c.hs.seasons.slice(0, -1), { ...s, ranking: r }];
  const changed = r.stars !== before && r.stars > 0;
  return {
    ...c,
    hs: { ...c.hs, seasons },
    ...(changed
      ? {
          inbox: [...c.inbox, msg(date, "Recruiting service", r.stars > before ? "Your ranking went up" : "Your ranking slipped", rankingText(r))],
          log: [...c.log, log(date, `Rated a ${r.stars}-star prospect (#${r.national} nationally).`, "milestone")],
        }
      : {}),
  };
}

/** Finals week: sets the semester GPA from your aptitude, focus and quiz score (0..1). Fall grades under 2.0 make you ineligible. */
export function takeFinals(c: Career, semester: "fall" | "spring", exam: number): Career {
  const s = currentSeason(c)!;
  const cal = hsCalendar(s.year);
  const date = semester === "fall" ? cal.fallGrades : cal.springGrades;
  const gpa = semesterGpa(c.player.academics ?? 0.6, s.focus ?? 0.5, exam, new Rng(`${c.seed}:gpa:${s.year}:${semester}`));
  const ineligible = semester === "fall" && gpa < ELIGIBLE_GPA && !s.wrapped;
  const season: HsSeason = { ...s, grades: { ...s.grades, [semester]: gpa }, ...(ineligible ? { ineligibleFrom: date } : {}) };
  const body = ineligible
    ? `Your fall GPA is ${gpa.toFixed(2)}. That's below ${ELIGIBLE_GPA.toFixed(1)}, so you're academically ineligible for the rest of the season. Spend more time on school next semester.`
    : `Your ${semester} GPA is ${gpa.toFixed(2)} (${gpaLabel(gpa)}).`;
  return {
    ...c,
    date: date > c.date ? date : c.date,
    hs: { ...c.hs, seasons: [...c.hs.seasons.slice(0, -1), season] },
    inbox: [...c.inbox, msg(date, "Counselor", `${semester === "fall" ? "Fall" : "Spring"} grades`, body)],
    log: [
      ...c.log,
      log(
        date,
        `${semester === "fall" ? "Fall" : "Spring"} semester GPA: ${gpa.toFixed(2)}.${ineligible ? " Academically ineligible." : ""}`,
        ineligible ? "move" : "milestone",
      ),
    ],
  };
}

export const setFocus = (c: Career, focus: number): Career => {
  const s = currentSeason(c);
  if (!s) return c;
  return { ...c, hs: { ...c.hs, seasons: [...c.hs.seasons.slice(0, -1), { ...s, focus: clamp(focus, 0, 1) }] } };
};

/** Goes to a summer camp: rating boosts, then the exposure shows up in your recruiting ranking. */
export function goToCamp(c: Career, campId: string): Career {
  const camp = CAMPS.find((x) => x.id === campId);
  if (!camp) return c;
  const s = currentSeason(c)!;
  return rerank(attendCamp(c, campId), campDate(s.year), camp.exposure);
}

/** Sets up this summer's AAU showcase (club and games). */
export function prepareShowcase(c: Career): Career {
  const s = currentSeason(c)!;
  return s.summer?.showcase ? c : scheduleShowcase(c);
}

/** Records a showcase game: XP and exposure with college coaches, then a ranking refresh. */
export function applyShowcaseGame(c: Career, gameId: string, o: UserGameOutcome): Career {
  const s = currentSeason(c)!;
  const games = s.summer?.showcase ?? [];
  const g = games.find((x) => x.id === gameId);
  if (!g || g.result) return c;
  const line = o.box[c.player.id];
  const gs = line ? gameScore(line) : 0;
  const result: GameResult = { home: o.homeScore, away: o.awayScore, played: o.played, overtimes: o.overtimes, ...(line ? { userLine: line } : { dnp: true }) };
  const showcase = games.map((x) => (x.id === gameId ? { ...x, result } : x));
  const elite = !!s.summer?.club?.elite;
  const gain = showcaseExposure(gs, elite);
  let next: Career = { ...c, date: g.date, hs: { ...c.hs, seasons: [...c.hs.seasons.slice(0, -1), { ...s, summer: { ...s.summer!, showcase } }] } };
  next = withXp(next, Math.round(clamp(15 + gs * 2.5, 5, 70)), g.date);
  if (line && line.pts >= 20) next = { ...next, log: [...next.log, log(g.date, `${line.pts} points at the ${g.label ?? "showcase"}.`, "game")] };
  return rerank(next, g.date, gain);
}

/** The 3D or simulated match for a showcase game: your club against another club. */
export function showcaseSetup(c: Career, game: ScheduledGame): MatchSetup {
  const s = currentSeason(c)!;
  const sc = showcaseFor(c, s);
  const opp = sc.opponents.find((t) => t.id === game.homeId || t.id === game.awayId)!;
  const mine = withUser(clubRoster(sc.club, sc.target, s.year, s.grade), c.player);
  const theirs = clubRoster(opp, sc.target + 1, s.year, s.grade);
  const side = (team: Team, roster: Player[]) => ({ team, roster, starters: pickStarters(roster) });
  const homeIsUs = game.homeId === sc.club.id;
  return {
    league: "hs",
    home: homeIsUs ? side(sc.club, mine) : side(opp, theirs),
    away: homeIsUs ? side(opp, theirs) : side(sc.club, mine),
    lockPlayerId: c.player.id,
    difficulty: c.settings.difficulty,
    seed: Math.abs(hashGame(game.id + c.seed)) % 1_000_000,
  };
}

/** Starts the next school year on August 1: a year older, the summer's development, new rosters and schedules. */
export function startNextYear(c: Career, ctx: HsContext): Career {
  const s = currentSeason(c)!;
  const newYear = s.year + 1;
  const developed = develop(c, iso(newYear, 8, 1));
  const aged = { ...developed, date: iso(newYear, 8, 1), player: { ...developed.player, age: developed.player.age + 1 } };
  return recruitStep(startSeason(aged, newYear, ctx), ctx, iso(newYear, 8, 1));
}

/** Graduation day after senior year. */
export function graduate(c: Career, ctx: HsContext): Career {
  const s = currentSeason(c)!;
  const date = iso(s.year + 1, 5, 28);
  if (c.log.some((e) => e.text.startsWith("Graduated from"))) return c;
  return {
    ...c,
    date,
    log: [...c.log, log(date, `Graduated from ${ctx.byId.get(s.schoolId)?.name ?? "high school"}.`)],
    inbox: [...c.inbox, msg(date, "Family", "Graduation day", "We're so proud of you. College ball is next.")],
  };
}

/** A readable one-line summary of a game from your school's side. */
export function describeGame(g: ScheduledGame, schoolId: string, ctx: HsContext) {
  const home = g.homeId === schoolId;
  const opp = ctx.byId.get(home ? g.awayId : g.homeId);
  const where = g.neutral ? "vs" : home ? "vs" : "at";
  const r = g.result;
  const score = r
    ? `${(home ? r.home > r.away : r.away > r.home) ? "W" : "L"} ${home ? r.home : r.away}-${home ? r.away : r.home}${r.overtimes ? ` (${r.overtimes > 1 ? r.overtimes : ""}OT)` : ""}`
    : "";
  return { opp, where, score, date: formatDate(g.date) };
}

export { bracketFor, overall };
