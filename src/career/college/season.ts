// The college career loop: enrolling, seasons across your whole division, coach trust and minutes,
// NIL, awards, the transfer portal and the declare decision. Pure functions over the Career save.
import { generateRoster, playerOvr, teamTalentTarget, assignJerseys } from "@/engine/player";
import { Rng, clamp } from "@/engine/rng";
import type { ClassYear, Player, Team } from "@/engine/types";
import { addLine, emptyLine, gameScore } from "@/game/sim/stats";
import { pickStarters, type MatchSetup } from "@/game/sim/match";
import { addDays, collegeCalendar, iso } from "../calendar";
import { heightAtAge, weightAtAge } from "../create";
import { formatDate } from "../format";
import { rosterStrength } from "../hs/rosters";
import { powerRatings, ranked, simScore, standings } from "../hs/sim";
import { winnerOf } from "../hs/playoffs";
import { develop, averages, hashGame, withUser, withXp, type HsContext, type UserGameOutcome } from "../hs/season";
import { nilValue, programBar } from "../recruiting";
import type {
  Bracket,
  Career,
  CareerLogEntry,
  CollegeRole,
  CollegeSeason,
  DraftStock,
  GameResult,
  InboxMessage,
  IsoDate,
  NilDeal,
  PortalOffer,
  ScheduledGame,
} from "../types";
import { INVITATIONAL_ID, NATIONAL_ID, advanceCollegeBracket, conferenceBrackets, nationalRound, selectFields } from "./postseason";
import { generateCollegeSchedule } from "./schedule";

export const ELIGIBILITY_YEARS = 4;
const CLASSES: ClassYear[] = ["FR", "SO", "JR", "SR"];
/** Points added to each side's simulated score: college games run longer than the high school games the model was fitted to. */
export const SCORE_LIFT = 18;
/** Mean gap between rosterStrength(generateRoster(...)) and the talent target. */
export const COLLEGE_STRENGTH_BIAS = 2;
/** The minutes the coach plans for each role. */
export const ROLE_MINUTES: Record<CollegeRole, number> = { starter: 31, rotation: 19, bench: 7 };
/** Game score the coach expects from each role; beating it builds trust. */
const ROLE_GAME_SCORE: Record<CollegeRole, number> = { starter: 12, rotation: 7, bench: 2.5 };

const msg = (date: IsoDate, from: string, subject: string, body: string): InboxMessage => ({
  id: `m-${date}-${Math.random().toString(36).slice(2, 8)}`,
  date,
  from,
  subject,
  body,
  read: false,
});
const log = (date: IsoDate, text: string, kind: CareerLogEntry["kind"] = "milestone"): CareerLogEntry => ({ date, text, kind });

export const currentCollege = (c: Career): CollegeSeason | undefined => c.college?.seasons.at(-1);
const withSeason = (c: Career, s: CollegeSeason): Career => ({ ...c, college: { ...c.college!, seasons: [...c.college!.seasons.slice(0, -1), s] } });
export const yearsUsed = (c: Career) => (c.college?.seasons ?? []).filter((s) => !s.redshirt).length;
const divisionTeams = (ctx: HsContext, tier: string) => (ctx.colleges ?? []).filter((t) => t.tier === tier);
const collegeTeam = (ctx: HsContext, id: string) => ctx.collegeById!.get(id)!;

/** Expected strength of a program this year without building its roster (a good or bad year adds noise). */
export function programStrength(t: Team, year: number) {
  return teamTalentTarget(t) + COLLEGE_STRENGTH_BIAS + new Rng(`${t.id}:${year}:str`).normal(0, 2.4);
}

/** Your role: your overall, nudged by how much the coach trusts you, against the rest of the roster. */
export function coachRole(ovr: number, roster: Player[], trust: number): CollegeRole {
  const eff = ovr + (trust - 50) / 6;
  const ahead = roster.filter((p) => playerOvr(p) > eff).length;
  return ahead < 5 ? "starter" : ahead < 9 ? "rotation" : "bench";
}

/** Everyone moves up a class and improves, seniors leave, and next year's generated roster supplies the newcomers. */
export function rollCollegeRoster(team: Team, prev: Player[], year: number): Player[] {
  const rng = new Rng(`${team.id}:college-roll:${year}`);
  const back = prev
    .filter((p) => p.classYear !== "SR")
    .map((p) => {
      const grow = rng.range(1, 4) * (0.6 + p.traits.workEthic * 0.8);
      const ratings = { ...p.ratings };
      for (const k of Object.keys(ratings) as (keyof typeof ratings)[]) ratings[k] = Math.round(clamp(ratings[k] + grow + rng.normal(0, 1.2), 25, 99));
      return { ...p, classYear: CLASSES[CLASSES.indexOf(p.classYear ?? "FR") + 1], age: p.age + 1, ratings };
    });
  const taken = new Set(back.map((p) => p.id));
  const fresh = generateRoster(team, year)
    .filter((p) => !taken.has(p.id))
    .map((p, i) => ({ ...p, id: `${p.id}-${year}-${i}`, classYear: "FR" as const, age: 18 }));
  const roster = [...back, ...fresh].slice(0, 13);
  assignJerseys(rng, roster);
  return roster;
}

const NIL_BRANDS: Record<NilDeal["kind"], string[]> = {
  local: ["Campus Corner Pizza", "Main Street Auto", "University Bookstore", "Hometown Credit Union"],
  national: ["Fastbreak Energy", "Courtside Headphones", "Crossover Apparel", "Hoopline Sneakers"],
  community: ["Youth Hoops Camp", "Children's Hospital Read-Along", "Food Bank Drive", "Boys & Girls Club Clinics"],
};

/** This year's NIL offers: a local deal for everyone, a national deal for players with a name, a community deal that pays little but counts for your legacy. */
export function nilDeals(c: Career, t: Team, year: number): NilDeal[] {
  const rng = new Rng(`${c.seed}:nil:${year}`);
  const base = Math.max(1_000, nilValue(c, t) * (0.5 + yearsUsed(c) * 0.25));
  const deal = (kind: NilDeal["kind"], share: number): NilDeal => ({
    id: `nil-${year}-${kind}`,
    brand: rng.pick(NIL_BRANDS[kind]),
    kind,
    amount: Math.round((base * share * rng.range(0.85, 1.15)) / 500) * 500,
    status: "open",
  });
  return [deal("local", 0.35), deal("community", 0.15), ...(base >= 40_000 ? [deal("national", 1)] : [])];
}

function newSeason(c: Career, team: Team, year: number, walkOn: boolean, ctx: HsContext): Career {
  const prev = currentCollege(c);
  const stayed = prev?.teamId === team.id;
  const roster = stayed ? rollCollegeRoster(team, prev.roster, year) : generateRoster(team, year);
  const age = c.player.age + 1;
  const player = {
    ...c.player,
    age,
    classYear: CLASSES[Math.min(3, yearsUsed(c))],
    teamId: team.id,
    heightIn: heightAtAge(c.player.body.adultHeightIn, age),
    weightLb: weightAtAge(c.player.body.weightLb, age),
    wingspanIn: heightAtAge(c.player.body.wingspanIn, age),
  };
  const ovr = playerOvr(player);
  const fifth = [...roster.map(playerOvr)].sort((a, b) => b - a)[4] ?? ovr;
  const fresh = clamp(50 + (ovr - fifth) * 3, 25, 85) - (walkOn ? 15 : 0);
  const trust = stayed ? Math.max(5, Math.min(95, prev.trust + 4) - (c.college?.withdrewPortal ? 8 : 0)) : fresh;
  const schedule = generateCollegeSchedule(divisionTeams(ctx, team.tier!), year, `${c.seed}:${year}`);
  const season: CollegeSeason = {
    year,
    classYear: player.classYear,
    teamId: team.id,
    tier: team.tier!,
    walkOn,
    trust,
    role: coachRole(ovr, roster, trust),
    roster,
    games: schedule,
    stats: { ...emptyLine(), gp: 0, gs: 0 },
    awards: [],
    nil: [],
  };
  const college = { seasons: [...(c.college?.seasons ?? []), season], earnings: c.college?.earnings ?? 0 };
  const date = iso(year, 8, 20);
  const next: Career = { ...c, stage: "college", date, player, college };
  const nil = nilDeals(next, team, year);
  return withSeason(
    { ...next, inbox: [...next.inbox, msg(date, "Coach", `Welcome to ${year}-${String(year + 1).slice(2)}`, roleNote(season.role, team))] },
    { ...season, nil },
  );
}

const roleNote = (role: CollegeRole, t: Team) =>
  role === "starter"
    ? `You're starting for ${t.name}. About ${ROLE_MINUTES.starter} minutes a night. Keep earning it.`
    : role === "rotation"
      ? `You're in the ${t.name} rotation, about ${ROLE_MINUTES.rotation} minutes a night. Produce and that number goes up.`
      : `You're at the end of the ${t.name} bench for now, about ${ROLE_MINUTES.bench} minutes a night. Make those minutes count.`;

/** Move-in day: the switch from high school to your first college season. */
export function enterCollege(c: Career, ctx: HsContext): Career {
  if (c.stage !== "hs") return c;
  const choice = c.recruiting?.college;
  if (!choice || !ctx.collegeById) return c;
  const year = +choice.date.slice(0, 4) + (+choice.date.slice(5, 7) >= 8 ? 1 : 0);
  const team = collegeTeam(ctx, choice.teamId);
  const developed = develop(c, iso(year, 8, 20));
  const next = newSeason(developed, team, year, choice.walkOn, ctx);
  return { ...next, log: [...next.log, log(next.date, `Enrolled at ${team.name}${choice.walkOn ? " as a walk-on" : ""}.`)] };
}

export type CollegeEvent =
  | { kind: "game"; date: IsoDate; game: ScheduledGame }
  | { kind: "seasonEnd"; date: IsoDate }
  | { kind: "decision"; date: IsoDate }
  | { kind: "portal"; date: IsoDate }
  | { kind: "nextYear"; date: IsoDate }
  | { kind: "declared"; date: IsoDate };

const isMine = (s: CollegeSeason, g: ScheduledGame) => g.homeId === s.teamId || g.awayId === s.teamId;
export const userCollegeGames = (s: CollegeSeason) => s.games.filter((g) => isMine(s, g));
const isUserGame = (s: CollegeSeason, g: ScheduledGame) => isMine(s, g) && !s.redshirt;

/** What the college career is waiting on next. */
export function nextCollegeEvent(c: Career): CollegeEvent {
  const s = currentCollege(c)!;
  const cal = collegeCalendar(s.year);
  if (c.college?.declared) return { kind: "declared", date: c.college.declared.date };
  const next = s.redshirt ? undefined : userCollegeGames(s).find((g) => !g.result);
  if (next) return { kind: "game", date: next.date, game: next };
  if (!s.wrapped) return { kind: "seasonEnd", date: cal.seasonEnd };
  if (s.decision === "portal") return { kind: "portal", date: addDays(cal.seasonEnd, 7) };
  if (s.decision === "return") return { kind: "nextYear", date: iso(s.year + 1, 8, 20) };
  return { kind: "decision", date: addDays(cal.seasonEnd, 1) };
}

function strength(c: Career, s: CollegeSeason, id: string, ctx: HsContext) {
  if (id !== s.teamId) return programStrength(collegeTeam(ctx, id), s.year);
  return rosterStrength(s.redshirt ? s.roster : [...s.roster, c.player]);
}

function simGame(c: Career, s: CollegeSeason, g: ScheduledGame, ctx: HsContext, rng: Rng): GameResult {
  const r = simScore(strength(c, s, g.homeId, ctx), strength(c, s, g.awayId, ctx), rng, g.neutral);
  return { ...r, home: r.home + SCORE_LIFT, away: r.away + SCORE_LIFT, ...(isMine(s, g) ? { dnp: true } : {}) };
}

/** Plays out conference tournaments, Selection Sunday and the national tournaments as far as the date allows, stopping at your games. */
function runPostseason(c: Career, s: CollegeSeason, ctx: HsContext, until: IsoDate, rng: Rng): CollegeSeason {
  if (s.games.some((g) => g.kind !== "playoff" && !g.result)) return s;
  const teams = divisionTeams(ctx, s.tier);
  let games = [...s.games];
  const brackets: Bracket[] = s.brackets
    ? s.brackets.map((b) => ({ ...b, rounds: b.rounds.map((r) => [...r]) }))
    : conferenceBrackets(teams, games, ctx.conferences);
  for (let guard = 0; guard < 16; guard++) {
    let changed = false;
    const byId = new Map(games.map((g) => [g.id, g]));
    const conference = brackets.filter((b) => b.id.startsWith("conf-"));
    if (brackets.length === conference.length && conference.every((b) => b.champion)) {
      brackets.push(...selectFields(teams, games, conference));
      changed = true;
    }
    for (const b of brackets) {
      const open = !b.champion;
      const fresh = advanceCollegeBracket(b, byId, s.year);
      if (fresh.length) games.push(...fresh);
      if (fresh.length || (open && b.champion)) changed = true;
    }
    games = games.map((g) => {
      if (g.result || g.kind !== "playoff" || g.date > until || isUserGame(s, g)) return g;
      changed = true;
      return { ...g, result: simGame(c, s, g, ctx, rng) };
    });
    if (!changed) break;
  }
  return { ...s, games, brackets };
}

/** Simulates everything up to `date` except your own games, adds practice XP and development, and moves the date forward. */
export function advanceCollege(c: Career, date: IsoDate, ctx: HsContext): Career {
  let s = currentCollege(c);
  if (!s) return { ...c, date };
  let until = date;
  for (let guard = 0; guard < 24; guard++) {
    const cur: CollegeSeason = s;
    const stop = cur.redshirt ? undefined : userCollegeGames(cur).find((g) => !g.result);
    until = stop && stop.date <= date ? stop.date : date;
    const rng = new Rng(`${c.seed}:college-sim:${until}:${guard}`);
    const games = cur.games.map((g) => (g.result || g.date > until || isUserGame(cur, g) ? g : { ...g, result: simGame(c, cur, g, ctx, rng) }));
    s = runPostseason(c, { ...cur, games }, ctx, until, rng);
    const after: CollegeSeason = s;
    if ((after.redshirt ? undefined : userCollegeGames(after).find((g) => !g.result))?.id === stop?.id) break;
  }
  const weeks = Math.max(0, Math.floor((Date.parse(until) - Date.parse(c.date)) / (7 * 86_400_000)));
  const practiceXp = Math.round(weeks * (9 + c.player.traits.workEthic * 7));
  const moved = withSeason({ ...c, date: until > c.date ? until : c.date }, s);
  return develop(withXp(moved, practiceXp, until), until);
}

/** The match for one of your games: the coach's lineup and minutes follow your role. */
export function collegeMatchSetup(c: Career, game: ScheduledGame, ctx: HsContext): MatchSetup & { rotation: Record<string, number> } {
  const s = currentCollege(c)!;
  const team = collegeTeam(ctx, s.teamId);
  const opp = collegeTeam(ctx, game.homeId === s.teamId ? game.awayId : game.homeId);
  const mine = withUser(s.roster, c.player);
  let starters = pickStarters(mine);
  if (s.role === "starter" && !starters.includes(c.player.id)) {
    const out = mine.filter((p) => starters.includes(p.id)).sort((a, b) => playerOvr(a) - playerOvr(b))[0];
    starters = starters.map((id) => (id === out.id ? c.player.id : id));
  }
  if (s.role !== "starter") starters = pickStarters(s.roster);
  const rotation = { [c.player.id]: ROLE_MINUTES[s.role] };
  const theirs = generateRoster(opp, s.year);
  const us = { team, roster: mine, starters, rotation };
  const them = { team: opp, roster: theirs, starters: pickStarters(theirs) };
  return {
    league: "college",
    home: game.homeId === s.teamId ? us : them,
    away: game.homeId === s.teamId ? them : us,
    lockPlayerId: c.player.id,
    difficulty: c.settings.difficulty,
    seed: Math.abs(hashGame(game.id + c.seed)) % 1_000_000,
    rotation,
  };
}

/** Records one of your games: result, your line, XP, and how the coach's trust and your role change. */
export function applyCollegeGame(c: Career, gameId: string, o: UserGameOutcome, ctx: HsContext): Career {
  const s = currentCollege(c)!;
  const game = s.games.find((g) => g.id === gameId);
  if (!game || game.result) return c;
  const mySide = new Set([...s.roster.map((p) => p.id), c.player.id]);
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
  const stats = dnp ? s.stats : { ...addLine(s.stats, line), gp: s.stats.gp + 1, gs: s.stats.gs + (s.role === "starter" ? 1 : 0) };
  const won = (game.homeId === s.teamId) === o.homeScore > o.awayScore;
  const gs = dnp ? 0 : gameScore(line);
  const trust = dnp ? s.trust : clamp(s.trust + clamp((gs - ROLE_GAME_SCORE[s.role]) * 0.45 + (won ? 0.4 : -0.2), -3, 3), 0, 100);
  const role = coachRole(playerOvr(c.player), s.roster, trust);
  const team = collegeTeam(ctx, s.teamId);
  let next = withSeason({ ...c, date: game.date }, { ...s, games, stats, trust, role });
  const mult = { rookie: 0.8, pro: 1, allstar: 1.15, superstar: 1.3, hof: 1.45, legend: 1.6 }[c.settings.difficulty];
  next = withXp(next, Math.round((dnp ? 5 : clamp(15 + gs * 3, 5, 90) + (won ? 10 : 0)) * mult * (o.played ? 1.25 : 1)), game.date);
  const opp = collegeTeam(ctx, game.homeId === s.teamId ? game.awayId : game.homeId);
  if (!dnp && (line.pts >= 25 || (line.pts >= 10 && line.oreb + line.dreb >= 10) || line.ast >= 10))
    next = { ...next, log: [...next.log, log(game.date, `${line.pts} points vs ${opp.name}.`, "game")] };
  if (role !== s.role) {
    const up = ROLE_MINUTES[role] > ROLE_MINUTES[s.role];
    next = {
      ...next,
      inbox: [...next.inbox, msg(game.date, "Coach", up ? "You've earned more minutes" : "Your role is changing", roleNote(role, team))],
      log: [...next.log, log(game.date, up ? `Earned a bigger role (${role}).` : `Moved to a smaller role (${role}).`, "move")],
    };
  }
  return next;
}

/** One number for how much your player does per game. */
const impactOf = (a: NonNullable<ReturnType<typeof averages>>) => a.ppg + a.rpg * 0.7 + a.apg * 0.9 + (a.spg + a.bpg) * 1.2;

/** What pro scouts think right now: your overall, your age, production and the level you played at. */
export function draftStock(c: Career): DraftStock {
  const s = currentCollege(c)!;
  const a = averages(s.stats);
  const prod = a ? (impactOf(a) - 20) * 0.25 : -3;
  const level = s.tier === "D1" ? 0 : s.tier === "D2" ? -4 : -7;
  const run = /Championship|National Semifinal/.test(s.finish ?? "") ? 1.5 : s.finish?.includes("Regional") ? 0.7 : 0;
  const score = playerOvr(c.player) + (22 - c.player.age) * 1.2 + prod + level + run;
  const pick = Math.max(1, Math.round(1 + (85 - score) * 5));
  const label =
    pick <= 5 ? "Top-five pick" : pick <= 14 ? "Lottery pick" : pick <= 30 ? "First-round pick" : pick <= 60 ? "Second-round pick" : "Likely undrafted";
  return { pick, label, score: Math.round(score * 10) / 10 };
}

/** How your team's season ended. */
function seasonFinish(s: CollegeSeason, games: ScheduledGame[]) {
  const mine = games.filter((g) => g.kind === "playoff" && isMine(s, g)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const last = mine.at(-1);
  if (!last) return "Missed the postseason";
  const event = last.label ?? "the postseason";
  const lost = winnerOf(last) !== s.teamId;
  return lost ? `Lost in the ${event}` : `Won the ${event}`;
}

/** Honors for your season, from production and team success. */
export function collegeAwards(c: Career, ctx: HsContext): string[] {
  const s = currentCollege(c)!;
  const team = collegeTeam(ctx, s.teamId);
  const conf = ctx.conferences?.get(team.conferenceId);
  const confName = conf?.short ?? "Conference";
  const a = averages(s.stats);
  const played = !!a;
  const out: string[] = [];
  const national = s.brackets?.find((b) => b.id === NATIONAL_ID);
  const division = s.tier === "D1" ? "National" : `${s.tier} National`;
  if (played && national?.champion === s.teamId) out.push(`${division} champion`);
  if (played && s.brackets?.find((b) => b.id === INVITATIONAL_ID)?.champion === s.teamId) out.push("National Invitational champion");
  if (played && s.brackets?.find((b) => b.id === `conf-${team.conferenceId}`)?.champion === s.teamId) out.push(`${confName} Tournament champion`);
  const ids = divisionTeams(ctx, s.tier)
    .filter((t) => t.conferenceId === team.conferenceId)
    .map((t) => t.id);
  const table = standings(s.games, ids);
  const top = [...table.values()].sort((x, y) => y.rw - y.rl - (x.rw - x.rl) || y.w - x.w)[0];
  if (played && top?.teamId === s.teamId) out.push(`${confName} regular-season champion`);
  if (!a || a.gp < 15) return out;
  const impact = impactOf(a);
  const mine = table.get(s.teamId);
  const pct = mine && mine.w + mine.l ? mine.w / (mine.w + mine.l) : 0;
  if (national?.champion === s.teamId && impact >= 26) out.push("Most Outstanding Player");
  if (impact >= 29) out.push(`${confName} Player of the Year`);
  if (s.classYear === "FR" && impact >= 20) out.push(`${confName} Freshman of the Year`);
  if (impact >= 24) out.push(`All-${confName} First Team`);
  else if (impact >= 19) out.push(`All-${confName} Second Team`);
  const allAmerican = s.tier === "D1" ? "All-American" : `${s.tier} All-American`;
  if (impact >= 37) out.push(`${allAmerican} First Team`);
  else if (impact >= 34) out.push(`${allAmerican} Second Team`);
  else if (impact >= 31) out.push(`${allAmerican} Third Team`);
  if (impact >= 41 && pct >= 0.7) out.push(s.tier === "D1" ? "National Player of the Year" : `${s.tier} Player of the Year`);
  return out;
}

/** Closes out a season: honors, your draft stock, and the season trimmed to your games and the postseason. */
export function finishCollegeSeason(c: Career, ctx: HsContext): Career {
  const s = currentCollege(c)!;
  if (s.wrapped) return c;
  const end = collegeCalendar(s.year).seasonEnd;
  const awards = s.redshirt ? [] : collegeAwards(c, ctx);
  const team = collegeTeam(ctx, s.teamId);
  const ids = divisionTeams(ctx, s.tier)
    .filter((t) => t.conferenceId === team.conferenceId)
    .map((t) => t.id);
  const table = standings(s.games, ids);
  const conferenceTable = [...table.values()].map(({ teamId, w, l, rw, rl }) => ({ teamId, w, l, rw, rl }));
  const division = divisionTeams(ctx, s.tier).map((t) => t.id);
  const teamRank =
    ranked(
      s.games.filter((g) => g.kind !== "playoff"),
      division,
    ).indexOf(s.teamId) + 1;
  const finish = seasonFinish(s, s.games);
  const games = s.games.filter((g) => isMine(s, g) || g.kind === "playoff");
  // an earned scholarship: walk-ons who stick get put on scholarship after a strong year
  const earned = s.walkOn && s.trust >= 60;
  const wrapped: CollegeSeason = { ...s, awards, finish, conferenceTable, teamRank, games, wrapped: true, walkOn: earned ? false : s.walkOn };
  let next: Career = withSeason({ ...c, date: end > c.date ? end : c.date }, wrapped);
  const stock = draftStock(next);
  next = withSeason(next, { ...wrapped, stock });
  const lines = [finish + ".", awards.length ? `Honors: ${awards.join(", ")}.` : "", `Scouts see you as: ${stock.label.toLowerCase()}.`];
  return {
    ...next,
    log: [...next.log, ...awards.map((a) => log(end, a, "award")), ...(earned ? [log(end, `Earned a scholarship at ${team.name}.`)] : [])],
    inbox: [
      ...next.inbox,
      msg(end, "Coach", "Season wrap-up", lines.filter(Boolean).join(" ")),
      ...(earned ? [msg(end, "Coach", "You're on scholarship", "You came here with nothing promised and you earned this. Congratulations.")] : []),
    ],
  };
}

/** Sit out the year to develop; only before your first game of the season, once, and not as a starter. */
export const canRedshirt = (c: Career) => {
  const s = currentCollege(c);
  return !!s && !s.wrapped && s.role !== "starter" && !c.college!.seasons.some((x) => x.redshirt) && !s.stats.gp;
};
export const setRedshirt = (c: Career, on: boolean): Career => {
  const s = currentCollege(c);
  if (!s || (on && !canRedshirt(c))) return c;
  return withSeason({ ...c, log: on ? [...c.log, log(c.date, "Redshirting this season.", "move")] : c.log }, { ...s, redshirt: on || undefined });
};

export function signNil(c: Career, dealId: string): Career {
  const s = currentCollege(c);
  const d = s?.nil.find((x) => x.id === dealId);
  if (!s || !d || d.status !== "open") return c;
  const nil = s.nil.map((x) => (x.id === dealId ? { ...x, status: "signed" as const } : x));
  // a big national deal pulls you away from the gym, and the coach notices
  const trust = d.kind === "national" ? clamp(s.trust - 2, 0, 100) : s.trust;
  const next = withSeason({ ...c, college: { ...c.college!, earnings: c.college!.earnings + d.amount } }, { ...s, nil, trust });
  return { ...next, log: [...next.log, log(c.date, `Signed an NIL deal with ${d.brand} ($${d.amount.toLocaleString("en-US")}).`)] };
}
export function declineNil(c: Career, dealId: string): Career {
  const s = currentCollege(c);
  return s ? withSeason(c, { ...s, nil: s.nil.map((x) => (x.id === dealId && x.status === "open" ? { ...x, status: "declined" as const } : x)) }) : c;
}

export const canReturn = (c: Career) => yearsUsed(c) < ELIGIBILITY_YEARS;

/** Back for another year at the same program. */
export function returnToSchool(c: Career): Career {
  const s = currentCollege(c)!;
  return canReturn(c) ? withSeason({ ...c, college: { ...c.college!, transferTo: undefined } }, { ...s, decision: "return" }) : c;
}

/** Programs that want you in the portal, from your overall and production against each program's level. */
export function portalOffersFor(c: Career, ctx: HsContext): PortalOffer[] {
  const s = currentCollege(c)!;
  const a = averages(s.stats);
  const value = playerOvr(c.player) * 0.85 + (a ? (impactOf(a) - 12) * 0.35 : -2) + 8;
  const rng = new Rng(`${c.seed}:portal:${s.year}`);
  return (ctx.colleges ?? [])
    .filter((t) => t.id !== s.teamId)
    .map((t) => ({ t, fit: value - programBar(t) + rng.normal(0, 2.5) }))
    .filter((x) => x.fit > 0 && x.fit < 16)
    .sort((x, y) => y.t.prestige - x.t.prestige)
    .slice(0, 10)
    .map(({ t, fit }) => ({ teamId: t.id, role: fit >= 8 ? "Starter from day one" : fit >= 3 ? "Rotation player" : "Earn your minutes", nil: nilValue(c, t) }));
}

export function enterPortal(c: Career, ctx: HsContext): Career {
  const s = currentCollege(c)!;
  if (!canReturn(c)) return c;
  const portalOffers = portalOffersFor(c, ctx);
  const next = withSeason(c, { ...s, decision: "portal", portalOffers });
  const date = addDays(collegeCalendar(s.year).seasonEnd, 7);
  return {
    ...next,
    date,
    log: [...next.log, log(date, "Entered the transfer portal.", "move")],
    inbox: [
      ...next.inbox,
      msg(date, "Compliance office", "You're in the portal", `${portalOffers.length} program${portalOffers.length === 1 ? " has" : "s have"} reached out.`),
    ],
  };
}

export function transferTo(c: Career, teamId: string, ctx: HsContext): Career {
  const s = currentCollege(c)!;
  if (s.decision !== "portal" || !s.portalOffers?.some((o) => o.teamId === teamId)) return c;
  const team = collegeTeam(ctx, teamId);
  const next = withSeason({ ...c, college: { ...c.college!, transferTo: teamId } }, { ...s, decision: "return" });
  return { ...next, log: [...next.log, log(c.date, `Transferred to ${team.name}.`, "move")] };
}

export function withdrawFromPortal(c: Career): Career {
  const s = currentCollege(c)!;
  const next = withSeason({ ...c, college: { ...c.college!, withdrewPortal: true } }, { ...s, decision: "return" });
  return { ...next, log: [...next.log, log(c.date, "Withdrew from the transfer portal.", "move")] };
}

/** Starts next season at your program, or your new one after a transfer. */
export function startNextCollegeYear(c: Career, ctx: HsContext): Career {
  const s = currentCollege(c)!;
  const year = s.year + 1;
  const teamId = c.college?.transferTo ?? s.teamId;
  const team = collegeTeam(ctx, teamId);
  const developed = develop(c, iso(year, 8, 20));
  const walkOn = teamId === s.teamId ? s.walkOn : false;
  const next = newSeason(developed, team, year, walkOn, ctx);
  return { ...next, college: { ...next.college!, transferTo: undefined, withdrewPortal: undefined } };
}

export function declareForDraft(c: Career): Career {
  const s = currentCollege(c)!;
  const stock = s.stock ?? draftStock(c);
  const date = addDays(collegeCalendar(s.year).seasonEnd, 14);
  const next = withSeason({ ...c, date, college: { ...c.college!, declared: { date, stock } } }, { ...s, decision: "declare" });
  return { ...next, log: [...next.log, log(date, `Declared for the draft (projected: ${stock.label.toLowerCase()}).`)] };
}

/** Changing your mind before draft night, while you have eligibility left. */
export function undeclare(c: Career): Career {
  const s = currentCollege(c)!;
  if (!canReturn(c)) return c;
  const { declared: _gone, ...college } = c.college!;
  void _gone;
  return withSeason({ ...c, college }, { ...s, decision: undefined });
}

export const conferenceName = (ctx: HsContext, t: Team) => ctx.conferences?.get(t.conferenceId)?.name ?? "Conference";
/** Your team's rank in the division right now, from the same power ratings that pick the field. */
export function liveTeamRank(s: CollegeSeason, ctx: HsContext) {
  if (s.teamRank) return s.teamRank;
  const ids = divisionTeams(ctx, s.tier).map((t) => t.id);
  const games = s.games.filter((g) => g.kind !== "playoff" && g.result);
  if (games.length < ids.length) return null;
  const pr = powerRatings(games, ids);
  const mine = pr.get(s.teamId)!;
  return 1 + ids.filter((id) => pr.get(id)! > mine).length;
}

export { formatDate, nationalRound };
