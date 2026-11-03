// The user's world, and everyone outside it. In college only the user's division has real players: the other
// divisions play on team strength, the way Road to Legend runs them, and their rosters are generated when viewed.
import { generateCollegeSchedule } from "@/career/college/schedule";
import { COLLEGE_STRENGTH_BIAS, SCORE_LIFT } from "@/career/college/season";
import { simScore } from "@/career/hs/sim";
import type { IsoDate, ScheduledGame } from "@/career/types";
import { generateRoster, teamTalentTarget } from "@/engine/player";
import { Rng } from "@/engine/rng";
import type { CollegeDivision, Player, Team } from "@/engine/types";
import { seedNumber } from "./seed";
import type { Franchise, LeagueSettings, WorldRef } from "./types";

const DIVISIONS: CollegeDivision[] = ["D1", "D2", "D3"];
/** How much a program's strength moves from year to year. */
const YEARLY_SWING = 2.4;

const inWorld = (t: Team, world: WorldRef) => t.league === world.league && (!world.division || t.tier === world.division);

/** The teams with real players. Pro passes its list straight through. */
export function worldTeams(all: Team[], world: WorldRef): Team[] {
  if (!world.division) return all;
  return all.filter((t) => inWorld(t, world));
}

/** The league's other teams, which play on strength alone. */
export const outsideTeams = (all: Team[], world: WorldRef): Team[] =>
  world.division ? all.filter((t) => t.league === world.league && !inWorld(t, world)) : [];

/** Regular seasons for every other division, each on its own schedule. */
export function outsideSchedule(teams: Team[], world: WorldRef, year: number, seed: string, settings: LeagueSettings): ScheduledGame[] {
  if (world.league !== "college") return [];
  const games: ScheduledGame[] = [];
  for (const division of DIVISIONS) {
    if (division === world.division) continue;
    const members = teams.filter((t) => t.tier === division);
    if (members.length < 2) continue;
    games.push(...generateCollegeSchedule(members, year, `${seed}:outside`, settings.gamesPerSeason, Math.min(20, settings.gamesPerSeason - 6)));
  }
  return games.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** A program's strength this year, on the overall scale, with a good or bad year mixed in. */
export function outsideStrength(t: Team, year: number, seed: string): number {
  return teamTalentTarget(t) + COLLEGE_STRENGTH_BIAS + new Rng(`${seed}:${t.id}:${year}:str`).normal(0, YEARLY_SWING);
}

/** A roster to look at. It's the same every time for a team and year. */
export function outsideRoster(t: Team, year: number, seed: string): Player[] {
  return generateRoster(t, seedNumber(`${seed}:${t.id}:${year}`)).map((p, i) => ({ ...p, id: `${t.id}-o${year}-${i}` }));
}

/** Decides every outside game up to and including the date. */
export function simOutsideDay(f: Franchise, outside: Team[], date: IsoDate): Franchise {
  const season = f.season.outside;
  if (!season || !season.games.some((g) => !g.result && g.date <= date)) return f;
  const byId = new Map(outside.map((t) => [t.id, t]));
  const strength = (id: string) => {
    const t = byId.get(id);
    if (!t) throw new Error(`Outside team ${id} wasn't passed in.`);
    return outsideStrength(t, f.season.year, f.seed);
  };
  const games = season.games.map((g) => {
    if (g.result || g.date > date) return g;
    const r = simScore(strength(g.homeId), strength(g.awayId), new Rng(`${f.seed}:${g.id}`), g.neutral);
    return { ...g, result: { ...r, home: r.home + SCORE_LIFT, away: r.away + SCORE_LIFT } };
  });
  return { ...f, season: { ...f.season, outside: { ...season, games } } };
}
