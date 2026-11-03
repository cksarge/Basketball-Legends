// College in Franchise: a full division with conference play, then the tournaments. Recruiting, NIL and the portal
// live in src/franchise/college/.
import { collegeCalendar, iso } from "@/career/calendar";
import { generateCollegeSchedule } from "@/career/college/schedule";
import { Rng } from "@/engine/rng";
import type { CollegeDivision, Team } from "@/engine/types";
import { playerOvr } from "@/engine/player";
import { advanceDivision } from "../college/brackets";
import { youngCore } from "../club/owner";
import { adGoals } from "../club/program";
import { aiRedshirts, collegeProgress, decideDeclarations, fillWalkOns, overCommitted } from "../college/eligibility";
import { newBook, rollNil } from "../college/nil";
import { PORTAL_ROUNDS, closePortal, openPortal, portalRound } from "../college/portal";
import { SCHOLARSHIPS, aiRecruiting, earlySigning, earlySigningDate, newClass, refillPoints, resolveWeek, signingDay } from "../college/recruiting";
import { collegeAwards } from "../core/awards";
import type { Franchise, OffseasonStep } from "../types";
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

/** Weeks of recruiting the next class gets in before the season starts. */
const CAMP_HEAD_START = 4;

/** Runs the portal's rounds that are left, then closes it. */
export function finishPortal(f: Franchise, teams: Team[]): Franchise {
  let next = f;
  while (next.college?.portal && next.college.portal.round <= PORTAL_ROUNDS)
    next = portalRound(next, teams, new Rng(`${f.seed}:portal:${f.season.year}:${next.college.portal.round}`));
  return closePortal(next, teams);
}

function enterStep(f: Franchise, step: OffseasonStep, teams: Team[]): Franchise {
  if (step === "declarations") return decideDeclarations(f, teams);
  if (step === "portal") return openPortal(f, teams, new Rng(`${f.seed}:portal:${f.season.year}`));
  if (step === "signing") return signingDay(finishPortal(f, teams), teams);
  if (step === "progress") {
    const { franchise, report } = collegeProgress(f);
    return { ...franchise, offseason: { step, report } };
  }
  if (step === "camp") {
    const rng = new Rng(`${f.seed}:camp:${f.season.year}`);
    const filled = teams.reduce((x, t) => (t.id === f.teamId ? x : fillWalkOns(x, t.id, rng)), f);
    const sitting = aiRedshirts(filled, teams, f.season.year + 1);
    const rolled = rollNil(sitting, teams);
    const cleared: Franchise = { ...rolled, college: { ...rolled.college!, declared: [], pitched: [] } };
    return newClass(cleared, teams, f.college!.classYear + 1, CAMP_HEAD_START, f.settings.auto.recruiting);
  }
  return f;
}

function canAdvance(f: Franchise): { ok: true } | { ok: false; reason: string } {
  const step = f.offseason?.step;
  if (step === "declarations" || step === "portal" || step === "signing") {
    const over = overCommitted(f, f.teamId);
    if (over > 0) return { ok: false, reason: `You have ${over} more commitment${over === 1 ? "" : "s"} than spots next season. Pull an offer first.` };
  }
  if (step === "camp") {
    const n = f.rosters[f.teamId].length;
    if (n < COLLEGE_ROSTER.campMin || n > COLLEGE_ROSTER.max)
      return { ok: false, reason: `You have ${n} players, and need ${COLLEGE_ROSTER.campMin} to ${COLLEGE_ROSTER.max}. Add walk-ons or release players.` };
  }
  return { ok: true };
}

/** Auto-manage's roster: walk-ons up to 13 in the summer (10 in season), and the weakest walk-ons go past 15. */
function fixRoster(f: Franchise): Franchise {
  const min = f.phase === "offseason" ? COLLEGE_ROSTER.campMin : COLLEGE_ROSTER.min;
  const filled = fillWalkOns(f, f.teamId, new Rng(`${f.seed}:walkons:${f.date}`), min);
  const extra = filled.rosters[f.teamId].length - COLLEGE_ROSTER.max;
  if (extra <= 0) return filled;
  const cut = [...filled.rosters[f.teamId]]
    .sort(
      (a, b) =>
        Number(!!filled.players[b].file?.walkOn) - Number(!!filled.players[a].file?.walkOn) || playerOvr(filled.players[a]) - playerOvr(filled.players[b]),
    )
    .slice(0, extra);
  const players = { ...filled.players };
  for (const id of cut) delete players[id];
  return { ...filled, players, rosters: { ...filled.rosters, [f.teamId]: filled.rosters[f.teamId].filter((id) => !cut.includes(id)) } };
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
  offseasonSteps: ["review", "declarations", "portal", "signing", "progress", "camp"],
  offseasonDate: (step, year) => {
    if (step === "declarations") return iso(year + 1, 4, 20);
    if (step === "portal") return iso(year + 1, 4, 22);
    if (step === "signing") return iso(year + 1, 5, 1);
    if (step === "progress") return iso(year + 1, 6, 1);
    if (step === "camp") return iso(year + 1, 10, 1);
    return null;
  },
  setup,
  enterStep,
  canAdvance,
  rosterProblem,
  fixRoster,
  weekly,
  daily,
  beforeNewSeason: (f, date) => ({ ...f, date }),
  newSeason: same,
  gates: same,
  closeSeason: same,
  // imported functions are read when called, since these modules import each other
  awards: (f, teams) => collegeAwards(f, teams),
  goals: (f, teams) => adGoals(f, teams),
  development: (f) => youngCore(f),
  settingsOptions: { games: [30, 26, 22], fields: ["conferenceTournaments", "nationalField"] },
};
