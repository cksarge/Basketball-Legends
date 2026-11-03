// College in Franchise: a full division with conference play, then the tournaments. Recruiting, NIL and the portal
// live in src/franchise/college/.
import { collegeCalendar } from "@/career/calendar";
import { generateCollegeSchedule } from "@/career/college/schedule";
import { Rng } from "@/engine/rng";
import type { CollegeDivision, Team } from "@/engine/types";
import { playerOvr } from "@/engine/player";
import { advanceDivision } from "../college/brackets";
import { newBook } from "../college/nil";
import { SCHOLARSHIPS, aiRecruiting, earlySigning, earlySigningDate, newClass, refillPoints, resolveWeek } from "../college/recruiting";
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

/** Players past the scholarship limit are walk-ons. Division III has no athletic scholarships. */
function markWalkOns(f: Franchise, division: CollegeDivision): Franchise {
  if (division === "D3") return f;
  const players = { ...f.players };
  for (const ids of Object.values(f.rosters)) {
    const best = [...ids].sort((a, b) => playerOvr(f.players[b]) - playerOvr(f.players[a]) || a.localeCompare(b));
    for (const id of best.slice(SCHOLARSHIPS[division])) players[id] = { ...players[id], file: { ...players[id].file!, walkOn: true } };
  }
  return { ...f, players };
}

/** The first class is already eight weeks into recruiting when the save starts. */
const HEAD_START_WEEKS = 8;

function setup(f: Franchise, teams: Team[]): Franchise {
  const division = f.world.division!;
  const marked = markWalkOns(f, division);
  const started: Franchise = {
    ...marked,
    college: {
      division,
      classYear: f.season.year + 1,
      recruits: [],
      points: {},
      earlySigned: false,
      nil: Object.fromEntries(teams.map((t) => [t.id, newBook(t, division)])),
      portal: null,
      declared: [],
      pitched: [],
    },
  };
  return newClass(started, teams, f.season.year + 1, HEAD_START_WEEKS);
}

/** AI programs recruit, the week's commitments land, and points refill. */
function weekly(f: Franchise, teams: Team[], date: string) {
  if (!f.college) return { franchise: f, changedPlayers: [] };
  const worked = aiRecruiting(f, teams, f.settings.auto.recruiting);
  return { franchise: refillPoints(resolveWeek(worked, new Rng(`${f.seed}:recruit:${date}`)), teams), changedPlayers: [] };
}

function daily(f: Franchise) {
  const due = f.college && !f.college.earlySigned && f.date >= earlySigningDate(f.college.classYear - 1);
  return { franchise: due ? earlySigning(f) : f, changedPlayers: [] };
}

const same = (f: Franchise) => f;

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
  setup,
  enterStep: same,
  canAdvance: () => ({ ok: true }),
  rosterProblem,
  fixRoster: same,
  weekly,
  daily,
  beforeNewSeason: (f, date) => ({ ...f, date }),
  newSeason: same,
  gates: same,
  closeSeason: same,
  awards: collegeAwards,
  goals: () => [],
  settingsOptions: { games: [30, 26, 22], fields: ["conferenceTournaments", "nationalField"] },
};
