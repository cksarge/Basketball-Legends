// Builds a new franchise: a full league of generated rosters, ready for its first season.
import { proCalendar } from "@/career/calendar";
import { generateRoster } from "@/engine/player";
import type { LeagueId, Player, Team } from "@/engine/types";
import { FRANCHISE_VERSION, type Franchise, type FranchiseSettings } from "./types";

export const DEFAULT_FRANCHISE_SETTINGS: FranchiseSettings = { quarterMinutes: 6, difficulty: "pro", closeGameMargin: 8 };
const START_YEAR = 2026;

/** generateRoster takes a number, and a franchise seed is a string. */
function seedNumber(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function createFranchise(o: {
  league: LeagueId;
  team: Team;
  teams: Team[];
  seed: string;
  settings?: Partial<FranchiseSettings>;
  year?: number;
  now?: number;
}): Franchise {
  const year = o.year ?? START_YEAR;
  const now = o.now ?? Date.now();
  const players: Record<string, Player> = {};
  const rosters: Record<string, string[]> = {};
  for (const t of o.teams) {
    // generated ids include a process-wide counter, so they're replaced to keep a seed repeatable
    const roster = generateRoster(t, seedNumber(`${o.seed}:${t.id}`)).map((p, i) => ({ ...p, id: `${t.id}-${i}` }));
    rosters[t.id] = roster.map((p) => p.id);
    for (const p of roster) players[p.id] = p;
  }
  return {
    id: `f-${now.toString(36)}-${seedNumber(o.seed).toString(36)}`,
    version: FRANCHISE_VERSION,
    seed: o.seed,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    league: o.league,
    teamId: o.team.id,
    date: proCalendar(year).camp,
    phase: "regular",
    settings: { ...DEFAULT_FRANCHISE_SETTINGS, ...o.settings },
    players,
    rosters,
    season: { year, games: [], series: [], stats: {}, playoffStats: {}, awards: [] },
  };
}
