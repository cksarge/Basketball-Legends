// A possession-by-possession stat model for the games nobody watches. It runs in about a millisecond a game and returns
// the same box score a played game does. The constants below are tuned to real engine games (see engine-baseline.json).
import { Rng, clamp } from "@/engine/rng";
import type { LeagueId, Player, SystemId, TeamTactics } from "@/engine/types";
import { addLine, emptyLine, gameScore, type BoxScore, type StatLine } from "@/game/sim/stats";
import type { PartialGame } from "./types";

export interface BoxSide {
  teamId: string;
  roster: Player[];
  rotation: Record<string, number>;
  starters: string[];
  tactics?: Partial<TeamTactics>;
  /** Added to the team's make rate by its assistant coach. */
  coachEdge?: number;
}

export interface BoxInput {
  league: LeagueId;
  quarterMinutes: number;
  periods: number;
  home: BoxSide;
  away: BoxSide;
  neutral?: boolean;
  seed: string;
  /** League setting: how often injuries happen, with 1 as normal. */
  injuryRate?: number;
}

export interface BoxResult {
  home: number;
  away: number;
  overtimes: number;
  box: BoxScore;
  playerOfGame: string | null;
  injuries: { playerId: string; name: string; gamesOut: number }[];
}

/** The parts of the game that change by league, tuned to that league's real engine games. */
interface Style {
  /** Possessions a team uses in 48 minutes. */
  possessionsPer48: number;
  overtimeMinutes: number;
  turnover: number;
  stealShare: number;
  shootingFoul: number;
  threeShare: number;
  threeMake: number;
  twoMake: number;
  freeThrow: number;
  assist: number;
  offensiveRebound: number;
  block: number;
  /** Misses that end up out of bounds, so nobody gets the rebound. */
  teamRebound: number;
  looseFoul: number;
  homeEdge: number;
  dunkShare: number;
  /** League-average ratings that the make rates are centered on. */
  avg: { off: number; def: number; three: number; ft: number; reb: number };
}
const PRO_STYLE: Style = {
  possessionsPer48: 105.5,
  overtimeMinutes: 5,
  turnover: 0.155,
  stealShare: 0.45,
  shootingFoul: 0.118,
  threeShare: 0.37,
  threeMake: 0.212,
  twoMake: 0.52,
  freeThrow: 0.8,
  assist: 0.725,
  offensiveRebound: 0.286,
  block: 0.22,
  teamRebound: 0.11,
  looseFoul: 0.05,
  homeEdge: 0.003,
  dunkShare: 0.3,
  avg: { off: 75, def: 72, three: 74, ft: 80, reb: 70 },
};
export const LEAGUE_STYLE: Record<LeagueId, Style> = {
  pro: PRO_STYLE,
  college: {
    ...PRO_STYLE,
    possessionsPer48: 91.5,
    turnover: 0.158,
    stealShare: 0.345,
    shootingFoul: 0.13,
    threeShare: 0.3,
    threeMake: 0.17,
    twoMake: 0.425,
    freeThrow: 0.74,
    assist: 0.65,
    offensiveRebound: 0.228,
    block: 0.165,
    teamRebound: 0.06,
    looseFoul: 0.085,
    avg: { off: 64, def: 61, three: 64, ft: 68, reb: 59 },
  },
  hs: {
    ...PRO_STYLE,
    possessionsPer48: 91.5,
    overtimeMinutes: 4,
    turnover: 0.165,
    stealShare: 0.305,
    shootingFoul: 0.13,
    threeShare: 0.19,
    threeMake: 0.145,
    twoMake: 0.39,
    freeThrow: 0.655,
    assist: 0.58,
    offensiveRebound: 0.215,
    block: 0.08,
    teamRebound: 0.02,
    looseFoul: 0.135,
    avg: { off: 49, def: 46, three: 49, ft: 54, reb: 45 },
  },
};
/** Make rate per rating point of the gap between shooter and defense. */
const SHOOT_GAIN = 0.0105;
const DEFENSE_GAIN = 0.021;
const USAGE_SCALE = 20;
/** Chance a player who plays all 48 minutes gets hurt. */
const INJURY_PER_48 = 0.0225;
/** What a defense does to the offense facing it, read from the real engine's tactics baseline. */
const SCHEMES: Record<
  TeamTactics["defense"],
  { three: number; twoMake: number; threeMake: number; turnover: number; steal: number; foul: number; assist: number }
> = {
  man: { three: 0, twoMake: 0, threeMake: 0, turnover: 0, steal: 0, foul: 0, assist: 0 },
  zone23: { three: 0.1, twoMake: -0.015, threeMake: 0, turnover: -0.012, steal: 0, foul: -0.01, assist: 0.05 },
  zone32: { three: -0.035, twoMake: 0.012, threeMake: -0.012, turnover: 0, steal: 0, foul: 0.03, assist: 0.03 },
  press: { three: -0.05, twoMake: 0.018, threeMake: 0, turnover: 0.045, steal: 0.2, foul: 0.035, assist: 0 },
};
/** What a playbook does to a team's shots, read from the real engine's tactics baseline. */
const SYSTEM_STYLE: Record<SystemId, { three: number; bigs: number; assist: number; turnover: number; make: number }> = {
  motion: { three: -0.15, bigs: 1.55, assist: 0.08, turnover: 0.03, make: 0.004 },
  pickRoll: { three: -0.09, bigs: 0.88, assist: -0.06, turnover: 0, make: 0.008 },
  postUp: { three: -0.15, bigs: 1.6, assist: -0.015, turnover: 0.004, make: 0.006 },
  paceSpace: { three: 0.17, bigs: 0.75, assist: -0.05, turnover: -0.015, make: 0.004 },
  isoStar: { three: -0.03, bigs: 0.8, assist: -0.1, turnover: 0, make: 0.008 },
};
const NO_STYLE = { three: 0, bigs: 1, assist: 0, turnover: 0, make: 0 };
/** Offensive rebound chance per unit of crashBoards above the default. */
const CRASH_GAIN = 0.1;
const DEFAULT_CRASH = 0.4;
/** A doubled player shoots less and passes more. */
const DOUBLED = { usage: 0.72, passer: 1.5, make: -0.025 };
const STAR_POTENTIAL = 88;
/** Make rate per rating point between an assigned defender and the team's average. */
const MATCHUP_GAIN = 0.0035;
const INJURIES = [
  ["Sprained ankle", 2, 9],
  ["Sore knee", 1, 6],
  ["Hamstring strain", 3, 12],
  ["Back spasms", 1, 5],
  ["Broken hand", 12, 28],
] as const;

interface Skater {
  p: Player;
  /** Change in make rate from how the defense is playing this player. */
  guarded: number;
  seconds: number;
  usage: number;
  threeShare: number;
  three: number;
  inside: number;
  ft: number;
  dunk: number;
  passer: number;
  rebound: number;
  block: number;
  steal: number;
  foul: number;
}
interface Team {
  side: BoxSide;
  list: Skater[];
  defense: number;
  rebounding: number;
  handling: number;
  score: number;
}

const avg = (...n: number[]) => n.reduce((a, b) => a + b, 0) / n.length;

function buildTeam(side: BoxSide, gameMinutes: number, st: Style): Team {
  const scale = (gameMinutes * 5) / Object.values(side.rotation).reduce((a, b) => a + b, 0);
  const players = side.roster.filter((p) => side.rotation[p.id] > 0);
  const seconds = players.map((p) => Math.round(side.rotation[p.id] * scale * 60));
  // rounding must not change the team's total
  seconds[0] += gameMinutes * 5 * 60 - seconds.reduce((a, b) => a + b, 0);
  const lean = side.tactics?.threeRate ?? 0.5;
  const style = side.tactics?.system ? SYSTEM_STYLE[side.tactics.system] : NO_STYLE;
  const list = players.map((p, i): Skater => {
    const r = p.ratings;
    const inside = avg(r.closeShot, r.layup, r.midRange, r.layup);
    const scoring = Math.max(inside, r.three);
    const share = seconds[i] / (gameMinutes * 5 * 60);
    return {
      p,
      guarded: 0,
      seconds: seconds[i],
      usage: share * Math.exp((scoring - st.avg.off) / USAGE_SCALE) * (p.pos === "C" || p.pos === "PF" ? style.bigs : 1),
      threeShare: clamp(st.threeShare + style.three + (r.three - inside) * 0.008 + (lean - 0.5) * 0.3, 0.02, 0.85),
      three: r.three,
      inside,
      ft: r.freeThrow,
      dunk: r.dunk,
      passer: share * Math.exp((avg(r.passAccuracy, r.passVision) - st.avg.off) / USAGE_SCALE),
      rebound: share * Math.exp((avg(r.offReb, r.defReb) - st.avg.reb) / USAGE_SCALE),
      block: share * Math.exp((r.block - st.avg.reb) / 6),
      steal: share * Math.exp((r.steal - st.avg.reb) / 8),
      foul: share,
    };
  });
  const weighted = (f: (s: Skater) => number) => list.reduce((sum, s) => sum + f(s) * s.seconds, 0) / list.reduce((sum, s) => sum + s.seconds, 0);
  return {
    side,
    list,
    defense: weighted((s) => avg(s.p.ratings.perimeterD, s.p.ratings.interiorD, s.p.ratings.iq)),
    rebounding: weighted((s) => avg(s.p.ratings.offReb, s.p.ratings.defReb)),
    handling: weighted((s) => avg(s.p.ratings.ballHandle, s.p.ratings.passAccuracy, s.p.ratings.iq)),
    score: 0,
  };
}

/** Doubles and assigned defenders change how a team's players score. */
function applyDefense(off: Team, def: Team) {
  const t = def.side.tactics;
  for (const s of off.list) {
    const doubled = t?.doubleTarget ? s.p.id === t.doubleTarget : t?.doubleTeamStars && s.p.potential > STAR_POTENTIAL;
    if (doubled) {
      s.usage *= DOUBLED.usage;
      s.passer *= DOUBLED.passer;
      s.guarded += DOUBLED.make;
    }
  }
  // matchups are for man-to-man; a zone guards areas
  for (const [mineId, theirId] of Object.entries((t?.defense ?? "man") === "man" ? (t?.matchups ?? {}) : {})) {
    const stopper = def.list.find((s) => s.p.id === mineId);
    const mark = off.list.find((s) => s.p.id === theirId);
    if (stopper && mark) mark.guarded -= (avg(stopper.p.ratings.perimeterD, stopper.p.ratings.interiorD) - def.defense) * MATCHUP_GAIN;
  }
}

function choose<T>(rng: Rng, items: T[], weight: (x: T) => number, skip?: T): T {
  let total = 0;
  for (const x of items) if (x !== skip) total += weight(x);
  let roll = rng.next() * total;
  for (const x of items) {
    if (x === skip) continue;
    roll -= weight(x);
    if (roll <= 0) return x;
  }
  return items[items.length - 1];
}

function shootFreeThrows(rng: Rng, s: Skater, n: number, line: StatLine, team: Team, st: Style) {
  const make = clamp(st.freeThrow + (s.ft - st.avg.ft) * 0.006, 0.4, 0.95);
  for (let i = 0; i < n; i++) {
    line.fta++;
    if (rng.chance(make)) {
      line.ftm++;
      line.pts++;
      team.score++;
    }
  }
}

function possession(rng: Rng, off: Team, def: Team, box: BoxScore, homeEdge: number, st: Style) {
  const style = off.side.tactics?.system ? SYSTEM_STYLE[off.side.tactics.system] : NO_STYLE;
  const edge = homeEdge + (off.side.coachEdge ?? 0) + style.make;
  const lineOf = (s: Skater) => box[s.p.id];
  const shooter = choose(rng, off.list, (s) => s.usage);
  const scheme = SCHEMES[def.side.tactics?.defense ?? "man"];
  const turnover = clamp(st.turnover + scheme.turnover + style.turnover + (def.handling - off.handling) * 0.005, 0.08, 0.3);
  if (rng.chance(turnover)) {
    lineOf(shooter).tov++;
    if (rng.chance(st.stealShare + scheme.steal)) lineOf(choose(rng, def.list, (s) => s.steal)).stl++;
    return;
  }
  if (rng.chance(st.looseFoul)) lineOf(choose(rng, def.list, (s) => s.foul)).pf++;
  const line = lineOf(shooter);
  if (rng.chance(st.shootingFoul + scheme.foul)) {
    lineOf(choose(rng, def.list, (s) => s.foul)).pf++;
    shootFreeThrows(rng, shooter, 2, line, off, st);
    return;
  }
  const three = rng.chance(clamp(shooter.threeShare + scheme.three, 0.02, 0.85));
  const defense = (def.defense - st.avg.def) * DEFENSE_GAIN;
  const make = three
    ? st.threeMake + scheme.threeMake + (shooter.three - st.avg.three) * SHOOT_GAIN - defense + edge + shooter.guarded
    : st.twoMake + scheme.twoMake + (shooter.inside - st.avg.off) * SHOOT_GAIN - defense + edge + shooter.guarded;
  line.fga++;
  if (three) line.tpa++;
  if (rng.chance(clamp(make, 0.15, 0.8))) {
    line.fgm++;
    line.pts += three ? 3 : 2;
    off.score += three ? 3 : 2;
    if (three) line.tpm++;
    else if (rng.chance(st.dunkShare * (shooter.dunk / st.avg.off) ** 2)) line.dunks++;
    if (rng.chance(st.assist + scheme.assist + style.assist)) lineOf(choose(rng, off.list, (s) => s.passer, shooter)).ast++;
    return;
  }
  if (!three && rng.chance(st.block)) lineOf(choose(rng, def.list, (s) => s.block)).blk++;
  const boards = ((off.side.tactics?.crashBoards ?? DEFAULT_CRASH) - DEFAULT_CRASH) * CRASH_GAIN;
  const offBoard = clamp(st.offensiveRebound + boards + (off.rebounding - def.rebounding) * 0.01, 0.12, 0.45);
  if (rng.chance(st.teamRebound)) return;
  const crash = rng.chance(offBoard);
  const board = choose(rng, crash ? off.list : def.list, (s) => s.rebound);
  if (crash) {
    lineOf(board).oreb++;
    possession(rng, off, def, box, homeEdge, st);
  } else lineOf(board).dreb++;
}

function rollInjuries(rng: Rng, teams: Team[], box: BoxScore, rate = 1): BoxResult["injuries"] {
  const out: BoxResult["injuries"] = [];
  for (const t of teams)
    for (const s of t.list) {
      const risk = rate * INJURY_PER_48 * (box[s.p.id].min / (48 * 60)) * (1 + (70 - s.p.ratings.durability) / 40);
      if (rng.chance(risk)) {
        const [name, low, high] = rng.pick(INJURIES);
        out.push({ playerId: s.p.id, name, gamesOut: rng.int(low, high) });
      }
    }
  return out;
}

function play(rng: Rng, i: BoxInput, home: Team, away: Team, box: BoxScore, minutes: number) {
  const st = LEAGUE_STYLE[i.league];
  const edge = i.neutral ? 0 : st.homeEdge;
  const pace = avg(i.home.tactics?.pace ?? 0.5, i.away.tactics?.pace ?? 0.5);
  const n = Math.round(((st.possessionsPer48 * minutes) / 48) * (1 + (pace - 0.5) * 0.2) + rng.normal(0, 2) * (minutes / 48));
  for (let p = 0; p < n; p++) {
    possession(rng, away, home, box, -edge, st);
    possession(rng, home, away, box, edge, st);
  }
}

function matchup(i: BoxInput, minutes: number) {
  const home = buildTeam(i.home, minutes, LEAGUE_STYLE[i.league]);
  const away = buildTeam(i.away, minutes, LEAGUE_STYLE[i.league]);
  applyDefense(home, away);
  applyDefense(away, home);
  const box: BoxScore = {};
  for (const t of [home, away]) for (const s of t.list) box[s.p.id] = { ...emptyLine(), min: s.seconds };
  return { home, away, box };
}

/** Plays out the minutes left, on top of anything already simulated. */
function finishGame(i: BoxInput, rng: Rng, minutes: number, earlier?: PartialGame): BoxResult {
  const { home, away, box } = matchup(i, minutes);
  home.score = earlier?.home ?? 0;
  away.score = earlier?.away ?? 0;
  for (const [id, line] of Object.entries(earlier?.box ?? {})) box[id] = box[id] ? addLine(box[id], line) : line;
  play(rng, i, home, away, box, minutes);
  let overtimes = 0;
  while (home.score === away.score) {
    overtimes++;
    const extra = LEAGUE_STYLE[i.league].overtimeMinutes;
    play(rng, i, home, away, box, extra);
    for (const t of [home, away]) for (const s of t.list.slice(0, 5)) box[s.p.id].min += extra * 60;
  }
  const margin = home.score - away.score;
  const total = i.quarterMinutes * i.periods + overtimes * LEAGUE_STYLE[i.league].overtimeMinutes;
  for (const [id, line] of Object.entries(box)) {
    const sign = home.list.some((s) => s.p.id === id) || i.home.roster.some((p) => p.id === id) ? 1 : -1;
    line.plusMinus = Math.round((sign * margin * line.min) / (total * 60));
  }
  let best: string | null = null;
  let top = -Infinity;
  for (const [id, line] of Object.entries(box)) {
    const score = gameScore(line);
    if (score > top) [best, top] = [id, score];
  }
  return { home: home.score, away: away.score, overtimes, box, playerOfGame: best, injuries: rollInjuries(rng, [home, away], box, i.injuryRate) };
}

export function simBox(i: BoxInput): BoxResult {
  return finishGame(i, new Rng(i.seed), i.quarterMinutes * i.periods);
}

/** The first quarters of a game, stopping wherever the score stands. */
export function simQuarters(i: BoxInput, quarters: number): PartialGame {
  const minutes = i.quarterMinutes * quarters;
  const { home, away, box } = matchup(i, minutes);
  play(new Rng(`${i.seed}:start`), i, home, away, box, minutes);
  return { home: home.score, away: away.score, box, seconds: minutes * 60 };
}

/** Sims the rest of a game from where a partial left off. */
export function finishBox(i: BoxInput, partial: PartialGame): BoxResult {
  return finishGame(i, new Rng(`${i.seed}:rest`), i.quarterMinutes * i.periods - partial.seconds / 60, partial);
}
