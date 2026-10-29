// Turns a Play in the Park setup into a game: who's playing, the rules, and the PendingMatch the game screen runs.
import { Rng } from "@/engine/rng";
import type { Player } from "@/engine/types";
import type { ParkRules } from "@/game/sim/state";
import type { PendingMatch, ParkSession } from "@/state/matchStore";
import type { ParkSetup } from "@/state/parkStore";
import { type Crew, crewById, type LineState, newLine, nextMatchup } from "./line";
import { parkById } from "./parks";
import { crewTeam, parkRegulars, regularOutfit, SIDE_COLORS, type Regular } from "./regulars";

/** Everyone in a park game besides the line's other crews. */
export interface Cast {
  you: Player;
  /** Your teammates (team games). */
  mates: Player[];
  /** The other side (team games), the other players (21, HORSE) or the contest rivals. */
  opps: Player[];
  /** Next game up: the crews waiting after the first game. */
  crews: Player[][];
}

export const MIN_TEAM = 1;
export const MAX_TEAM = 5;

/** How many players each mode needs besides you. */
export function castSize(s: ParkSetup) {
  switch (s.mode) {
    case "pickup":
      return { mates: s.teamSize - 1, opps: s.teamSize, crews: 0 };
    case "line":
      return { mates: s.teamSize - 1, opps: s.teamSize, crews: Math.max(0, maxCrews(s) - 1) };
    case "21":
      return { mates: 0, opps: s.players21 - 1, crews: 0 };
    case "horse":
      return { mates: 0, opps: s.horseOpponents, crews: 0 };
    case "three":
      return { mates: 0, opps: s.rivals, crews: 0 };
  }
}

/** Crews besides yours that the park's regulars can fill at this team size. */
export function maxCrews(s: ParkSetup) {
  const pool = 17 - (s.teamSize - 1);
  return Math.max(1, Math.min(s.crews, Math.floor(pool / s.teamSize)));
}

/** Fills every spot from the park's regulars (you default to the best one). */
export function pickCast(s: ParkSetup, regulars: Regular[], seed: number): Cast {
  const you = s.you ?? regulars[0].player;
  const rng = new Rng(`cast:${s.parkId}:${seed}`);
  const pool = rng.shuffle(regulars.map((r) => r.player).filter((p) => p.id !== you.id));
  const n = castSize(s);
  const mates = pool.splice(0, n.mates);
  const opps = pool.splice(0, n.opps);
  const crews: Player[][] = [];
  for (let i = 0; i < n.crews; i++) crews.push(pool.splice(0, s.teamSize));
  return { you, mates, opps, crews: crews.filter((c) => c.length === s.teamSize) };
}

export function rulesFor(s: ParkSetup): ParkRules {
  if (s.mode === "21") return { game: "21", halfCourt: true, scoring: s.scoring, target: s.target, winBy: 1, makeItTakeIt: false };
  return { game: "team", halfCourt: s.halfCourt, scoring: s.scoring, target: s.target, winBy: s.winBy2 ? 2 : 1, makeItTakeIt: s.makeItTakeIt };
}

const outfitsFor = (players: Player[]) => Object.fromEntries(players.map((p) => [p.id, regularOutfit(p.id)]));

/** A crew's name for the scoreboard: its best player's nickname, or "You". */
export function crewName(players: Player[], regulars: Regular[], isYou: boolean) {
  if (isYou) return "Your squad";
  const best = [...players].sort((a, b) => b.ratings.iq - a.ratings.iq)[0];
  const nick = regulars.find((r) => r.player.id === best?.id)?.nickname;
  return nick ? `${nick}'s squad` : `${best?.lastName ?? "Their"} squad`;
}

interface Built {
  pending: PendingMatch;
}

function base(s: ParkSetup, session: ParkSession, seed: number): Omit<PendingMatch, "home" | "away"> {
  return {
    mode: "park",
    league: "pro",
    arena: "park",
    quarterMinutes: 1,
    returnTo: "/park/",
    seed,
    park: session,
    // the shooting games run on practice mode (no defense or clock)
    practice: s.mode === "horse" || s.mode === "three" ? true : undefined,
  };
}

/** The PendingMatch for any park mode except a line game (see `lineGame`). */
export function buildPark(s: ParkSetup, cast: Cast, controller: string, seed: number): Built {
  const park = parkById(s.parkId);
  const regulars = parkRegulars(park);
  const all = [cast.you, ...cast.mates, ...cast.opps];
  const session: ParkSession = { parkId: park.id, mode: s.mode, outfits: outfitsFor(all) };
  const b = base(s, session, seed);
  const you = crewTeam("you", "Your squad", SIDE_COLORS[0]);
  const them = crewTeam("them", crewName(cast.opps, regulars, false), SIDE_COLORS[1]);
  if (s.mode === "pickup" || s.mode === "line") {
    session.rules = rulesFor(s);
    session.sideShirts = [...SIDE_COLORS];
    return {
      pending: {
        ...b,
        home: { team: you, roster: [cast.you, ...cast.mates], uniform: "home", controllers: [controller] },
        away: { team: them, roster: cast.opps, uniform: "home", controllers: [] },
      },
    };
  }
  if (s.mode === "21") {
    session.rules = rulesFor(s);
    return {
      pending: {
        ...b,
        lockPlayerId: cast.you.id,
        home: { team: crewTeam("ball", "Ball", SIDE_COLORS[0]), roster: [cast.you], uniform: "home", controllers: [controller] },
        away: { team: crewTeam("field", "Everyone else", SIDE_COLORS[1]), roster: cast.opps, uniform: "home", controllers: [] },
      },
    };
  }
  // shooting games: everyone on one side, no defense
  if (s.mode === "horse") session.word = s.word;
  if (s.mode === "three") session.rivals = cast.opps;
  return {
    pending: {
      ...b,
      lockPlayerId: cast.you.id,
      home: { team: you, roster: s.mode === "horse" ? [cast.you, ...cast.opps] : [cast.you], uniform: "home", controllers: [controller] },
      away: { team: them, roster: [], uniform: "home", controllers: [] },
    },
  };
}

// --------------------------------------------------------------- the line

export const YOU_CREW = "you";

/** Starts a line: your crew calls next against the crew holding the court, the rest wait. */
export function startLine(s: ParkSetup, cast: Cast): { line: LineState; players: Record<string, Player> } {
  const park = parkById(s.parkId);
  const regulars = parkRegulars(park);
  const groups: Player[][] = [[cast.you, ...cast.mates], cast.opps, ...cast.crews];
  const crews: Crew[] = groups.map((g, i) => ({
    id: i === 0 ? YOU_CREW : `crew${i}`,
    name: crewName(g, regulars, i === 0),
    playerIds: g.map((p) => p.id),
  }));
  const players = Object.fromEntries(groups.flat().map((p) => [p.id, p]));
  return { line: newLine(crews, YOU_CREW), players };
}

/** Average overall-ish strength of a crew (for simulated games). */
export function crewStrength(line: LineState, players: Record<string, Player>, id: string) {
  const ps = crewById(line, id)
    .playerIds.map((pid) => players[pid])
    .filter(Boolean);
  if (!ps.length) return 50;
  return ps.reduce((t, p) => t + (p.ratings.iq + p.ratings.layup + p.ratings.midRange + p.ratings.perimeterD + p.ratings.speed) / 5, 0) / ps.length;
}

/** The next line game, with you on it (call `simUntilYou` first). */
export function lineGame(parkId: string, rules: ParkRules, line: LineState, players: Record<string, Player>, controller: string, seed: number): PendingMatch {
  const [h, a] = nextMatchup(line);
  const mine = h === line.you ? h : a;
  const theirs = mine === h ? a : h;
  const roster = (id: string) => crewById(line, id).playerIds.map((pid) => players[pid]);
  const session: ParkSession = { parkId, mode: "line", rules, outfits: outfitsFor(Object.values(players)), sideShirts: [...SIDE_COLORS] };
  return {
    mode: "park",
    league: "pro",
    arena: "park",
    quarterMinutes: 1,
    returnTo: "/park/",
    seed,
    park: session,
    home: { team: crewTeam("you", crewById(line, mine).name, SIDE_COLORS[0]), roster: roster(mine), uniform: "home", controllers: [controller] },
    away: { team: crewTeam(theirs, crewById(line, theirs).name, SIDE_COLORS[1]), roster: roster(theirs), uniform: "home", controllers: [] },
  };
}
