// League data access: lazy-loads generated team data and builds default rosters.
import type { Conference, LeagueId, Player, Team } from "@/engine/types";
import { generateRoster } from "@/engine/player";

export interface LeagueData { conferences: Conference[]; teams: Team[] }

export const LEAGUES: { id: LeagueId; name: string; short: string; blurb: string }[] = [
  { id: "pro", name: "Pro Basketball League", short: "Pro", blurb: "30 cities, 82-game grind, championship or bust." },
  { id: "college", name: "National Collegiate Hoops", short: "College", blurb: "1,092 programs across three divisions and 100 conferences." },
  { id: "hs", name: "Arizona Prep Hoops", short: "Arizona HS", blurb: "Every Arizona high school, 6A through 1A, region by region." },
];

const cache: Partial<Record<LeagueId, Promise<LeagueData>>> = {};

export function loadLeague(id: LeagueId): Promise<LeagueData> {
  if (!cache[id]) {
    cache[id] = (id === "pro" ? import("./generated/pro.json") : id === "college" ? import("./generated/college.json") : import("./generated/hs.json"))
      .then((m) => (m.default ?? m) as unknown as LeagueData);
  }
  return cache[id]!;
}

export async function loadAllLeagues(): Promise<Record<LeagueId, LeagueData>> {
  const [pro, college, hs] = await Promise.all([loadLeague("pro"), loadLeague("college"), loadLeague("hs")]);
  return { pro, college, hs };
}

/** Roster overrides from an active roster pack or editor, keyed by team id. */
const rosterOverrides = new Map<string, Player[]>();
const rosterCache = new Map<string, Player[]>();

export function setRosterOverride(teamId: string, roster: Player[] | null) {
  if (roster) rosterOverrides.set(teamId, roster);
  else rosterOverrides.delete(teamId);
}

export function clearRosterOverrides() {
  rosterOverrides.clear();
}

export function rosterFor(team: Team): Player[] {
  const o = rosterOverrides.get(team.id);
  if (o) return o;
  let r = rosterCache.get(team.id);
  if (!r) {
    r = generateRoster(team);
    rosterCache.set(team.id, r);
  }
  return r;
}

export function teamLabel(t: Team) {
  return `${t.name} ${t.nickname}`;
}

export function tierLabel(t: Team) {
  if (t.league === "pro") return "Pro";
  if (t.league === "college") return t.tier === "D1" ? "Division I" : t.tier === "D2" ? "Division II" : "Division III";
  return `${t.tier} Arizona`;
}
