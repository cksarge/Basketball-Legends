// Running set plays: choosing one for a possession, finding its focus player, and letting it go when it's over.
import type { Match } from "./match";
import { PLAYS, routeSpot, SYSTEMS, type PlayDef } from "./playbook";
import type { Agent, TeamIdx } from "./state";

/** How often a possession runs a set play instead of playing free. */
const SET_PLAY_RATE = 0.75;

const shooting = (a: Agent) => a.player.ratings.three;
const scoring = (a: Agent) => Math.max(a.player.ratings.three, a.player.ratings.layup, a.player.ratings.midRange);
const post = (a: Agent) => a.player.ratings.postControl + a.player.ratings.strength * 0.5;
const best = (list: Agent[], score: (a: Agent) => number) => list.reduce<Agent | null>((b, a) => (!b || score(a) > score(b) ? a : b), null);

/** Who a play is for, or null if nobody on the floor fits it. */
export function focusAgent(match: Match, team: TeamIdx, play: PlayDef): Agent | null {
  const five = match.agentsOf(team);
  if (play.focus === "handler") {
    const h = match.handler();
    return h?.team === team ? h : null;
  }
  if (play.focus === "star") return best(five, scoring);
  if (play.focus === "shooter") return best(five, shooting);
  return best(
    five.filter((a) => a.player.pos === "C" || a.player.pos === "PF"),
    post,
  );
}

/** The play being run, once. A play that has run out, or has nobody to run it, clears so normal offense takes over. */
export function activePlay(match: Match, team: TeamIdx): PlayDef | null {
  const t = match.state.teams[team];
  const play = t.playCall ? PLAYS[t.playCall as keyof typeof PLAYS] : undefined;
  if (!play) return null;
  if ((t.playUntil ?? 0) < match.state.time || !focusAgent(match, team, play)) {
    t.playCall = null;
    return null;
  }
  return play;
}

export function setPlay(match: Match, team: TeamIdx, play: PlayDef) {
  const t = match.state.teams[team];
  t.playCall = play.id;
  t.playUntil = match.state.time + play.seconds;
}

/** Picks a play for a half-court possession, once per possession. */
export function pickPlay(match: Match, team: TeamIdx) {
  const s = match.state;
  const t = s.teams[team];
  const system = t.tactics.system ? SYSTEMS[t.tactics.system] : undefined;
  if (!system || t.playCall || t.playPicked === s.possessions[team]) return;
  t.playPicked = s.possessions[team];
  const book = t.tactics.plays?.length ? t.tactics.plays : system.plays;
  if (match.rng.chance(SET_PLAY_RATE)) setPlay(match, team, PLAYS[match.rng.pick(book)]);
}

/** An off-ball player's route, if they're the play's focus. */
export function playRoute(match: Match, a: Agent, rimX: number, side: 1 | -1) {
  if (!match.state.teams[a.team].playCall) return null;
  const play = activePlay(match, a.team);
  return play && focusAgent(match, a.team, play) === a ? routeSpot(play, side, rimX) : null;
}
