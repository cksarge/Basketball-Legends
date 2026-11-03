// College recruiting: a class of high school seniors, a weekly budget of points for calls, visits and scouting,
// offers that need a scholarship, and commitments that can flip until a recruit signs. AI programs recruit the
// same way, aiming at recruits who fit their standing.
import { standings } from "@/career/hs/sim";
import { addDays, iso, onOrAfter } from "@/career/calendar";
import type { IsoDate } from "@/career/types";
import { generatePlayer, playerOvr, teamTalentTarget } from "@/engine/player";
import { Rng, clamp } from "@/engine/rng";
import type { CollegeDivision, Player, Position, Team } from "@/engine/types";
import { reputation } from "../club/jobs";
import { staffRating } from "../coaching/staff";
import { readProspect, scoutMultiplier } from "../pro/scouting";
import { nilRoom, promiseNil, releaseNil } from "./nil";
import type { CollegeState, Franchise, Recruit, RecruitNeed } from "../types";

export const RECRUITS_PER_PROGRAM = 4.2;
/** Share of the class at or above each star level, best first. */
const STAR_SHARES: [5 | 4 | 3, number][] = [
  [5, 0.02],
  [4, 0.2],
  [3, 0.6],
];
export const COSTS = { call: 5, scout: 10, homeVisit: 25, officialVisit: 40, offer: 0, pullOffer: 0 };
const GAINS = { call: 4, homeVisit: 18, officialVisit: 35 };
/** Interest grows faster from programs that have offered. */
const OFFER_BOOST = 1.5;
export const MAX_OFFICIAL_VISITS = 5;
export const COMMIT_INTEREST = 120;
export const COMMIT_LEAD = 1.25;
/** The portal moves fast: three rounds, so transfers commit sooner. */
export const PORTAL_COMMIT = 50;
const FLIP_RATIO = 1.5;
const FLIP_CHANCE = 0.1;
export const SCHOLARSHIPS: Record<CollegeDivision, number> = { D1: 13, D2: 10, D3: 0 };
export const COLLEGE_ROSTER_MAX = 15;
/** Seasons of play before a player is out of eligibility. */
export const ELIGIBLE_SEASONS = 4;
const BASE_POINTS = 70;
const PRESTIGE_POINTS = 60;
const AVERAGE_ASSISTANT = 70;
const ASSISTANT_SPREAD = 200;
/** How many recruits an AI program works on at once, and how far past its open spots it offers. */
const AI_TARGETS = 8;
const AI_OFFER_RATIO = 1.5;
/** An AI program saves its official visits for recruits who already like it a little. */
const AI_VISIT_INTEREST = 30;
const NEED_WEIGHTS: Record<RecruitNeed, number> = { prestige: 3, playingTime: 3, nil: 2, distance: 2, winning: 2, coach: 1 };
/** How much his first, second and third wants count. They add to 1. */
const WANT_WEIGHTS = [0.5, 0.3, 0.2];
/** Known recruits are easier to read: scouting points they start with, by stars. */
const STAR_SCOUTING: Record<number, number> = { 5: 12, 4: 6, 3: 2, 2: 0 };
const SCOUT_POINTS = 6;
const NIL_BY_STARS: Record<number, number> = { 5: 600_000, 4: 150_000, 3: 30_000, 2: 5_000 };
export const NIL_DIVISION: Record<CollegeDivision, number> = { D1: 1, D2: 0.08, D3: 0.02 };
const CLASS_POINTS: Record<number, number> = { 5: 100, 4: 60, 3: 30, 2: 10 };
/** Recruits arrive this far below their division's average program, and spread this much. */
const RECRUIT_GAP = 7;
const RECRUIT_SPREAD = 5.5;
const PHENOM_CHANCE = 0.03;
const POSITIONS: Position[] = ["PG", "SG", "SF", "PF", "C"];

export type RecruitAction = "call" | "scout" | "homeVisit" | "officialVisit" | "offer" | "pullOffer";

const college = (f: Franchise): CollegeState => f.college!;
export const recruitPlayer = (f: Franchise, r: Recruit): Player => r.player ?? f.players[r.id];
const homeState = (p: Player) => p.hometown.slice(-2);

/** The second Wednesday of November. */
export const earlySigningDate = (year: number): IsoDate => addDays(onOrAfter(iso(year, 11, 1), 3), 7);

export function weeklyPoints(f: Franchise, teamId: string, team: Team): number {
  const assistant = teamId === f.teamId ? staffRating(f, "assistant") : AVERAGE_ASSISTANT;
  return Math.round((BASE_POINTS + PRESTIGE_POINTS * team.prestige) * (1 + (assistant - AVERAGE_ASSISTANT) / ASSISTANT_SPREAD));
}

export function refillPoints(f: Franchise, teams: Team[]): Franchise {
  const points = Object.fromEntries(teams.map((t) => [t.id, weeklyPoints(f, t.id, t)]));
  return { ...f, college: { ...college(f), points } };
}

/** Will he still be on the roster next season? */
export function returning(f: Franchise, id: string): boolean {
  const p = f.players[id];
  return (p.file?.eligibility?.used ?? 0) < ELIGIBLE_SEASONS - 1 && !college(f).declared.some((d) => d.id === id);
}

/** Scholarships (or, in Division III, roster spots) still free for next season. */
export function openScholarships(f: Franchise, teamId: string): number {
  const c = college(f);
  const back = f.rosters[teamId].filter((id) => returning(f, id));
  const commits = c.recruits.filter((r) => r.committed === teamId).length;
  const spots = COLLEGE_ROSTER_MAX - back.length - commits;
  if (c.division === "D3") return Math.max(0, spots);
  const funded = back.filter((id) => !f.players[id].file?.walkOn).length;
  return Math.max(0, Math.min(SCHOLARSHIPS[c.division] - funded - commits, spots));
}

/** What a team's situation looks like to recruits this week, worked out once for every recruit. */
export interface RecruitContext {
  teams: Map<string, Team>;
  winPct: Map<string, number>;
  /** Team id -> position -> overalls of players who'll be there next season. */
  depth: Map<string, Map<Position, number[]>>;
  coach: number;
}

export function recruitContext(f: Franchise, teams: Team[]): RecruitContext {
  const ids = teams.map((t) => t.id);
  const table = standings(
    f.season.games.filter((g) => g.kind !== "playoff"),
    ids,
  );
  const winPct = new Map(
    ids.map((id) => {
      const s = table.get(id)!;
      return [id, s.w + s.l ? s.w / (s.w + s.l) : 0.5];
    }),
  );
  const depth = new Map<string, Map<Position, number[]>>();
  for (const t of teams) {
    const byPos = new Map<Position, number[]>(POSITIONS.map((p) => [p, []]));
    for (const id of f.rosters[t.id] ?? []) if (returning(f, id)) byPos.get(f.players[id].pos)!.push(playerOvr(f.players[id]));
    depth.set(t.id, byPos);
  }
  for (const r of college(f).recruits) {
    if (!r.committed || !depth.has(r.committed)) continue;
    const p = recruitPlayer(f, r);
    depth.get(r.committed)!.get(p.pos)!.push(playerOvr(p));
  }
  return { teams: new Map(teams.map((t) => [t.id, t])), winPct, depth, coach: reputation(f) };
}

function needScore(f: Franchise, r: Recruit, team: Team, need: RecruitNeed, ctx: RecruitContext): number {
  const p = recruitPlayer(f, r);
  if (need === "prestige") return team.prestige;
  if (need === "playingTime") {
    const ovr = playerOvr(p);
    const ahead = (ctx.depth.get(team.id)?.get(p.pos) ?? []).filter((x) => x >= ovr).length;
    return [1, 0.7, 0.4][ahead] ?? 0.1;
  }
  if (need === "nil") {
    const offered = r.offers[team.id];
    return offered === undefined ? 0 : Math.min(1, offered / Math.max(1, r.nilAsk));
  }
  if (need === "distance") return p.hometown.includes(",") ? (homeState(p) === team.state ? 1 : 0.3) : 0.5;
  if (need === "winning") return ctx.winPct.get(team.id) ?? 0.5;
  return team.id === f.teamId ? ctx.coach : team.prestige;
}

/** 0.5 to 1.5: how well a program matches what he wants. */
export function fit(f: Franchise, r: Recruit, team: Team, ctx = recruitContext(f, [team])): number {
  return 0.5 + r.wants.reduce((sum, need, i) => sum + WANT_WEIGHTS[i] * needScore(f, r, team, need, ctx), 0);
}

function pickWants(rng: Rng): RecruitNeed[] {
  const left = Object.keys(NEED_WEIGHTS) as RecruitNeed[];
  const out: RecruitNeed[] = [];
  while (out.length < 3) {
    const need = rng.weighted(
      left,
      left.map((n) => NEED_WEIGHTS[n]),
    );
    out.push(need);
    left.splice(left.indexOf(need), 1);
  }
  return out;
}

export const recruitNilAsk = (stars: number, division: CollegeDivision) => Math.round(NIL_BY_STARS[stars] * NIL_DIVISION[division]);

/** The class of `classYear`, with AI programs (the user's included) already some weeks into recruiting it. */
export function newClass(f: Franchise, teams: Team[], classYear: number, headStartWeeks: number, includeUser = true): Franchise {
  const c = college(f);
  const rng = new Rng(`${f.seed}:class:${classYear}`);
  const base = teams.reduce((s, t) => s + teamTalentTarget(t), 0) / teams.length - RECRUIT_GAP;
  const n = Math.round(RECRUITS_PER_PROGRAM * teams.length);
  const drafted = Array.from({ length: n }, (_, i) => {
    const phenom = rng.chance(PHENOM_CHANCE) ? rng.range(4, 12) : 0;
    const p = generatePlayer(rng, {
      pos: POSITIONS[i % POSITIONS.length],
      targetOvr: Math.round(clamp(base + rng.normal(0, RECRUIT_SPREAD) + phenom, 30, 85)),
      age: rng.chance(0.6) ? 18 : 17,
      league: "college",
      teamId: null,
      hometownPool: rng.chance(0.08) ? "intl" : "us",
    });
    const player = { ...p, id: `r${classYear}-${i}` };
    return { player, score: player.potential * 0.7 + playerOvr(player) * 0.3 + rng.normal(0, 2) };
  });
  const order = [...drafted].sort((a, b) => b.score - a.score || a.player.id.localeCompare(b.player.id));
  const rankOf = new Map(order.map((x, i) => [x.player.id, i + 1]));
  const recruits: Recruit[] = drafted.map(({ player }) => {
    const rank = rankOf.get(player.id)!;
    const stars = (STAR_SHARES.find(([, share]) => rank <= Math.round(n * share))?.[0] ?? 2) as Recruit["stars"];
    const scouted = { ...player, file: { service: 0, teamSeasons: 0, stars, range: readProspect(f.seed, player, STAR_SCOUTING[stars], 1) } };
    return {
      id: player.id,
      kind: "hs",
      player: scouted,
      stars,
      rank,
      wants: pickWants(rng),
      nilAsk: recruitNilAsk(stars, c.division),
      interest: {},
      offers: {},
      homeVisits: [],
      officialVisits: [],
      scouted: 0,
    };
  });
  let next = refillPoints(
    { ...f, college: { ...c, classYear, recruits: [...c.recruits.filter((r) => r.kind === "transfer"), ...recruits], earlySigned: false } },
    teams,
  );
  for (let w = 0; w < headStartWeeks; w++) {
    next = aiRecruiting(next, teams, includeUser);
    next = refillPoints(resolveWeek(next, new Rng(`${f.seed}:class:${classYear}:head:${w}`)), teams);
  }
  return next;
}

type Result = { recruit: Recruit; cost: number; nil?: number } | { error: string };

/** One program's move on one recruit. */
function apply(f: Franchise, teamId: string, r: Recruit, action: RecruitAction, ctx: RecruitContext, nil?: number): Result {
  const cost = COSTS[action];
  if ((college(f).points[teamId] ?? 0) < cost) return { error: "Not enough points this week." };
  if (r.signed) return { error: "He's already signed." };
  const team = ctx.teams.get(teamId)!;
  const gain = (amount: number) => {
    const boost = r.offers[teamId] !== undefined ? OFFER_BOOST : 1;
    return { ...r.interest, [teamId]: (r.interest[teamId] ?? 0) + amount * fit(f, r, team, ctx) * boost };
  };
  if (action === "call") return { recruit: { ...r, interest: gain(GAINS.call) }, cost };
  if (action === "homeVisit") {
    if (r.homeVisits.includes(teamId)) return { error: "You've already made a home visit." };
    return { recruit: { ...r, interest: gain(GAINS.homeVisit), homeVisits: [...r.homeVisits, teamId] }, cost };
  }
  if (action === "officialVisit") {
    if (r.officialVisits.includes(teamId)) return { error: "He's already made his official visit." };
    if (r.officialVisits.length >= MAX_OFFICIAL_VISITS) return { error: `He's used all ${MAX_OFFICIAL_VISITS} official visits.` };
    return { recruit: { ...r, interest: gain(GAINS.officialVisit), officialVisits: [...r.officialVisits, teamId] }, cost };
  }
  if (action === "offer") {
    if (r.offers[teamId] === undefined && openScholarships(f, teamId) <= 0)
      return { error: college(f).division === "D3" ? "You have no open roster spots." : "You have no open scholarships." };
    const amount = Math.max(0, Math.round(nil ?? 0));
    if (amount - (r.offers[teamId] ?? 0) > nilRoom(f, teamId)) return { error: "That's more NIL than you have left for next season." };
    return { recruit: { ...r, offers: { ...r.offers, [teamId]: amount } }, cost, nil: amount };
  }
  if (action === "pullOffer") {
    const offers = { ...r.offers };
    delete offers[teamId];
    // pulling the offer of a recruit who hasn't signed ends his commitment too
    const recruit = { ...r, offers };
    if (r.committed === teamId) delete recruit.committed;
    return { recruit, cost, nil: 0 };
  }
  // scouting
  const p = r.player;
  if (!p?.file?.range) return { error: "You already know what he is." };
  const scouted = r.scouted + SCOUT_POINTS;
  const range = readProspect(f.seed, p, STAR_SCOUTING[r.stars] + scouted, scoutMultiplier(f));
  return { recruit: { ...r, scouted, player: { ...p, file: { ...p.file, range } } }, cost };
}

function store(f: Franchise, teamId: string, recruit: Recruit, cost: number, nil?: number): Franchise {
  const promised = nil === undefined ? f : promiseNil(f, teamId, recruit.id, nil);
  if ("error" in promised) return f;
  const c = college(promised);
  return {
    ...promised,
    college: {
      ...c,
      points: { ...c.points, [teamId]: c.points[teamId] - cost },
      recruits: c.recruits.map((x) => (x.id === recruit.id ? recruit : x)),
    },
  };
}

/** The user's move on a recruit. */
export function recruitAction(f: Franchise, recruitId: string, action: RecruitAction, teams: Team[], nil?: number): Franchise | { error: string } {
  const r = college(f).recruits.find((x) => x.id === recruitId);
  if (!r) return { error: "That recruit isn't in this class." };
  const result = apply(f, f.teamId, r, action, recruitContext(f, teams), nil);
  return "error" in result ? result : store(f, f.teamId, result.recruit, result.cost, result.nil);
}

/** Stable per team and recruit, so programs spread out instead of chasing the same players. */
function taste(teamId: string, recruitId: string) {
  let h = 2166136261;
  for (const ch of `${teamId}|${recruitId}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967296;
}

/** The stars a program can reach for. */
function starBand(prestige: number): [number, number] {
  const low = prestige >= 0.75 ? 4 : prestige >= 0.5 ? 3 : 2;
  const high = prestige >= 0.6 ? 5 : prestige >= 0.35 ? 4 : 3;
  return [low, high];
}

/** Every AI program spends its week. With `includeUser`, the user's staff does too. */
export function aiRecruiting(f: Franchise, teams: Team[], includeUser: boolean): Franchise {
  const ctx = recruitContext(f, teams);
  let recruits = college(f).recruits;
  const index = new Map(recruits.map((r, i) => [r.id, i]));
  const points = { ...college(f).points };
  let nil = college(f).nil;
  recruits = [...recruits];
  for (const team of [...teams].sort((a, b) => a.id.localeCompare(b.id))) {
    if (team.id === f.teamId && !includeUser) continue;
    const open = openScholarships({ ...f, college: { ...college(f), recruits } }, team.id);
    if (open <= 0) continue;
    const [low, high] = starBand(team.prestige);
    const targets = recruits
      .filter((r) => !r.signed && !r.committed && r.stars >= low && r.stars <= high)
      .sort((a, b) => (b.interest[team.id] ?? 0) - (a.interest[team.id] ?? 0) || taste(team.id, a.id) - taste(team.id, b.id))
      .slice(0, AI_TARGETS);
    if (!targets.length) continue;
    const view = (): Franchise => ({ ...f, college: { ...college(f), recruits, points, nil } });
    const save = (r: Recruit, cost: number) => {
      recruits[index.get(r.id)!] = r;
      points[team.id] -= cost;
    };
    let offers = recruits.filter((r) => !r.committed && r.offers[team.id] !== undefined).length;
    for (const t of targets) {
      if (offers >= Math.ceil(open * AI_OFFER_RATIO)) break;
      const r = recruits[index.get(t.id)!];
      if (r.offers[team.id] !== undefined) continue;
      const done = apply(view(), team.id, r, "offer", ctx, Math.min(r.nilAsk, Math.max(0, nilRoom(view(), team.id))));
      if ("error" in done) break;
      const promised = promiseNil(view(), team.id, r.id, done.nil ?? 0);
      if (!("error" in promised)) nil = promised.college!.nil;
      save(done.recruit, done.cost);
      offers++;
    }
    for (let spent = true; spent && points[team.id] >= COSTS.call;) {
      spent = false;
      for (const t of targets) {
        const r = recruits[index.get(t.id)!];
        const left = points[team.id];
        const action: RecruitAction | null =
          left >= COSTS.officialVisit &&
          !r.officialVisits.includes(team.id) &&
          r.officialVisits.length < MAX_OFFICIAL_VISITS &&
          (r.interest[team.id] ?? 0) >= AI_VISIT_INTEREST
            ? "officialVisit"
            : left >= COSTS.homeVisit && !r.homeVisits.includes(team.id)
              ? "homeVisit"
              : left >= COSTS.call
                ? "call"
                : null;
        if (!action) continue;
        const done = apply(view(), team.id, r, action, ctx);
        if ("error" in done) continue;
        save(done.recruit, done.cost);
        spent = true;
      }
    }
  }
  return { ...f, college: { ...college(f), recruits, points, nil } };
}

/** Commitments and flips at the end of a week. */
export function resolveWeek(f: Franchise, rng: Rng): Franchise {
  const c = college(f);
  const room = new Map<string, number>();
  const roomOf = (teamId: string) => {
    if (!room.has(teamId)) room.set(teamId, f.rosters[teamId] ? openScholarships(f, teamId) : 0);
    return room.get(teamId)!;
  };
  const recruits = c.recruits.map((r) => {
    if (r.signed) return r;
    const ranked = Object.entries(r.interest).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (r.committed) {
      const mine = r.interest[r.committed] ?? 0;
      const rival = ranked.find(([id, v]) => id !== r.committed && r.offers[id] !== undefined && v >= FLIP_RATIO * mine && roomOf(id) > 0);
      if (!rival || !rng.chance(FLIP_CHANCE)) return r;
      room.set(rival[0], roomOf(rival[0]) - 1);
      room.set(r.committed, roomOf(r.committed) + 1);
      return { ...r, committed: rival[0] };
    }
    const leader = ranked.find(([id]) => r.offers[id] !== undefined);
    if (!leader || leader[1] < (r.kind === "transfer" ? PORTAL_COMMIT : COMMIT_INTEREST) || roomOf(leader[0]) <= 0) return r;
    const second = ranked.find(([id]) => id !== leader[0])?.[1] ?? 0;
    if (leader[1] < COMMIT_LEAD * second) return r;
    room.set(leader[0], roomOf(leader[0]) - 1);
    return { ...r, committed: leader[0] };
  });
  return { ...f, college: { ...c, recruits } };
}

/** A signed player's other suitors get their NIL back. */
function releaseOthers(f: Franchise, r: Recruit): Franchise {
  return Object.keys(r.offers).reduce((x, teamId) => (teamId === r.committed ? x : releaseNil(x, teamId, r.id)), f);
}

/** Everyone committed by the early signing date signs, and can't flip after. */
export function earlySigning(f: Franchise): Franchise {
  const c = college(f);
  const recruits = c.recruits.map((r) => (r.committed && !r.signed ? { ...r, signed: true } : r));
  const signing = recruits.filter((r, i) => r.signed && !c.recruits[i].signed);
  return signing.reduce(releaseOthers, { ...f, college: { ...c, earlySigned: true, recruits } } as Franchise);
}

/** The last day: commitments sign, the rest take their best offer that still has room, and anyone left goes elsewhere. */
export function signingDay(f: Franchise, teams: Team[]): Franchise {
  const c = college(f);
  const signed = c.recruits.map((r) => (r.committed ? { ...r, signed: true } : r));
  let next: Franchise = { ...f, college: { ...c, recruits: signed } };
  for (const r of [...signed].filter((x) => !x.committed).sort((a, b) => a.rank - b.rank)) {
    const choice = Object.keys(r.offers)
      .filter((id) => next.rosters[id] && openScholarships(next, id) > 0)
      .sort((a, b) => (r.interest[b] ?? 0) - (r.interest[a] ?? 0) || a.localeCompare(b))[0];
    if (!choice) continue;
    next = {
      ...next,
      college: { ...next.college!, recruits: next.college!.recruits.map((x) => (x.id === r.id ? { ...x, committed: choice, signed: true } : x)) },
    };
  }
  const known = new Set(teams.map((t) => t.id));
  const kept = next.college!.recruits.filter((r) => r.signed && known.has(r.committed!));
  const gone = next.college!.recruits.filter((r) => !kept.includes(r));
  // suitors who missed out, and everyone who offered a recruit who went elsewhere, get their money back
  const released = [
    ...kept.map((r) => (x: Franchise) => releaseOthers(x, r)),
    ...gone.map((r) => (x: Franchise) => Object.keys(r.offers).reduce((y, t) => releaseNil(y, t, r.id), x)),
  ].reduce((x, step) => step(x), next);
  return { ...released, college: { ...released.college!, recruits: kept } };
}

/** 1 for the best class: stars committed and signed. */
export function classRank(f: Franchise, teamId: string): number {
  const total = new Map(Object.keys(f.rosters).map((id) => [id, 0]));
  for (const r of college(f).recruits) if (r.committed && total.has(r.committed)) total.set(r.committed, total.get(r.committed)! + CLASS_POINTS[r.stars]);
  const order = [...total.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
  return order.indexOf(teamId) + 1;
}
