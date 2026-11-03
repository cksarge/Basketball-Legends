// College in Franchise: a full division with conference play, then the tournaments. Recruiting, NIL and the portal
// live in src/franchise/college/.
import { collegeCalendar } from "@/career/calendar";
import { generateCollegeSchedule } from "@/career/college/schedule";
import type { Team } from "@/engine/types";
import { advanceDivision } from "../college/brackets";
import { collegeAwards } from "../core/awards";
import type { Franchise } from "../types";
import type { LeagueModule } from "./index";

export const COLLEGE_ROSTER = { min: 10, max: 15, campMin: 13 };

function rosterProblem(f: Franchise): string | null {
  if (f.phase === "offseason") return null;
  const n = f.rosters[f.teamId].length;
  return n >= COLLEGE_ROSTER.min && n <= COLLEGE_ROSTER.max
    ? null
    : `You have ${n} players, and need ${COLLEGE_ROSTER.min} to ${COLLEGE_ROSTER.max} before you can play or sim.`;
}

/** Tournaments move along as results come in. The national champion ends the season. */
function postseason(f: Franchise, teams: Team[]): Franchise {
  if (f.phase === "offseason") return f;
  const next = advanceDivision({
    year: f.season.year,
    teams,
    games: f.season.games,
    brackets: f.season.brackets,
    format: f.settings.league.playoffFormat,
    names: f.conferences,
  });
  if (!next.changed) return f;
  const champion = next.brackets.find((b) => b.id === "national")?.champion;
  return {
    ...f,
    phase: champion ? "offseason" : "playoffs",
    season: { ...f.season, games: next.games, brackets: next.brackets, ...(champion ? { championId: champion } : {}) },
  };
}

const same = (f: Franchise) => f;
const unchanged = (f: Franchise) => ({ franchise: f, changedPlayers: [] });

export const collegeLeague: LeagueModule = {
  id: "college",
  calendar: (year) => {
    const c = collegeCalendar(year);
    return { opening: c.firstGame, lastGame: c.lastRegular, seasonEnd: c.seasonEnd };
  },
  quarterMinutes: 20,
  periods: 2,
  lastPeriodLabel: "2nd half",
  arena: "college",
  boss: "athletic director",
  roster: COLLEGE_ROSTER,
  systems: { cap: false, trades: false, freeAgency: false, draft: false, finances: false, recruiting: true, squads: false },
  // conference play takes up to 20 games and leaves at least 6 for the non-conference schedule
  schedule: (teams, year, seed, settings) => generateCollegeSchedule(teams, year, seed, settings.gamesPerSeason, Math.min(20, settings.gamesPerSeason - 6)),
  postseason,
  offseasonSteps: ["review"],
  offseasonDate: () => null,
  enterStep: same,
  canAdvance: () => ({ ok: true }),
  rosterProblem,
  fixRoster: same,
  weekly: unchanged,
  daily: unchanged,
  beforeNewSeason: (f, date) => ({ ...f, date }),
  newSeason: same,
  gates: same,
  closeSeason: same,
  awards: collegeAwards,
  goals: () => [],
  settingsOptions: { games: [30, 26, 22], fields: ["conferenceTournaments", "nationalField"] },
};
