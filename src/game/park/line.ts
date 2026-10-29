// "Next game up": crews wait by the fence, winners stay on, losers go to the back of the line.
// Games without you are simulated from each crew's strength so the line keeps moving.
import { Rng, clamp } from "@/engine/rng";
import type { ParkRules } from "@/game/sim/state";

export interface Crew {
  id: string;
  name: string;
  playerIds: string[];
}

export interface LineGame {
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  /** You played this one (otherwise it was simulated while you waited). */
  played: boolean;
}

export interface LineState {
  crews: Crew[];
  /** The crew holding the court. */
  holder: string;
  /** Crews waiting, next one first. */
  queue: string[];
  you: string;
  /** Games your crew has won in a row on this court. */
  streak: number;
  best: number;
  history: LineGame[];
}

/** You called next: your crew plays the crew holding the court first. */
export function newLine(crews: Crew[], you: string): LineState {
  const others = crews.filter((c) => c.id !== you).map((c) => c.id);
  return { crews, holder: others[0], queue: [you, ...others.slice(1)], you, streak: 0, best: 0, history: [] };
}

export const crewById = (l: LineState, id: string) => l.crews.find((c) => c.id === id)!;
/** The next game: the holder against the first crew in line. */
export const nextMatchup = (l: LineState): [string, string] => [l.holder, l.queue[0]];
export const youAreUp = (l: LineState) => nextMatchup(l).includes(l.you);

/** Records a finished game: the winner holds the court, the loser walks to the back of the line. */
export function recordGame(l: LineState, game: LineGame): LineState {
  const winner = game.homeScore > game.awayScore ? game.home : game.away;
  const loser = winner === game.home ? game.away : game.home;
  const queue = l.queue.filter((id) => id !== game.home && id !== game.away);
  queue.push(loser);
  let streak = l.streak;
  if (game.home === l.you || game.away === l.you) streak = winner === l.you ? streak + 1 : 0;
  return { ...l, holder: winner, queue, streak, best: Math.max(l.best, streak), history: [...l.history, game] };
}

/** A believable final score between two crews of the given average overall. */
export function simScore(strengthA: number, strengthB: number, rules: ParkRules, rng: Rng): [number, number] {
  const pA = clamp(1 / (1 + Math.exp(-(strengthA - strengthB) / 4.5)), 0.08, 0.92);
  const aWins = rng.chance(pA);
  const gap = Math.abs(strengthA - strengthB);
  // the loser's share of the target shrinks with the talent gap
  const share = clamp(rng.normal(0.72 - gap * 0.02, 0.14), 0.15, 0.97);
  let win = rules.target;
  let lose = Math.min(rules.target - 1, Math.round(rules.target * share));
  if (rules.winBy === 2 && lose >= rules.target - 1) {
    // a deuce game: it goes past the target until someone leads by two
    lose = rules.target - 1 + rng.int(0, 3);
    win = lose + 2;
  }
  return aWins ? [win, lose] : [lose, win];
}

/** Simulates games on the court until your crew is in the next one. */
export function simUntilYou(l: LineState, strength: (crewId: string) => number, rules: ParkRules, seed: string): LineState {
  const rng = new Rng(`line:${seed}:${l.history.length}`);
  let line = l;
  for (let guard = 0; guard < 20 && !youAreUp(line); guard++) {
    const [h, a] = nextMatchup(line);
    const [hs, as] = simScore(strength(h), strength(a), rules, rng);
    line = recordGame(line, { home: h, away: a, homeScore: hs, awayScore: as, played: false });
  }
  return line;
}
