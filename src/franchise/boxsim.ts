// A possession-by-possession stat model for the games nobody watches. It runs in about a millisecond a game and returns
// the same box score a played game does. The constants below are tuned to real engine games (see engine-baseline.json).
import { Rng, clamp } from "@/engine/rng";
import type { LeagueId, Player, TeamTactics } from "@/engine/types";
import { emptyLine, gameScore, type BoxScore, type StatLine } from "@/game/sim/stats";

export interface BoxSide {
  teamId: string;
  roster: Player[];
  rotation: Record<string, number>;
  starters: string[];
  tactics?: Partial<TeamTactics>;
}

export interface BoxInput {
  league: LeagueId;
  quarterMinutes: number;
  periods: number;
  home: BoxSide;
  away: BoxSide;
  neutral?: boolean;
  seed: string;
}

export interface BoxResult {
  home: number;
  away: number;
  overtimes: number;
  box: BoxScore;
  playerOfGame: string | null;
  injuries: { playerId: string; name: string; gamesOut: number }[];
}

/** Possessions a team uses in 48 minutes. */
const POSSESSIONS_PER_48 = 105.5;
const OVERTIME_MINUTES = 5;
const TURNOVER = 0.155;
const STEAL_SHARE = 0.45;
const SHOOTING_FOUL = 0.118;
const THREE_SHARE = 0.37;
const THREE_MAKE = 0.212;
const TWO_MAKE = 0.52;
const FREE_THROW = 0.8;
const ASSIST = 0.725;
const OFFENSIVE_REBOUND = 0.286;
const BLOCK = 0.22;
/** Misses that end up out of bounds, so nobody gets the rebound. */
const TEAM_REBOUND = 0.11;
const LOOSE_FOUL = 0.05;
const HOME_EDGE = 0.003;
const DUNK_SHARE = 0.3;
/** League-average ratings that the make rates above are centered on. */
const AVG = { off: 75, def: 72, three: 74, ft: 80, reb: 70 };
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

function buildTeam(side: BoxSide, gameMinutes: number): Team {
  const scale = (gameMinutes * 5) / Object.values(side.rotation).reduce((a, b) => a + b, 0);
  const players = side.roster.filter((p) => side.rotation[p.id] > 0);
  const seconds = players.map((p) => Math.round(side.rotation[p.id] * scale * 60));
  // rounding must not change the team's total
  seconds[0] += gameMinutes * 5 * 60 - seconds.reduce((a, b) => a + b, 0);
  const lean = side.tactics?.threeRate ?? 0.5;
  const list = players.map((p, i): Skater => {
    const r = p.ratings;
    const inside = avg(r.closeShot, r.layup, r.midRange, r.layup);
    const scoring = Math.max(inside, r.three);
    const share = seconds[i] / (gameMinutes * 5 * 60);
    return {
      p,
      guarded: 0,
      seconds: seconds[i],
      usage: share * Math.exp((scoring - AVG.off) / USAGE_SCALE),
      threeShare: clamp(THREE_SHARE + (r.three - inside) * 0.008 + (lean - 0.5) * 0.3, 0.02, 0.85),
      three: r.three,
      inside,
      ft: r.freeThrow,
      dunk: r.dunk,
      passer: share * Math.exp((avg(r.passAccuracy, r.passVision) - AVG.off) / USAGE_SCALE),
      rebound: share * Math.exp((avg(r.offReb, r.defReb) - AVG.reb) / USAGE_SCALE),
      block: share * Math.exp((r.block - AVG.reb) / 6),
      steal: share * Math.exp((r.steal - AVG.reb) / 8),
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
  for (const [mineId, theirId] of Object.entries(t?.matchups ?? {})) {
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

function shootFreeThrows(rng: Rng, s: Skater, n: number, line: StatLine, team: Team) {
  const make = clamp(FREE_THROW + (s.ft - AVG.ft) * 0.006, 0.4, 0.95);
  for (let i = 0; i < n; i++) {
    line.fta++;
    if (rng.chance(make)) {
      line.ftm++;
      line.pts++;
      team.score++;
    }
  }
}

function possession(rng: Rng, off: Team, def: Team, box: BoxScore, edge: number) {
  const lineOf = (s: Skater) => box[s.p.id];
  const shooter = choose(rng, off.list, (s) => s.usage);
  const scheme = SCHEMES[def.side.tactics?.defense ?? "man"];
  const turnover = clamp(TURNOVER + scheme.turnover + (def.handling - off.handling) * 0.005, 0.08, 0.3);
  if (rng.chance(turnover)) {
    lineOf(shooter).tov++;
    if (rng.chance(STEAL_SHARE + scheme.steal)) lineOf(choose(rng, def.list, (s) => s.steal)).stl++;
    return;
  }
  if (rng.chance(LOOSE_FOUL)) lineOf(choose(rng, def.list, (s) => s.foul)).pf++;
  const line = lineOf(shooter);
  if (rng.chance(SHOOTING_FOUL + scheme.foul)) {
    lineOf(choose(rng, def.list, (s) => s.foul)).pf++;
    shootFreeThrows(rng, shooter, 2, line, off);
    return;
  }
  const three = rng.chance(clamp(shooter.threeShare + scheme.three, 0.02, 0.85));
  const defense = (def.defense - AVG.def) * DEFENSE_GAIN;
  const make = three
    ? THREE_MAKE + scheme.threeMake + (shooter.three - AVG.three) * SHOOT_GAIN - defense + edge + shooter.guarded
    : TWO_MAKE + scheme.twoMake + (shooter.inside - AVG.off) * SHOOT_GAIN - defense + edge + shooter.guarded;
  line.fga++;
  if (three) line.tpa++;
  if (rng.chance(clamp(make, 0.15, 0.8))) {
    line.fgm++;
    line.pts += three ? 3 : 2;
    off.score += three ? 3 : 2;
    if (three) line.tpm++;
    else if (rng.chance(DUNK_SHARE * (shooter.dunk / AVG.off) ** 2)) line.dunks++;
    if (rng.chance(ASSIST + scheme.assist)) lineOf(choose(rng, off.list, (s) => s.passer, shooter)).ast++;
    return;
  }
  if (!three && rng.chance(BLOCK)) lineOf(choose(rng, def.list, (s) => s.block)).blk++;
  const boards = ((off.side.tactics?.crashBoards ?? DEFAULT_CRASH) - DEFAULT_CRASH) * CRASH_GAIN;
  const offBoard = clamp(OFFENSIVE_REBOUND + boards + (off.rebounding - def.rebounding) * 0.01, 0.12, 0.45);
  if (rng.chance(TEAM_REBOUND)) return;
  const crash = rng.chance(offBoard);
  const board = choose(rng, crash ? off.list : def.list, (s) => s.rebound);
  if (crash) {
    lineOf(board).oreb++;
    possession(rng, off, def, box, edge);
  } else lineOf(board).dreb++;
}

function rollInjuries(rng: Rng, teams: Team[]): BoxResult["injuries"] {
  const out: BoxResult["injuries"] = [];
  for (const t of teams)
    for (const s of t.list) {
      const risk = INJURY_PER_48 * (s.seconds / (48 * 60)) * (1 + (70 - s.p.ratings.durability) / 40);
      if (rng.chance(risk)) {
        const [name, low, high] = rng.pick(INJURIES);
        out.push({ playerId: s.p.id, name, gamesOut: rng.int(low, high) });
      }
    }
  return out;
}

export function simBox(i: BoxInput): BoxResult {
  const rng = new Rng(i.seed);
  const gameMinutes = i.quarterMinutes * i.periods;
  const home = buildTeam(i.home, gameMinutes);
  const away = buildTeam(i.away, gameMinutes);
  applyDefense(home, away);
  applyDefense(away, home);
  const box: BoxScore = {};
  for (const t of [home, away]) for (const s of t.list) box[s.p.id] = { ...emptyLine(), min: s.seconds };
  const edge = i.neutral ? 0 : HOME_EDGE;
  const pace = avg(i.home.tactics?.pace ?? 0.5, i.away.tactics?.pace ?? 0.5);
  const play = (minutes: number) => {
    const n = Math.round(((POSSESSIONS_PER_48 * minutes) / 48) * (1 + (pace - 0.5) * 0.2) + rng.normal(0, 2) * (minutes / 48));
    for (let p = 0; p < n; p++) {
      possession(rng, away, home, box, -edge);
      possession(rng, home, away, box, edge);
    }
  };
  play(gameMinutes);
  let overtimes = 0;
  while (home.score === away.score) {
    overtimes++;
    play(OVERTIME_MINUTES);
    for (const t of [home, away]) {
      const top = t.list.slice(0, 5);
      for (const s of top) box[s.p.id].min += OVERTIME_MINUTES * 60;
    }
  }
  const margin = home.score - away.score;
  const total = gameMinutes + overtimes * OVERTIME_MINUTES;
  for (const [t, sign] of [
    [home, 1],
    [away, -1],
  ] as const)
    for (const s of t.list) box[s.p.id].plusMinus = Math.round((sign * margin * box[s.p.id].min) / (total * 60));
  let best: string | null = null;
  let top = -Infinity;
  for (const [id, line] of Object.entries(box)) {
    const score = gameScore(line);
    if (score > top) [best, top] = [id, score];
  }
  return { home: home.score, away: away.score, overtimes, box, playerOfGame: best, injuries: rollInjuries(rng, [home, away]) };
}
