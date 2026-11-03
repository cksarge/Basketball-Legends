// Builds a new franchise: a full league of generated rosters, ready for its first season.
import { generateRoster } from "@/engine/player";
import type { ClassYear, CollegeDivision, Conference, LeagueId, Player, Team } from "@/engine/types";
import { seasonGoals } from "./club/owner";
import { seedNumber } from "./seed";
import { defaultPlan } from "./coaching/plan";
import { leagueModule } from "./leagues";
import { fillGmState } from "./pro/gmState";
import { DEFAULT_AUTO, DEFAULT_LEAGUE, defaultLeagueSettings } from "./settings";
import { outsideSchedule, outsideTeams, worldTeams } from "./world";
import { FRANCHISE_VERSION, type Franchise, type FranchiseSettings, type WorldRef } from "./types";

const CLASS_YEARS: ClassYear[] = ["FR", "SO", "JR", "SR"];

export const DEFAULT_FRANCHISE_SETTINGS: FranchiseSettings = {
  quarterMinutes: 6,
  difficulty: "pro",
  closeGameMargin: 8,
  closeGamesOnly: false,
  auto: DEFAULT_AUTO,
  league: DEFAULT_LEAGUE,
};
const START_YEAR = 2026;

export { seedNumber };

/** Every player in college has a record of the seasons he's used. */
function collegeFile(p: Player): Player {
  const used = Math.max(0, CLASS_YEARS.indexOf(p.classYear ?? "FR"));
  return { ...p, file: { service: used, teamSeasons: used, eligibility: { used, redshirted: false } } };
}

/** `teams` is every team in the league. In college the world is the chosen team's division. */
export function createFranchise(o: {
  league: LeagueId;
  team: Team;
  teams: Team[];
  /** Conference names, for tournament labels. */
  conferences?: Conference[];
  seed: string;
  settings?: Partial<FranchiseSettings>;
  year?: number;
  now?: number;
}): Franchise {
  const year = o.year ?? START_YEAR;
  const now = o.now ?? Date.now();
  const world: WorldRef = o.league === "college" ? { league: o.league, division: o.team.tier as CollegeDivision } : { league: o.league };
  const teams = worldTeams(o.teams, world);
  const league = o.settings?.league ?? defaultLeagueSettings(o.league);
  const players: Record<string, Player> = {};
  const rosters: Record<string, string[]> = {};
  for (const t of teams) {
    // generated ids include a process-wide counter, so they're replaced to keep a seed repeatable
    const roster = generateRoster(t, seedNumber(`${o.seed}:${t.id}`)).map((p, i) => {
      const fresh = { ...p, id: `${t.id}-${i}` };
      return o.league === "college" ? collegeFile(fresh) : fresh;
    });
    rosters[t.id] = roster.map((p) => p.id);
    for (const p of roster) players[p.id] = p;
  }
  const date = leagueModule(o.league).calendar(year).opening;
  const made = fillGmState(
    {
      id: `f-${now.toString(36)}-${seedNumber(o.seed).toString(36)}`,
      version: FRANCHISE_VERSION,
      seed: o.seed,
      revision: 0,
      createdAt: now,
      updatedAt: now,
      league: o.league,
      world,
      formerWorlds: [],
      ...(o.conferences ? { conferences: Object.fromEntries(o.conferences.map((c) => [c.id, { name: c.name, short: c.short }])) } : {}),
      teamId: o.team.id,
      date,
      phase: "regular",
      settings: { ...DEFAULT_FRANCHISE_SETTINGS, ...o.settings, league },
      plan: defaultPlan(),
      devDate: date,
      players,
      rosters,
      season: {
        year,
        games: leagueModule(o.league).schedule(teams, year, o.seed, league),
        series: [],
        brackets: [],
        ...(world.division ? { outside: { games: outsideSchedule(outsideTeams(o.teams, world), world, year, o.seed, league), brackets: [] } } : {}),
        stats: {},
        playoffStats: {},
        awards: [],
      },
    },
    teams,
  );
  return { ...made, job: { ...made.job, goals: seasonGoals(made, teams) } };
}
