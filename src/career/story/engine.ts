// The story of a career: reads what actually happened (the log and your games) and turns it into press conferences,
// decisions, texts and social posts. Your answers shape your personality and your standing, which feed the rest of the game.
import { generatePlayer } from "@/engine/player";
import { Rng, clamp } from "@/engine/rng";
import type { Team } from "@/engine/types";
import { gameScore } from "@/game/sim/stats";
import { currentCollege } from "../college/season";
import { currentSeason, type HsContext } from "../hs/season";
import { currentPro } from "../pro/season";
import { HALL_OF_LEGENDS } from "../pro/retire";
import type { Career, CareerLogEntry, IsoDate, PhoneText, ScheduledGame, SocialPost, StoryChoice, StoryEffect, StoryEvent, StoryState } from "../types";
import {
  FAN_NAMES,
  MEDIA_DAY,
  POSTGAME_LOSS,
  POSTGAME_WIN,
  POSTS,
  POSTSEASON,
  RANDOM_EVENTS,
  RIVAL_GAME,
  SCRIPTED,
  TEXTS,
  type EventTemplate,
} from "./content";

/** How often optional story beats fire at each setting. */
export const STORY_RATE = { low: 0.35, normal: 0.7, high: 1 } as const;
export const MAX_PENDING = 3;
const MAX_FEED = 120;
const MAX_THREAD = 40;
export const MOM = "Mom";

interface Vars {
  team?: string;
  opp?: string;
  pts?: number;
  award?: string;
  text?: string;
}

function fill(text: string, c: Career, s: StoryState, v: Vars, ctx: HsContext) {
  return text
    .replaceAll("{name}", `${c.player.firstName} ${c.player.lastName}`)
    .replaceAll("{hometown}", c.player.hometown.split(",")[0])
    .replaceAll("{mentor}", s.mentor)
    .replaceAll("{rival}", s.rival.name)
    .replaceAll("{rivalTeam}", teamOf(s.rival.teamId, ctx)?.name ?? "another school")
    .replaceAll("{team}", v.team ?? currentTeamName(c, ctx))
    .replaceAll("{opp}", v.opp ?? "them")
    .replaceAll("{pts}", String(v.pts ?? 0))
    .replaceAll("{award}", v.award ?? "")
    .replaceAll("{text}", v.text ?? "");
}

const teamOf = (id: string | null | undefined, ctx: HsContext): Team | undefined =>
  id ? (ctx.byId.get(id) ?? ctx.collegeById?.get(id) ?? ctx.proById?.get(id)) : undefined;
const currentTeamName = (c: Career, ctx: HsContext) => teamOf(c.player.teamId, ctx)?.name ?? "the team";

/** Starts the story: a mentor from the Hall of Legends and a rival in your class from a school nearby. */
export function initStory(c: Career, ctx: HsContext): StoryState {
  const rng = new Rng(`${c.seed}:story`);
  const mentor = rng.pick(HALL_OF_LEGENDS).name;
  const school = ctx.byId.get(c.hs.schoolId);
  const nearby = ctx.teams.filter((t) => t.conferenceId === school?.conferenceId && t.id !== school?.id);
  const home = rng.pick(nearby.length ? nearby : ctx.teams);
  const p = generatePlayer(rng, {
    pos: c.player.pos,
    targetOvr: 45,
    age: c.player.age,
    league: "hs",
    teamId: home.id,
    classYear: "FR",
    hometownPool: "az",
    idPrefix: "rival",
  });
  return {
    confident: 0,
    star: 0,
    fans: 50,
    media: 50,
    teammates: 50,
    coach: 50,
    mentor,
    rival: { name: `${p.firstName} ${p.lastName}`, pos: p.pos, teamId: home.id, wins: 0, losses: 0 },
    pending: [],
    threads: {},
    unread: [],
    feed: [],
    impact: [],
    logSeen: c.log.length,
    gamesSeen: ownResults(c).length,
    mediaDays: [],
    used: [],
    ticks: 0,
  };
}

/** Your finished games at the stage you're at. */
function ownResults(c: Career): { game: ScheduledGame; teamId: string }[] {
  if (c.stage === "pro" || c.stage === "retired") {
    const s = currentPro(c);
    if (!s) return [];
    const games = s.status === "standard" ? s.games : (s.devGames ?? []);
    return games
      .filter((g) => g.result?.userLine && g.kind !== "allstar" && (g.homeId === s.teamId || g.awayId === s.teamId))
      .map((game) => ({ game, teamId: s.teamId }));
  }
  if (c.stage === "college") {
    const s = currentCollege(c);
    return (s?.games ?? [])
      .filter((g) => g.result?.userLine && (g.homeId === s!.teamId || g.awayId === s!.teamId))
      .map((game) => ({ game, teamId: s!.teamId }));
  }
  const s = currentSeason(c);
  return (s?.games ?? [])
    .filter((g) => g.result?.userLine && (g.homeId === s!.schoolId || g.awayId === s!.schoolId))
    .map((game) => ({ game, teamId: s!.schoolId }));
}

/** A key that changes every season at every stage, for counting games and media days. */
function seasonKey(c: Career) {
  if (c.stage === "pro") {
    const s = currentPro(c);
    return s ? `pro-${s.year}` : null;
  }
  if (c.stage === "college") {
    const s = currentCollege(c);
    return s ? `col-${s.year}` : null;
  }
  if (c.stage === "hs") {
    const s = currentSeason(c);
    return s?.tryout ? `hs-${s.year}` : null;
  }
  return null;
}

class Story {
  s: StoryState;
  constructor(
    public c: Career,
    state: StoryState,
    public ctx: HsContext,
    public rng: Rng,
  ) {
    this.s = {
      ...state,
      pending: [...state.pending],
      threads: { ...state.threads },
      unread: [...state.unread],
      feed: [...state.feed],
      used: [...state.used],
      mediaDays: [...state.mediaDays],
      rival: { ...state.rival },
    };
  }
  get rate() {
    return STORY_RATE[this.c.settings.storyFrequency];
  }
  text(from: string, date: IsoDate, line: string, v: Vars = {}) {
    const thread = this.s.threads[from] ?? [];
    const msg: PhoneText = { date, text: fill(line, this.c, this.s, v, this.ctx) };
    this.s.threads[from] = [...thread, msg].slice(-MAX_THREAD);
    if (!this.s.unread.includes(from)) this.s.unread.push(from);
  }
  post(date: IsoDate, line: string, v: Vars = {}, author?: string) {
    const name = author ?? this.rng.pick(FAN_NAMES);
    const post: SocialPost = {
      date,
      author: name,
      handle: `@${name.toLowerCase()}`,
      text: fill(line, this.c, this.s, v, this.ctx),
      likes: Math.round(this.rng.range(10, 400) * (1 + this.s.fans / 25)),
    };
    this.s.feed = [post, ...this.s.feed].slice(0, MAX_FEED);
  }
  queue(t: EventTemplate, date: IsoDate, kind: StoryEvent["kind"], v: Vars = {}) {
    const key = `${t.id}-${date}`;
    if (this.s.pending.some((e) => e.id === key)) return;
    const f = (x: string) => fill(x, this.c, this.s, v, this.ctx);
    const ev: StoryEvent = {
      id: key,
      date,
      kind,
      title: f(t.title),
      from: t.from ? f(t.from) : undefined,
      body: f(t.body),
      choices: t.choices.map((x): StoryChoice => ({ ...x, text: f(x.text), reply: f(x.reply) })),
    };
    this.s.pending.push(ev);
    this.s.pending = this.s.pending.slice(-MAX_PENDING);
    this.s.used.push(t.id);
  }
  /** The template used least recently that hasn't been used in the last few events. */
  pick(list: EventTemplate[]): EventTemplate | null {
    const recent = new Set(this.s.used.slice(-6));
    const open = list.filter((t) => (!t.stages || t.stages.includes(this.c.stage)) && !recent.has(t.id) && !(t.once && this.s.used.includes(t.id)));
    return open.length ? this.rng.pick(open) : null;
  }
}

/** Reads a new log entry and reacts to it. */
function readLog(st: Story, e: CareerLogEntry) {
  const { s, c, rng } = st;
  const t = e.text;
  if (/^Made the /.test(t)) st.text(MOM, e.date, TEXTS.madeTeam[0]);
  else if (/^Called up to /.test(t)) st.text(s.mentor, e.date, TEXTS.calledUp[0]);
  else if (/^Enrolled at /.test(t)) {
    st.text(s.mentor, e.date, TEXTS.enrolled[0]);
    st.post(e.date, "{text}", { text: `${c.player.firstName} ${c.player.lastName} is officially on campus.` });
    moveRival(st, "college");
  } else if (/^Drafted /.test(t)) {
    st.text(s.mentor, e.date, TEXTS.drafted[0]);
    st.text(MOM, e.date, TEXTS.drafted[1]);
    st.post(e.date, "{text}", { text: `${t.replace("Drafted", `${c.player.firstName} ${c.player.lastName} drafted`)} What a night.` });
    st.queue(SCRIPTED.draft, e.date, "press");
    moveRival(st, "pro");
  } else if (/^Went undrafted/.test(t)) {
    st.text(s.mentor, e.date, TEXTS.badGame[0]);
    moveRival(st, "pro");
  } else if (/^Traded to /.test(t)) {
    st.text(s.mentor, e.date, TEXTS.traded[0]);
    st.post(e.date, "{text}", { text: `BREAKING: ${c.player.lastName} ${t.charAt(0).toLowerCase()}${t.slice(1)}` });
    st.queue(SCRIPTED.traded, e.date, "press");
  } else if (/: out about \d+ game/.test(t)) {
    st.text(s.mentor, e.date, TEXTS.injured[0]);
    st.text(MOM, e.date, TEXTS.injured[1]);
    st.post(e.date, "Get well soon, {name}.");
  } else if (e.kind === "award") {
    st.text(rng.chance(0.5) ? s.mentor : MOM, e.date, rng.pick(TEXTS.award), { award: t });
    if (rng.chance(0.7)) st.post(e.date, rng.pick(POSTS.award), { award: t });
    if (/champion/i.test(t) && !/Region|regular-season|Tournament champion|Contest/.test(t)) {
      st.text(s.mentor, e.date, TEXTS.champion[0]);
      st.queue(SCRIPTED.title, e.date, "press");
    }
  }
}

/** Your rival's path runs alongside yours. */
function moveRival(st: Story, stage: "college" | "pro") {
  const { ctx, rng, s } = st;
  const pool = stage === "college" ? (ctx.colleges ?? []).filter((t) => t.tier === "D1" && t.prestige > 0.5) : (ctx.pros ?? []);
  if (pool.length) s.rival.teamId = rng.pick(pool).id;
}

/** Reacts to one of your games: posts, a rivalry score, and sometimes the media. */
function readGame(st: Story, game: ScheduledGame, teamId: string, last: boolean) {
  const { s, rng, ctx } = st;
  const r = game.result!;
  const line = r.userLine!;
  const home = game.homeId === teamId;
  const won = home === r.home > r.away;
  const oppId = home ? game.awayId : game.homeId;
  const v: Vars = { opp: teamOf(oppId, ctx)?.name ?? "them", pts: line.pts };
  const big = gameScore(line) >= 22;
  const rivalGame = oppId === s.rival.teamId;
  if (rivalGame) {
    if (won) s.rival.wins++;
    else s.rival.losses++;
    st.post(game.date, rng.pick(POSTS.rival), v);
    if (last) st.queue(RIVAL_GAME[won ? 0 : 1], game.date, "press", v);
    return;
  }
  if (big && rng.chance(0.5)) st.post(game.date, rng.pick(POSTS.fanGood), v);
  else if (!won && line.pts <= 4 && rng.chance(0.15)) st.post(game.date, rng.pick(POSTS.fanBad), v);
  if (!last) return;
  // only the latest game gets the microphones, so a long sim doesn't stack up interviews
  const postseason = game.kind === "playoff" && won;
  if (postseason && rng.chance(0.6 * st.rate + 0.2)) {
    const t = st.pick(POSTSEASON);
    if (t) return st.queue(t, game.date, "press", v);
  }
  if (big && won && rng.chance(0.5 * st.rate)) {
    const t = st.pick(POSTGAME_WIN);
    if (t) return st.queue(t, game.date, "press", v);
  }
  if (!won && rng.chance(0.12 * st.rate)) {
    const t = st.pick(POSTGAME_LOSS);
    if (t) return st.queue(t, game.date, "press", v);
  }
  if (rng.chance(0.09 * st.rate)) {
    const t = st.pick(RANDOM_EVENTS);
    if (t) st.queue(t, game.date, "choice", v);
  }
}

/**
 * Brings the story up to date with the career. Safe to call after every change: it only reads
 * what's new, and returns the same career when nothing happened.
 */
export function storyTick(c: Career, ctx: HsContext): Career {
  if (c.stage === "retired" && c.story) return c;
  const base = c.story ?? initStory(c, ctx);
  const games = ownResults(c);
  const key = seasonKey(c);
  const newLog = c.log.length > base.logSeen;
  const dayDue = key && !base.mediaDays.includes(key);
  // a new season starts the game count over
  const gamesBack = games.length < base.gamesSeen;
  const newGames = games.length > base.gamesSeen || gamesBack;
  if (c.story && !newLog && !dayDue && !newGames) return c;
  const st = new Story(c, base, ctx, new Rng(`${c.seed}:tick:${base.ticks}`));
  const s = st.s;
  if (!c.story) {
    st.text(s.mentor, c.date, TEXTS.welcome[0]);
    st.text(s.mentor, c.date, TEXTS.rivalIntro[0]);
  }
  for (const e of c.log.slice(base.logSeen)) readLog(st, e);
  const fresh = gamesBack ? games : games.slice(base.gamesSeen);
  fresh.forEach(({ game, teamId }, i) => readGame(st, game, teamId, i === fresh.length - 1));
  if (dayDue) {
    s.mediaDays.push(key);
    const stage = c.stage === "hs" ? "hs" : c.stage === "college" ? "college" : "pro";
    st.queue({ ...MEDIA_DAY[stage], id: `${MEDIA_DAY[stage].id}-${key}` }, c.date, "press");
    if (stage !== "hs" && st.rng.chance(0.5)) st.post(c.date, st.rng.pick(POSTS.rivalNews));
  }
  const pro = currentPro(c);
  if (c.stage === "pro" && pro && !pro.wrapped && c.date >= `${pro.year + 1}-01-25` && c.date < `${pro.year + 1}-02-06` && !s.used.includes(`dl-${pro.year}`)) {
    s.used.push(`dl-${pro.year}`);
    if (st.rng.chance(0.3 * st.rate + 0.1)) st.queue(SCRIPTED.deadline, c.date, "press");
  }
  return { ...c, story: { ...s, logSeen: c.log.length, gamesSeen: games.length, ticks: base.ticks + 1 } };
}

const bump = (v: number, d = 0) => clamp(v + d, 0, 100);

/** What your standing does right away: the coach's trust and the locker room move with you. */
function applyToSeason(c: Career, fx: StoryEffect): Career {
  const coach = fx.coach ?? 0;
  const mates = fx.teammates ?? 0;
  if (c.stage === "college") {
    const s = currentCollege(c);
    if (!s) return c;
    const updated = { ...s, trust: bump(s.trust, coach * 0.6 + mates * 0.2) };
    return { ...c, college: { ...c.college!, seasons: [...c.college!.seasons.slice(0, -1), updated] } };
  }
  if (c.stage === "pro") {
    const s = currentPro(c);
    if (!s) return c;
    const updated = { ...s, trust: bump(s.trust, coach * 0.6), chemistry: bump(s.chemistry, mates * 0.6) };
    return { ...c, pro: { ...c.pro!, seasons: [...c.pro!.seasons.slice(0, -1), updated] } };
  }
  return c;
}

/** Answers a press conference or makes a decision. */
export function resolveEvent(c: Career, eventId: string, choiceIndex: number): { career: Career; reply: string } {
  const s = c.story;
  const ev = s?.pending.find((e) => e.id === eventId);
  const choice = ev?.choices[choiceIndex];
  if (!s || !ev || !choice) return { career: c, reply: "" };
  const story: StoryState = {
    ...s,
    confident: clamp(s.confident + (choice.confident ?? 0), -1, 1),
    star: clamp(s.star + (choice.star ?? 0), -1, 1),
    fans: bump(s.fans, choice.fans),
    media: bump(s.media, choice.media),
    teammates: bump(s.teammates, choice.teammates),
    coach: bump(s.coach, choice.coach),
    pending: s.pending.filter((e) => e.id !== eventId),
    impact: choice.impact ? [...s.impact, { date: c.date, text: choice.impactText ?? ev.title, points: choice.impact }] : s.impact,
  };
  const next = applyToSeason({ ...c, story }, choice);
  return {
    career: choice.impact ? { ...next, log: [...next.log, { date: c.date, text: choice.impactText ?? ev.title, kind: "story" }] } : next,
    reply: choice.reply,
  };
}

/** Skipping leaves the room waiting, which the press doesn't love. */
export function skipEvent(c: Career, eventId: string): Career {
  const s = c.story;
  const ev = s?.pending.find((e) => e.id === eventId);
  if (!s || !ev) return c;
  return { ...c, story: { ...s, pending: s.pending.filter((e) => e.id !== eventId), media: bump(s.media, ev.kind === "press" ? -2 : 0) } };
}

export function readThread(c: Career, who: string): Career {
  const s = c.story;
  return s?.unread.includes(who) ? { ...c, story: { ...s, unread: s.unread.filter((x) => x !== who) } } : c;
}

/** Your reply on the phone; everyone likes hearing back. */
export function replyText(c: Career, who: string, text: string): Career {
  const s = c.story;
  if (!s) return c;
  const thread = s.threads[who] ?? [];
  return { ...c, story: { ...s, threads: { ...s.threads, [who]: [...thread, { date: c.date, mine: true, text }].slice(-MAX_THREAD) } } };
}

/** The two personality scales, including your answers in pre-draft interviews. */
export function personality(c: Career) {
  const confident = clamp((c.story?.confident ?? 0) + (c.pro?.confidence ?? 0), -1, 1);
  const star = clamp((c.story?.star ?? 0) - (c.pro?.teamFirst ?? 0), -1, 1);
  const a = confident > 0.25 ? "Confident" : confident < -0.25 ? "Humble" : "Even-keeled";
  const b = star > 0.25 ? "Star" : star < -0.25 ? "Team-first" : "Balanced";
  return { confident, star, label: `${a}, ${b.toLowerCase()}` };
}

/** Is this game against your rival? */
export const isRivalGame = (c: Career, g: ScheduledGame) => !!c.story && (g.homeId === c.story.rival.teamId || g.awayId === c.story.rival.teamId);
