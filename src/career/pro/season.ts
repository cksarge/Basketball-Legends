// The pro career loop: seasons across the whole league, coach trust and minutes, chemistry, injuries, All-Star weekend,
// best-of-seven playoffs, awards, badges, contracts, free agency, trades, endorsements, training and aging.
import { generateRoster, playerOvr, teamTalentTarget, assignJerseys } from "@/engine/player";
import { Rng, clamp } from "@/engine/rng";
import type { Player, RatingKey, Team } from "@/engine/types";
import { addLine, emptyLine, gameScore, type StatLine } from "@/game/sim/stats";
import { pickStarters, type MatchSetup } from "@/game/sim/match";
import { simulateContestRound } from "@/game/sim/drill";
import { addDays, iso, proCalendar } from "../calendar";
import { rosterStrength } from "../hs/rosters";
import { simScore, standings, type Standing } from "../hs/sim";
import { averages, develop, hashGame, withUser, withXp, type HsContext, type UserGameOutcome } from "../hs/season";
import type {
  Career,
  CareerLogEntry,
  ContractOffer,
  Endorsement,
  GameResult,
  InboxMessage,
  IsoDate,
  ProCareer,
  ProRole,
  ProSeason,
  ProSeries,
  ScheduledGame,
} from "../types";
import { agentById } from "./draft";
import { generateDevSchedule, generateProSchedule } from "./schedule";

/** Points added to each side's simulated score (pro games are longer and faster than the high school games behind the model). */
export const PRO_SCORE_LIFT = 46;
/** Mean gap between rosterStrength(generateRoster(...)) and the talent target. */
export const PRO_STRENGTH_BIAS = 2;
export const ROLE_MINUTES: Record<ProRole, number> = { starter: 34, sixth: 27, rotation: 18, bench: 6 };
const ROLE_GAME_SCORE: Record<ProRole, number> = { starter: 13, sixth: 10, rotation: 6.5, bench: 2 };
export const ROLE_NAME: Record<ProRole, string> = { starter: "Starter", sixth: "Sixth man", rotation: "Rotation player", bench: "End of the bench" };
/** How far below the league development rosters sit. */
export const DEV_TALENT_GAP = 13;
/** Games into a season before a broken role promise counts. */
export const PROMISE_GAMES = 20;
export const MAX_SALARY = 55_000_000;
export const MIN_SALARY = 1_200_000;
export const MAX_AGE = 41;
/** The overall a development player needs before league teams offer real contracts. */
export const DEV_CALL_UP_OVR = 68;

const msg = (date: IsoDate, from: string, subject: string, body: string): InboxMessage => ({
  id: `m-${date}-${Math.random().toString(36).slice(2, 8)}`,
  date,
  from,
  subject,
  body,
  read: false,
});
const log = (date: IsoDate, text: string, kind: CareerLogEntry["kind"] = "milestone"): CareerLogEntry => ({ date, text, kind });
export const money = (n: number) => `$${n.toLocaleString("en-US")}`;

export const currentPro = (c: Career): ProSeason | undefined => c.pro?.seasons.at(-1);
const withPro = (c: Career, p: Partial<ProCareer>): Career => ({ ...c, pro: { ...c.pro!, ...p } });
const withSeason = (c: Career, s: ProSeason): Career => withPro(c, { seasons: [...c.pro!.seasons.slice(0, -1), s] });
const team = (ctx: HsContext, id: string) => ctx.proById!.get(id)!;
const isMine = (s: ProSeason, g: ScheduledGame) => g.kind === "allstar" || g.homeId === s.teamId || g.awayId === s.teamId;
export const inDevLeague = (s: ProSeason) => s.status !== "standard";

/** Your open games in order: development league games if you're there, otherwise the league schedule. */
export function userProGames(s: ProSeason): ScheduledGame[] {
  return inDevLeague(s) ? (s.devGames ?? []) : s.games.filter((g) => isMine(s, g)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
const openGames = (s: ProSeason) => userProGames(s).filter((g) => !g.result);

export function proStrength(t: Team, year: number) {
  return teamTalentTarget(t) + PRO_STRENGTH_BIAS + new Rng(`${t.id}:${year}:pro-str`).normal(0, 2.2);
}

export function proRole(ovr: number, roster: Player[], trust: number): ProRole {
  const eff = ovr + (trust - 50) / 7;
  const ahead = roster.filter((p) => playerOvr(p) > eff).length;
  return ahead < 5 ? "starter" : ahead === 5 ? "sixth" : ahead < 10 ? "rotation" : "bench";
}

/** Teammates carry over: most stay a year older, and the rest of the roster turns over. */
export function rollProRoster(t: Team, prev: Player[], year: number): Player[] {
  const rng = new Rng(`${t.id}:pro-roll:${year}`);
  const stay = prev.filter((p) => p.age < 37 && rng.chance(0.72)).map((p) => ({ ...p, age: p.age + 1 }));
  const taken = new Set(stay.map((p) => p.id));
  const fresh = generateRoster(t, year)
    .filter((p) => !taken.has(p.id))
    .map((p, i) => ({ ...p, id: `${p.id}-${year}-${i}` }));
  const roster = [...stay, ...fresh].slice(0, 14);
  assignJerseys(rng, roster);
  return roster;
}

export function devRoster(t: Team, year: number): Player[] {
  return generateRoster(t, year * 7 + 1)
    .slice(0, 13)
    .map((p, i) => {
      const ratings = { ...p.ratings };
      for (const k of Object.keys(ratings) as RatingKey[]) ratings[k] = Math.max(25, ratings[k] - DEV_TALENT_GAP);
      return { ...p, id: `${p.id}-dev-${i}`, ratings };
    });
}

function newSeason(c: Career, year: number, ctx: HsContext): Career {
  const prev = currentPro(c);
  const t = team(ctx, c.player.teamId!);
  const status = c.pro!.status ?? "standard";
  const dev = status !== "standard";
  const stayed = prev?.teamId === t.id && !inDevLeague(prev) && !dev;
  const roster = dev ? devRoster(t, year) : stayed ? rollProRoster(t, prev.roster, year) : generateRoster(t, year);
  const player = { ...c.player, age: c.player.age + 1, classYear: undefined };
  const ovr = playerOvr(player);
  const fifth = [...roster.map(playerOvr)].sort((a, b) => b - a)[4] ?? ovr;
  const trust = stayed ? Math.min(92, prev.trust + 3) : clamp(50 + (ovr - fifth) * 3, 20, 80);
  const games = generateProSchedule(ctx.pros!, year, `${c.seed}`);
  const offer = c.pro!.offers?.find((o) => o.teamId === t.id && o.promise);
  const season: ProSeason = {
    year,
    teamId: t.id,
    status,
    role: proRole(ovr, roster, trust),
    trust,
    chemistry: stayed ? clamp(prev.chemistry * 0.7 + 18, 30, 80) : 50,
    roster,
    games,
    ...(dev ? { devGames: generateDevSchedule(ctx.pros!, t.id, year, `${c.seed}`) } : {}),
    stats: { ...emptyLine(), gp: 0, gs: 0 },
    playoffStats: { ...emptyLine(), gp: 0, gs: 0 },
    awards: [],
    series: [],
    ...(offer ? { promise: { role: offer.role } } : {}),
  };
  const date = proCalendar(year).camp;
  const next: Career = { ...c, date: date > c.date ? date : c.date, player };
  const label = dev ? `${t.name} development team` : t.name;
  return withPro(
    {
      ...next,
      inbox: [
        ...next.inbox,
        msg(
          date,
          "Coach",
          `Welcome to ${year}-${String(year + 1).slice(2)}`,
          `You're with ${label}. ${ROLE_NAME[season.role]}, about ${ROLE_MINUTES[season.role]} minutes a night.`,
        ),
      ],
    },
    { seasons: [...c.pro!.seasons, season], offers: undefined },
  );
}

export const TRAINING: { id: string; label: string; keys: RatingKey[] }[] = [
  { id: "shooting", label: "Shooting", keys: ["three", "midRange", "freeThrow"] },
  { id: "finishing", label: "Finishing", keys: ["layup", "dunk", "closeShot"] },
  { id: "playmaking", label: "Playmaking", keys: ["ballHandle", "passAccuracy", "passVision"] },
  { id: "defense", label: "Defense", keys: ["perimeterD", "interiorD", "steal", "block"] },
  { id: "athleticism", label: "Athleticism", keys: ["speed", "accel", "vertical", "strength", "stamina"] },
];

/** Older players lose a step every summer, starting with the legs. */
export function agePlayer(c: Career, rng: Rng): Career {
  const age = c.player.age;
  if (age < 30) return c;
  const drop = (age - 29) * 0.5;
  const ratings = { ...c.player.ratings };
  const legs: RatingKey[] = ["speed", "accel", "vertical", "stamina"];
  for (const k of Object.keys(ratings) as RatingKey[]) {
    const loss = (legs.includes(k) ? drop * 1.6 : drop * 0.55) * rng.range(0.5, 1.3);
    ratings[k] = Math.max(25, Math.round(ratings[k] - loss));
  }
  // what you lose doesn't come back on its own
  const caps = { ...c.player.caps };
  for (const k of Object.keys(caps) as RatingKey[]) caps[k] = Math.min(caps[k], Math.max(ratings[k] + 2, caps[k] - 1));
  return { ...c, player: { ...c.player, ratings, caps } };
}

/** Training camp: your summer's work, then the season starts. */
export function trainingCamp(c: Career, focusId: string, ctx: HsContext): Career {
  const focus = TRAINING.find((f) => f.id === focusId);
  const prev = currentPro(c);
  const year = prev ? prev.year + 1 : c.pro!.preDraft.year;
  if (!focus || (prev && !prev.wrapped) || c.pro?.trainedFor === year) return c;
  const rng = new Rng(`${c.seed}:camp:${year}`);
  let next = develop(c, proCalendar(year).camp);
  next = agePlayer(next, rng);
  const ratings = { ...next.player.ratings };
  const gain = next.player.age >= 33 ? 1 : 2;
  for (const k of focus.keys) ratings[k] = Math.min(next.player.caps[k], ratings[k] + gain + (rng.chance(0.5) ? 1 : 0));
  next = { ...next, player: { ...next.player, ratings } };
  return withPro(newSeason(next, year, ctx), { trainedFor: year });
}

export type ProEvent =
  | { kind: "training"; date: IsoDate }
  | { kind: "game"; date: IsoDate; game: ScheduledGame }
  | { kind: "injured"; date: IsoDate; name: string; left: number }
  | { kind: "seasonEnd"; date: IsoDate }
  | { kind: "freeAgency"; date: IsoDate };

/** What the pro career is waiting on next (once the draft is behind you). */
export function nextProEvent(c: Career): ProEvent {
  const s = currentPro(c);
  if (!s) return { kind: "training", date: proCalendar(c.pro!.preDraft.year).camp };
  const cal = proCalendar(s.year);
  if (!s.wrapped) {
    const open = openGames(s);
    if (s.injury && s.injury.left > 0)
      return { kind: "injured", date: open[Math.min(s.injury.left, open.length) - 1]?.date ?? cal.seasonEnd, name: s.injury.name, left: s.injury.left };
    if (open[0]) return { kind: "game", date: open[0].date, game: open[0] };
    return { kind: "seasonEnd", date: cal.seasonEnd };
  }
  if (!c.player.contract || c.player.contract.years <= 0) return { kind: "freeAgency", date: iso(s.year + 1, 7, 1) };
  return { kind: "training", date: proCalendar(s.year + 1).camp };
}

function strengths(c: Career, s: ProSeason, ctx: HsContext) {
  const map = new Map(ctx.pros!.map((t) => [t.id, proStrength(t, s.year)]));
  const hurt = s.injury && s.injury.left > 0;
  const mine = hurt || inDevLeague(s) ? rosterStrength(s.roster) : rosterStrength([...s.roster, c.player]);
  if (!inDevLeague(s)) map.set(s.teamId, mine + (s.chemistry - 50) / 25);
  return map;
}

function simPro(home: number, away: number, rng: Rng, neutral = false): GameResult {
  const r = simScore(home, away, rng, neutral);
  return { ...r, home: r.home + PRO_SCORE_LIFT, away: r.away + PRO_SCORE_LIFT };
}

export const conferenceShort = (ctx: HsContext, id: string): "East" | "West" => (team(ctx, id).conferenceId === "pro-east" ? "East" : "West");

/** Conference standings, best first (win percentage, then point difference). */
export function conferenceTable(s: ProSeason, ctx: HsContext, conf: "East" | "West"): Standing[] {
  const ids = ctx.pros!.filter((t) => conferenceShort(ctx, t.id) === conf).map((t) => t.id);
  const t = standings(
    s.games.filter((g) => g.kind === "region"),
    ids,
  );
  return [...t.values()].sort((a, b) => b.w - a.w || b.pf - b.pa - (a.pf - a.pa) || a.teamId.localeCompare(b.teamId));
}

const ROUND_NAME = ["Play-In", "First Round", "Semifinals", "Conference Finals", "Finals"];
const roundStart = (year: number, round: number) => addDays(proCalendar(year).playoffs, (round - 1) * 15);

function makeSeries(id: string, conf: ProSeries["conf"], round: number, high: string, low: string, bestOf: number, start: IsoDate, label?: string): ProSeries {
  return { id, conf, round, label: label ?? (conf === "Finals" ? "The Finals" : `${conf} ${ROUND_NAME[round]}`), high, low, bestOf, start, games: [] };
}

const seriesWins = (x: ProSeries, byId: Map<string, ScheduledGame>) => {
  let high = 0,
    low = 0;
  for (const id of x.games) {
    const r = byId.get(id)?.result;
    if (!r) continue;
    const g = byId.get(id)!;
    const homeWon = r.home > r.away;
    if ((g.homeId === x.high) === homeWon) high++;
    else low++;
  }
  return { high, low };
};
export const seriesScore = (x: ProSeries, games: ScheduledGame[]) => seriesWins(x, new Map(games.map((g) => [g.id, g])));

/** Creates each round's series as the last one finishes. */
function nextSeries(s: ProSeason, ctx: HsContext): ProSeries[] {
  const out: ProSeries[] = [];
  const has = (id: string) => s.series.some((x) => x.id === id);
  const get = (id: string) => s.series.find((x) => x.id === id);
  const year = s.year;
  const seeds = (conf: "East" | "West") => conferenceTable(s, ctx, conf).map((r) => r.teamId);
  if (!s.series.length) {
    for (const conf of ["East", "West"] as const) {
      const t = seeds(conf);
      const cal = proCalendar(year);
      out.push(makeSeries(`${conf}-pi1`, conf, 0, t[6], t[7], 1, cal.playIn, `${conf} Play-In (7 vs 8)`));
      out.push(makeSeries(`${conf}-pi2`, conf, 0, t[8], t[9], 1, cal.playIn, `${conf} Play-In (9 vs 10)`));
    }
    return out;
  }
  for (const conf of ["East", "West"] as const) {
    const a = get(`${conf}-pi1`)!,
      b = get(`${conf}-pi2`)!;
    if (a.winner && b.winner && !has(`${conf}-pi3`)) {
      const loser = a.winner === a.high ? a.low : a.high;
      out.push(makeSeries(`${conf}-pi3`, conf, 0, loser, b.winner, 1, addDays(proCalendar(year).playIn, 2), `${conf} Play-In (final spot)`));
    }
    const c = get(`${conf}-pi3`);
    if (c?.winner && a.winner && !has(`${conf}-r1-0`)) {
      const t = seeds(conf);
      const pairs = [
        [t[0], c.winner],
        [t[3], t[4]],
        [t[2], t[5]],
        [t[1], a.winner],
      ];
      pairs.forEach(([h, l], i) => out.push(makeSeries(`${conf}-r1-${i}`, conf, 1, h, l, 7, roundStart(year, 1))));
    }
    for (const round of [2, 3]) {
      const prev = s.series.filter((x) => x.conf === conf && x.round === round - 1);
      if (prev.length && prev.every((x) => x.winner) && !has(`${conf}-r${round}-0`)) {
        const order = new Map(seeds(conf).map((id, i) => [id, i]));
        for (let i = 0; i < prev.length; i += 2) {
          const [p, q] = [prev[i].winner!, prev[i + 1].winner!];
          const [h, l] = order.get(p)! <= order.get(q)! ? [p, q] : [q, p];
          out.push(makeSeries(`${conf}-r${round}-${i / 2}`, conf, round, h, l, 7, roundStart(year, round)));
        }
      }
    }
  }
  const e = get("East-r3-0"),
    w = get("West-r3-0");
  if (e?.winner && w?.winner && !has("finals")) {
    const st = standings(
      s.games.filter((g) => g.kind === "region"),
      [e.winner, w.winner],
    );
    const [h, l] = st.get(e.winner)!.w >= st.get(w.winner)!.w ? [e.winner, w.winner] : [w.winner, e.winner];
    out.push(makeSeries("finals", "Finals", 4, h, l, 7, roundStart(year, 4)));
  }
  return out;
}

/** Runs play-in games and series up to the date, stopping at your games; creates each next game as the one before it ends. */
function runPlayoffs(c: Career, season: ProSeason, ctx: HsContext, until: IsoDate, rng: Rng, str: Map<string, number>): ProSeason {
  if (season.games.some((g) => g.kind === "region" && !g.result)) return season;
  const s: ProSeason = { ...season, games: [...season.games], series: season.series.map((x) => ({ ...x, games: [...x.games] })) };
  const byId = new Map(s.games.map((g) => [g.id, g]));
  for (let guard = 0; guard < 600; guard++) {
    let changed = false;
    const fresh = nextSeries(s, ctx);
    if (fresh.length) {
      s.series.push(...fresh);
      changed = true;
    }
    for (const x of s.series) {
      if (x.winner) continue;
      const w = seriesWins(x, byId);
      const need = Math.ceil(x.bestOf / 2);
      if (w.high >= need || w.low >= need) {
        x.winner = w.high >= need ? x.high : x.low;
        changed = true;
        continue;
      }
      const last = x.games.length ? byId.get(x.games[x.games.length - 1]) : undefined;
      if (last && !last.result) {
        if (last.date > until) continue;
        const mine = last.homeId === s.teamId || last.awayId === s.teamId;
        if (mine && !inDevLeague(s) && !(s.injury && s.injury.left > 0)) continue; // yours to play
        const res = simPro(str.get(last.homeId)!, str.get(last.awayId)!, rng);
        const done = { ...last, result: mine ? { ...res, dnp: true } : res };
        byId.set(done.id, done);
        s.games[s.games.findIndex((g) => g.id === done.id)] = done;
        if (mine && s.injury) s.injury = { ...s.injury, left: s.injury.left - 1 };
        changed = true;
        continue;
      }
      const i = x.games.length;
      const highHome = x.bestOf === 1 || [0, 1, 4, 6].includes(i);
      const g: ScheduledGame = {
        id: `${x.id}-${s.year}-g${i}`,
        date: addDays(x.start, i * 2),
        level: "pro",
        homeId: highHome ? x.high : x.low,
        awayId: highHome ? x.low : x.high,
        kind: "playoff",
        label: x.bestOf === 1 ? x.label : `${x.label} Game ${i + 1}`,
      };
      x.games.push(g.id);
      s.games.push(g);
      byId.set(g.id, g);
      changed = true;
    }
    if (!changed) break;
  }
  return s;
}

const impactOf = (a: NonNullable<ReturnType<typeof averages>>) => a.ppg + a.rpg * 0.7 + a.apg * 0.9 + (a.spg + a.bpg) * 1.2;
/** A year of production as one number. */
export const seasonImpact = (s: ProSeason) => {
  const a = averages(s.stats);
  return a ? impactOf(a) : 0;
};

/** Fame: what you've won and what you're doing now (0..100). */
export function fame(c: Career) {
  const seasons = c.pro?.seasons ?? [];
  const honors = seasons.flatMap((s) => s.awards).length;
  const last = seasons.filter((s) => s.stats.gp > 0).at(-1);
  const crowd = c.story ? (c.story.fans - 50) * 0.2 : 0;
  return clamp(honors * 4 + (last ? seasonImpact(last) * 1.1 : 0) + crowd, 0, 100);
}

/** All-Star voting just before the break, and the 3-point contest for the best shooters. */
function allStarWeekend(c: Career, s: ProSeason, ctx: HsContext): ProSeason {
  if (s.allStar?.decided || inDevLeague(s)) return s.allStar ? s : { ...s, allStar: { decided: true, selected: false } };
  const a = averages(s.stats);
  const selected = !!a && a.gp >= 15 && impactOf(a) + fame(c) * 0.03 >= 30 && !(s.injury && s.injury.left > 0);
  if (!selected) return { ...s, allStar: { decided: true, selected: false } };
  const date = proCalendar(s.year).allStar;
  const conf = conferenceShort(ctx, s.teamId);
  const game: ScheduledGame = {
    id: `allstar-${s.year}`,
    date,
    level: "pro",
    homeId: `pro-allstar-${conf === "East" ? "east" : "west"}`,
    awayId: `pro-allstar-${conf === "East" ? "west" : "east"}`,
    kind: "allstar",
    neutral: true,
    label: "All-Star Game",
  };
  const contest = c.player.ratings.three >= 74 ? threePointContest(c, s) : {};
  return { ...s, allStar: { decided: true, selected: true, ...contest }, games: [...s.games, game] };
}

function threePointContest(c: Career, s: ProSeason) {
  const score = (shots: { made: boolean; money: boolean }[]) => shots.reduce((t, x) => t + (x.made ? (x.money ? 2 : 1) : 0), 0);
  const mine = score(simulateContestRound(c.player, `${c.seed}:${s.year}`));
  const best = Math.max(
    ...Array.from({ length: 7 }, (_, i) =>
      score(simulateContestRound({ ...c.player, ratings: { ...c.player.ratings, three: 85 + (i % 8) } }, `${c.seed}:${s.year}:${i}`)),
    ),
  );
  return { threeScore: mine, threeWon: mine > best };
}

/** Simulates the league up to `date` except your own games, sitting out while hurt, and moves the date forward. */
export function advancePro(c: Career, date: IsoDate, ctx: HsContext): Career {
  let s = currentPro(c);
  if (!s) return { ...c, date };
  let until = date;
  const allStarDay = addDays(proCalendar(s.year).allStar, -3);
  for (let guard = 0; guard < 12; guard++) {
    const cur: ProSeason = s;
    if (!cur.allStar?.decided && date >= allStarDay && (until >= allStarDay || openGames(cur).every((g) => g.date >= allStarDay)))
      s = allStarWeekend(c, cur, ctx);
    const now: ProSeason = s;
    const hurt = now.injury?.left ?? 0;
    const open = openGames(now);
    const stop = open[hurt];
    until = stop && stop.date <= date ? stop.date : date;
    const rng = new Rng(`${c.seed}:pro-sim:${until}:${guard}`);
    const str = strengths(c, now, ctx);
    let left = hurt;
    const sim = (g: ScheduledGame): ScheduledGame => {
      if (g.result || g.date > until) return g;
      const mine = isMine(now, g) && g.kind !== "allstar";
      if (mine && !inDevLeague(now)) {
        if (left <= 0) return g;
        left--;
        return { ...g, result: { ...simPro(str.get(g.homeId)!, str.get(g.awayId)!, rng), dnp: true } };
      }
      if (g.kind === "allstar") return g;
      return { ...g, result: simPro(str.get(g.homeId)!, str.get(g.awayId)!, rng, g.neutral) };
    };
    const games = now.games.map(sim);
    let devGames = now.devGames;
    if (inDevLeague(now))
      devGames = devGames?.map((g) => (g.result || g.date > until || left <= 0 ? g : (left--, { ...g, result: { ...simPro(70, 70, rng), dnp: true } })));
    const injury = now.injury && left > 0 ? { ...now.injury, left } : undefined;
    s = runPlayoffs(c, { ...now, games, devGames, injury }, ctx, until, rng, str);
    const after: ProSeason = s;
    if (openGames(after)[after.injury?.left ?? 0]?.id === stop?.id) break;
  }
  const weeks = Math.max(0, Math.floor((Date.parse(until) - Date.parse(c.date)) / (7 * 86_400_000)));
  const xp = Math.round(weeks * (9 + c.player.traits.workEthic * 7));
  const moved = withSeason({ ...c, date: until > c.date ? until : c.date }, s);
  return develop(withXp(moved, xp, until), until);
}

const conferenceLabel = (conf: string) => (conf === "East" ? "Eastern" : "Western");

/** The match for one of your games: league game, development game or the All-Star Game. */
export function proMatchSetup(c: Career, game: ScheduledGame, ctx: HsContext): MatchSetup {
  const s = currentPro(c)!;
  if (game.kind === "allstar") return allStarSetup(c, game, ctx);
  const t = team(ctx, s.teamId);
  const opp = team(ctx, game.homeId === s.teamId ? game.awayId : game.homeId);
  const mine = withUser(s.roster, c.player);
  let starters = pickStarters(mine);
  if (s.role === "starter" && !starters.includes(c.player.id)) {
    const out = mine.filter((p) => starters.includes(p.id)).sort((a, b) => playerOvr(a) - playerOvr(b))[0];
    starters = starters.map((id) => (id === out.id ? c.player.id : id));
  }
  if (s.role !== "starter") starters = pickStarters(s.roster);
  const rotation = { [c.player.id]: ROLE_MINUTES[s.role] };
  const theirs = inDevLeague(s) ? devRoster(opp, s.year) : generateRoster(opp, s.year);
  const us = { team: t, roster: mine, starters, rotation };
  const them = { team: opp, roster: theirs, starters: pickStarters(theirs) };
  return {
    league: "pro",
    home: game.homeId === s.teamId ? us : them,
    away: game.homeId === s.teamId ? them : us,
    lockPlayerId: c.player.id,
    difficulty: c.settings.difficulty,
    seed: Math.abs(hashGame(game.id + c.seed)) % 1_000_000,
  };
}

/** East against West: the best player from each team in the conference, plus you. */
function allStarSetup(c: Career, game: ScheduledGame, ctx: HsContext): MatchSetup {
  const s = currentPro(c)!;
  const side = (conf: "East" | "West", withYou: boolean) => {
    const teams = ctx.pros!.filter((t) => conferenceShort(ctx, t.id) === conf);
    const base = teams[0];
    const roster = teams
      .map((t) => [...generateRoster(t, s.year)].sort((a, b) => playerOvr(b) - playerOvr(a))[0])
      .sort((a, b) => playerOvr(b) - playerOvr(a))
      .slice(0, withYou ? 11 : 12)
      .map((p, i) => ({ ...p, jersey: i + 1 }));
    const players = withYou ? withUser(roster, c.player) : roster;
    return {
      team: { ...base, id: `pro-allstar-${conf.toLowerCase()}`, name: conferenceLabel(conf), nickname: "All-Stars", abbrev: conf.toUpperCase() },
      roster: players,
      starters: pickStarters(players),
    };
  };
  const conf = conferenceShort(ctx, s.teamId);
  const homeConf = game.homeId.endsWith("east") ? "East" : "West";
  return {
    league: "pro",
    home: side(homeConf, conf === homeConf),
    away: side(homeConf === "East" ? "West" : "East", conf !== homeConf),
    lockPlayerId: c.player.id,
    difficulty: c.settings.difficulty,
    seed: Math.abs(hashGame(game.id + c.seed)) % 1_000_000,
  };
}

/** Records one of your games: stats, XP, trust, chemistry, injuries, role changes, call-ups and promises. */
export function applyProGame(c: Career, gameId: string, o: UserGameOutcome, ctx: HsContext): Career {
  const s = currentPro(c)!;
  const inDev = inDevLeague(s);
  const list = inDev ? (s.devGames ?? []) : s.games;
  const game = list.find((g) => g.id === gameId);
  if (!game || game.result) return c;
  const line = o.box[c.player.id];
  const dnp = !line || line.min < 1;
  const mySide = new Set([...s.roster.map((p) => p.id), c.player.id]);
  const result: GameResult = {
    home: o.homeScore,
    away: o.awayScore,
    played: o.played,
    overtimes: o.overtimes,
    ...(dnp ? { dnp: true } : { userLine: line }),
    box: Object.fromEntries(Object.entries(o.box).filter(([id]) => mySide.has(id))),
    playerOfGame: o.playerOfGame,
  };
  const updated = list.map((g) => (g.id === gameId ? { ...g, result } : g));
  const gs = dnp ? 0 : gameScore(line);
  if (game.kind === "allstar") {
    const homeSide = game.homeId.endsWith(conferenceShort(ctx, s.teamId).toLowerCase());
    const won = homeSide === o.homeScore > o.awayScore;
    const mvp = won && gs >= 18;
    const next = withSeason({ ...c, date: game.date }, { ...s, games: updated, allStar: { ...s.allStar!, mvp } });
    return {
      ...next,
      log: [...next.log, log(game.date, mvp ? "All-Star Game MVP!" : `${dnp ? 0 : line.pts} points in the All-Star Game.`, mvp ? "award" : "game")],
    };
  }
  const won = (game.homeId === s.teamId) === o.homeScore > o.awayScore;
  const isPlayoff = game.kind === "playoff";
  const stats = dnp || isPlayoff ? s.stats : { ...addLine(s.stats, line), gp: s.stats.gp + 1, gs: s.stats.gs + (s.role === "starter" ? 1 : 0) };
  const playoffStats =
    dnp || !isPlayoff
      ? s.playoffStats
      : { ...addLine(s.playoffStats, line), gp: s.playoffStats.gp + 1, gs: s.playoffStats.gs + (s.role === "starter" ? 1 : 0) };
  const trust = dnp ? s.trust : clamp(s.trust + clamp((gs - ROLE_GAME_SCORE[s.role]) * 0.3 + (won ? 0.3 : -0.15), -2.5, 2.5), 0, 100);
  const chemistry = clamp(s.chemistry + (won ? 0.5 : -0.4) + c.pro!.teamFirst * 0.1, 0, 100);
  const role = proRole(playerOvr(c.player), s.roster, trust);
  const hurt = o.injuries?.find((i) => i.playerId === c.player.id && i.gamesOut > 0);
  const injury = hurt ? { name: hurt.name, left: hurt.gamesOut } : s.injury;
  let next = withSeason(
    { ...c, date: game.date },
    { ...s, ...(inDev ? { devGames: updated } : { games: updated }), stats, playoffStats, trust, chemistry, role, ...(injury ? { injury } : {}) },
  );
  const mult = { rookie: 0.8, pro: 1, allstar: 1.15, superstar: 1.3, hof: 1.45, legend: 1.6 }[c.settings.difficulty];
  next = withXp(next, Math.round((dnp ? 5 : clamp(15 + gs * 3, 5, 90) + (won ? 10 : 0)) * mult * (o.played ? 1.25 : 1) * 0.6), game.date);
  const oppId = game.homeId === s.teamId ? game.awayId : game.homeId;
  if (!dnp && (line.pts >= 35 || (line.pts >= 10 && line.oreb + line.dreb >= 10 && line.ast >= 10)))
    next = { ...next, log: [...next.log, log(game.date, `${line.pts} points vs ${team(ctx, oppId).name}.`, "game")] };
  if (hurt)
    next = {
      ...next,
      inbox: [...next.inbox, msg(game.date, "Trainer", hurt.name, `You'll miss about ${hurt.gamesOut} game${hurt.gamesOut === 1 ? "" : "s"}.`)],
      log: [...next.log, log(game.date, `${hurt.name}: out about ${hurt.gamesOut} game${hurt.gamesOut === 1 ? "" : "s"}.`, "move")],
    };
  if (role !== s.role) {
    const up = ROLE_MINUTES[role] > ROLE_MINUTES[s.role];
    next = {
      ...next,
      inbox: [
        ...next.inbox,
        msg(
          game.date,
          "Coach",
          up ? "You've earned more minutes" : "Your role is changing",
          `${ROLE_NAME[role]} now, about ${ROLE_MINUTES[role]} minutes a night.`,
        ),
      ],
      log: [...next.log, log(game.date, `${up ? "Moved up" : "Moved down"} to ${ROLE_NAME[role].toLowerCase()}.`, "move")],
    };
  }
  next = checkPromise(next, game.date);
  next = checkTrade(next, game.date, ctx);
  return inDev ? checkCallUp(next, game.date, ctx) : next;
}

/** A promised role that isn't there after 20 games is a broken promise: your coach owes you, and a trade is yours for the asking. */
function checkPromise(c: Career, date: IsoDate): Career {
  const s = currentPro(c)!;
  if (!s.promise || s.promise.broken || s.stats.gp < PROMISE_GAMES) return c;
  if (ROLE_MINUTES[s.role] >= ROLE_MINUTES[s.promise.role]) return c;
  const next = withSeason(c, { ...s, promise: { ...s.promise, broken: true }, chemistry: clamp(s.chemistry - 8, 0, 100) });
  return {
    ...next,
    inbox: [
      ...next.inbox,
      msg(
        date,
        agentById(c.pro!.preDraft.agent).name,
        "They broke their promise",
        `They promised you a role as ${ROLE_NAME[s.promise.role].toLowerCase()}. If you ask for a trade now, they'll have to listen.`,
      ),
    ],
  };
}

/** Development players get called up by outplaying the league or outgrowing the roster above. */
function checkCallUp(c: Career, date: IsoDate, ctx: HsContext): Career {
  const s = currentPro(c)!;
  const a = averages(s.stats);
  if (!a || a.gp < 8) return c;
  const pro = generateRoster(team(ctx, s.teamId), s.year);
  const tenth = pro.map(playerOvr).sort((x, y) => y - x)[9] ?? 70;
  const twoWay = s.status === "twoWay" ? 2 : 0;
  if (playerOvr(c.player) + twoWay < tenth && impactOf(a) < 34 - twoWay * 2) return c;
  const roster = pro;
  const trust = 45;
  const next = withSeason(c, {
    ...s,
    status: "standard",
    roster,
    trust,
    role: proRole(playerOvr(c.player), roster, trust),
    games: s.games,
  });
  const name = team(ctx, s.teamId).name;
  return {
    ...withPro(next, { status: "standard" }),
    player: { ...next.player, contract: { salary: MIN_SALARY, years: 1 } },
    inbox: [...next.inbox, msg(date, name, "You've been called up", "Pack your bags. You've earned a spot on the big club.")],
    log: [...next.log, log(date, `Called up to ${name}.`)],
  };
}

export const canRequestTrade = (c: Career) => {
  const s = currentPro(c);
  return !!s && !s.wrapped && !inDevLeague(s) && !s.tradeRequested && c.date < proCalendar(s.year).tradeDeadline;
};
export function requestTrade(c: Career): Career {
  const s = currentPro(c);
  if (!s || !canRequestTrade(c)) return c;
  const next = withSeason(c, {
    ...s,
    tradeRequested: true,
    trust: clamp(s.trust - (s.promise?.broken ? 0 : 10), 0, 100),
    chemistry: clamp(s.chemistry - 5, 0, 100),
  });
  return { ...next, log: [...next.log, log(c.date, "Requested a trade.", "move")] };
}

/** Your request gets answered within a few games; a broken promise or a bigger name moves it along. */
function checkTrade(c: Career, date: IsoDate, ctx: HsContext): Career {
  const s = currentPro(c)!;
  if (!s.tradeRequested || date >= proCalendar(s.year).tradeDeadline) return c;
  const rng = new Rng(`${c.seed}:trade:${date}`);
  if (!rng.chance(s.promise?.broken ? 0.5 : 0.2)) return c;
  return tradeTo(c, rng.pick(ctx.pros!.filter((t) => t.id !== s.teamId)).id, date, ctx);
}

/** Moves you to a new team mid-season. League results so far stand; your schedule is your new team's the rest of the way. */
export function tradeTo(c: Career, teamId: string, date: IsoDate, ctx: HsContext): Career {
  const s = currentPro(c)!;
  const t = team(ctx, teamId);
  const roster = generateRoster(t, s.year);
  const trust = clamp(50 + (playerOvr(c.player) - ([...roster.map(playerOvr)].sort((a, b) => b - a)[4] ?? 70)) * 3, 25, 85);
  const next = withSeason(c, {
    ...s,
    teamId,
    roster,
    trust,
    chemistry: 50,
    role: proRole(playerOvr(c.player), roster, trust),
    tradeRequested: false,
    promise: undefined,
  });
  return {
    ...next,
    player: { ...next.player, teamId },
    inbox: [...next.inbox, msg(date, t.name, "Welcome to the team", "We traded for you because we think you can help us win now.")],
    log: [...next.log, log(date, `Traded to ${t.name}.`, "move")],
  };
}

const finishText = (s: ProSeason) => {
  const mine = s.series.filter((x) => x.high === s.teamId || x.low === s.teamId);
  const last = mine.at(-1);
  if (!last) return "Missed the playoffs";
  if (last.winner !== s.teamId) return `Lost in the ${last.label}`;
  return last.id === "finals" ? "Won the championship" : `Won the ${last.label}`;
};

/** The best of the rest of the league each year: awards go to whoever beats them, so a great year can still come up short. */
export const FIELD = { mvp: [60, 6], first: [50, 4], second: [44, 3], third: [40, 3], scoring: [37, 3] } as const;
export function beatsField(seed: number, year: number, award: keyof typeof FIELD, value: number) {
  const [mean, sd] = FIELD[award];
  return value > new Rng(`${seed}:${year}:field:${award}`).normal(mean, sd);
}

/** Honors for your year, from production and team success. Finalists need a good team, and rookies have their own award. */
export function proAwards(c: Career, ctx: HsContext): string[] {
  const s = currentPro(c)!;
  const a = averages(s.stats);
  const out: string[] = [];
  if (s.allStar?.selected) out.push("All-Star");
  if (s.allStar?.mvp) out.push("All-Star Game MVP");
  if (s.allStar?.threeWon) out.push("Three-Point Contest champion");
  const champ = s.series.find((x) => x.id === "finals")?.winner === s.teamId;
  if (champ && s.stats.gp > 0) out.push("League champion");
  if (!a || a.gp < 40 || inDevLeague(s)) {
    if (a && inDevLeague(s) && a.gp >= 15 && impactOf(a) >= 30) out.push("Development League All-Star");
    return out;
  }
  const impact = impactOf(a);
  const table = conferenceTable(s, ctx, conferenceShort(ctx, s.teamId));
  const seed = table.findIndex((r) => r.teamId === s.teamId) + 1;
  const stocks = a.spg + a.bpg;
  const defense = stocks + (c.player.ratings.perimeterD + c.player.ratings.interiorD) / 200;
  const beats = (award: keyof typeof FIELD) => beatsField(c.seed, s.year, award, award === "scoring" ? a.ppg : impact);
  if (beats("mvp") && seed <= 3) out.push("Most Valuable Player");
  if (beats("first")) out.push("All-League First Team");
  else if (beats("second")) out.push("All-League Second Team");
  else if (beats("third")) out.push("All-League Third Team");
  if (defense >= 4.4) out.push("Defensive Player of the Year");
  if (defense >= 3.8) out.push("All-Defensive Team");
  if (beats("scoring")) out.push("Scoring champion");
  const seasons = c.pro!.seasons.filter((x) => x.stats.gp >= 20);
  const rookie = seasons.length === 1;
  if (rookie && impact >= 20) out.push("Rookie of the Year");
  if (s.role === "sixth" && impact >= 22) out.push("Sixth Man of the Year");
  const prev = seasons.at(-2);
  if (prev && impact - seasonImpact(prev) >= 8 && impact >= 25) out.push("Most Improved Player");
  const fa = averages(s.playoffStats);
  if (champ && fa && impactOf(fa) >= 30) out.push("Finals MVP");
  return out;
}

export const BADGES: { id: string; name: string; rating: RatingKey; test: (t: StatLine & { gp: number }) => boolean }[] = [
  { id: "deadeye", name: "Deadeye", rating: "three", test: (t) => t.tpm >= 200 },
  { id: "floorGeneral", name: "Floor General", rating: "passVision", test: (t) => t.gp >= 40 && t.ast / t.gp >= 8 },
  { id: "glassCleaner", name: "Glass Cleaner", rating: "strength", test: (t) => t.gp >= 40 && (t.oreb + t.dreb) / t.gp >= 10 },
  { id: "pickpocket", name: "Pickpocket", rating: "steal", test: (t) => t.gp >= 40 && t.stl / t.gp >= 1.8 },
  { id: "rimProtector", name: "Rim Protector", rating: "block", test: (t) => t.gp >= 40 && t.blk / t.gp >= 1.8 },
  { id: "bucket", name: "Walking Bucket", rating: "midRange", test: (t) => t.gp >= 40 && t.pts / t.gp >= 25 },
  { id: "ironMan", name: "Iron Man", rating: "stamina", test: (t) => t.gp >= 78 },
];

/** Great seasons earn badges for good: each lifts a rating and its cap by 2. */
function earnBadges(c: Career, date: IsoDate): Career {
  const s = currentPro(c)!;
  const earned = BADGES.filter((b) => b.test(s.stats) && !c.player.badges.includes(b.name));
  if (!earned.length) return c;
  const ratings = { ...c.player.ratings };
  const caps = { ...c.player.caps };
  for (const b of earned) {
    caps[b.rating] = Math.min(99, caps[b.rating] + 2);
    ratings[b.rating] = Math.min(caps[b.rating], ratings[b.rating] + 2);
  }
  return {
    ...c,
    player: { ...c.player, ratings, caps, badges: [...c.player.badges, ...earned.map((b) => b.name)] },
    log: [...c.log, ...earned.map((b) => log(date, `Earned the ${b.name} badge.`, "award"))],
  };
}

const BRANDS = ["Fastbreak Energy", "Hoopline Sneakers", "Courtside Headphones", "Crossover Apparel", "Summit Water", "Northline Trucks", "Baseline Watches"];

/** Brands pay for fame, and a well-connected agent gets you more. */
export function endorsementOffers(c: Career, year: number): Endorsement[] {
  const f = fame(c);
  if (f < 20) return [];
  const rng = new Rng(`${c.seed}:brands:${year}`);
  const mine = new Set(c.pro!.endorsements.map((e) => e.brand));
  const boost = 1 + agentById(c.pro!.preDraft.agent).endorsementBoost;
  return rng
    .shuffle(BRANDS.filter((b) => !mine.has(b)))
    .slice(0, f >= 60 ? 3 : f >= 35 ? 2 : 1)
    .map((brand) => ({ brand, perYear: Math.round((f * f * 900 * rng.range(0.7, 1.3) * boost) / 10_000) * 10_000, years: rng.int(2, 4) }));
}

export function signEndorsement(c: Career, brand: string): Career {
  const deal = c.pro?.endorsementOffers?.find((e) => e.brand === brand);
  if (!deal) return c;
  const next = withPro(c, { endorsements: [...c.pro!.endorsements, deal], endorsementOffers: c.pro!.endorsementOffers!.filter((e) => e.brand !== brand) });
  return { ...next, log: [...next.log, log(c.date, `Signed with ${brand}: ${money(deal.perYear)} a year for ${deal.years} years.`)] };
}

/** Ends the season: awards, badges, pay, a year off every contract and new endorsement offers. */
export function finishProSeason(c: Career, ctx: HsContext): Career {
  const s = currentPro(c)!;
  if (s.wrapped) return c;
  const end = proCalendar(s.year).seasonEnd;
  const awards = proAwards(c, ctx);
  const finish = inDevLeague(s) ? "Finished the development league season" : finishText(s);
  const table = (conf: "East" | "West") => conferenceTable(s, ctx, conf).map(({ teamId, w, l }) => ({ teamId, w, l }));
  const conf = conferenceShort(ctx, s.teamId);
  const seed = table(conf).findIndex((r) => r.teamId === s.teamId) + 1;
  const games = s.games.filter((g) => isMine(s, g) || g.kind === "playoff");
  const wrapped: ProSeason = { ...s, awards, finish, standings: [...table("East"), ...table("West")], seed, games, wrapped: true, injury: undefined };
  const agent = agentById(c.pro!.preDraft.agent);
  const pay = (c.player.contract?.salary ?? 0) * (1 - agent.fee) + c.pro!.endorsements.reduce((a, e) => a + e.perYear, 0);
  const contract = c.player.contract ? { ...c.player.contract, years: c.player.contract.years - 1 } : undefined;
  let next: Career = withSeason({ ...c, date: end > c.date ? end : c.date, player: { ...c.player, contract } }, wrapped);
  next = earnBadges(next, end);
  next = withPro(next, {
    earnings: c.pro!.earnings + Math.round(pay),
    endorsements: c.pro!.endorsements.map((e) => ({ ...e, years: e.years - 1 })).filter((e) => e.years > 0),
  });
  next = withPro(next, { endorsementOffers: endorsementOffers(next, s.year) });
  if (!contract || contract.years <= 0) next = withPro(next, { offers: contractOffers(next, ctx) });
  return {
    ...next,
    log: [...next.log, log(end, `${finish}.`), ...awards.map((a) => log(end, a, "award"))],
    inbox: [...next.inbox, msg(end, "Coach", "Season wrap-up", `${finish}.${awards.length ? ` Honors: ${awards.join(", ")}.` : ""}`)],
  };
}

/** What a player like you is worth a year on the open market. */
export function marketValue(c: Career) {
  const last = c.pro?.seasons.filter((s) => s.stats.gp > 0).at(-1);
  const ovr = playerOvr(c.player) + (last ? (seasonImpact(last) - 25) * 0.1 : 0);
  const age = c.player.age;
  const ageFactor = age >= 36 ? 0.45 : age >= 33 ? 0.7 : age >= 30 ? 0.9 : 1;
  const base = 1.1e6 + Math.pow(Math.max(0, ovr - 60) / 32, 2.4) * 50e6;
  return clamp(base * ageFactor, MIN_SALARY, MAX_SALARY);
}

/** Free agency: your own team and a few others bid, shaped by your agent, your age and the role each one can give you. */
export function contractOffers(c: Career, ctx: HsContext): ContractOffer[] {
  const s = currentPro(c)!;
  // nobody signs a 41-year-old, or a veteran the league has passed by
  if (c.player.age >= MAX_AGE || (c.player.age >= 34 && playerOvr(c.player) < 66)) return [];
  const year = s.year + 1;
  const rng = new Rng(`${c.seed}:fa:${year}`);
  const value = marketValue(c) * (1 + agentById(c.pro!.preDraft.agent).contractBoost);
  const others = rng.shuffle(ctx.pros!.filter((t) => t.id !== s.teamId)).slice(0, c.player.age >= 36 ? 2 : 4);
  const ovr = playerOvr(c.player);
  // the league still has to want you: below its last roster spots, your deal is another year in the development league
  if (inDevLeague(s) && ovr < DEV_CALL_UP_OVR) return [{ teamId: s.teamId, salary: 45_000, years: 1, role: "starter", promise: false, dev: true }];
  const offer = (t: Team, mult: number): ContractOffer => {
    const role = proRole(ovr, generateRoster(t, year), 55);
    const maxYears = c.player.age >= 34 ? 1 : c.player.age >= 31 ? 2 : 4;
    return {
      teamId: t.id,
      salary: Math.round(clamp(value * mult, MIN_SALARY, MAX_SALARY) / 10_000) * 10_000,
      years: rng.int(1, maxYears),
      role,
      promise: rng.chance(0.4),
    };
  };
  return [offer(team(ctx, s.teamId), 1.04), ...others.map((t) => offer(t, rng.range(0.88, 1.1)))];
}

/** Ask for more: the bigger the ask, the likelier they walk. An agent who drives a hard bargain helps. */
export function negotiate(c: Career, teamId: string, raise: number): { career: Career; accepted: boolean } {
  const list = c.pro?.offers ?? [];
  const o = list.find((x) => x.teamId === teamId);
  if (!o || o.pulled || o.raised) return { career: c, accepted: false };
  const rng = new Rng(`${c.seed}:negotiate:${teamId}:${c.date}`);
  const hard = agentById(c.pro!.preDraft.agent).contractBoost > 0 ? 0.15 : 0;
  const accepted = rng.chance(clamp(1 - raise * 6 + hard, 0.05, 0.95));
  const updated = accepted
    ? { ...o, salary: Math.min(MAX_SALARY, Math.round((o.salary * (1 + raise)) / 10_000) * 10_000), raised: true }
    : { ...o, pulled: true };
  return { career: withPro(c, { offers: list.map((x) => (x.teamId === teamId ? updated : x)) }), accepted };
}

export function signContract(c: Career, teamId: string, ctx: HsContext): Career {
  const o = c.pro?.offers?.find((x) => x.teamId === teamId && !x.pulled);
  if (!o) return c;
  const s = currentPro(c)!;
  const t = team(ctx, teamId);
  const date = iso(s.year + 1, 7, 1);
  const keep = withPro(c, { offers: o.promise ? [o] : undefined, status: o.dev ? c.pro!.status : "standard" });
  return {
    ...keep,
    date: date > c.date ? date : c.date,
    player: { ...keep.player, teamId, contract: { salary: o.salary, years: o.years } },
    log: [
      ...keep.log,
      log(
        date,
        `${teamId === s.teamId ? "Re-signed with" : "Signed with"} ${t.name}: ${o.years} year${o.years > 1 ? "s" : ""}, ${money(o.salary)} a season.`,
        "move",
      ),
    ],
  };
}
