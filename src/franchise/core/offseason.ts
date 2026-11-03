// The summer, one step at a time, and the start of the next season.
import { fullName, playerOvr } from "@/engine/player";
import type { Team } from "@/engine/types";
import { autoFinances, autoStep } from "../auto";
import { inRecord, seasonGoals } from "../club/owner";
import { leagueTactics } from "../coaching/aiPlan";
import { addSeason } from "../history/career";
import { induct } from "../history/hall";
import { updateRecords } from "../history/records";
import { leagueModule } from "../leagues";
import { applyPending } from "../settings";
import type { Franchise, RetiredPlayer, SeasonSummary } from "../types";
import { clearUndo, prunePlan } from "./moves";
import { outsideSchedule, outsideTeams, worldTeams } from "../world";

/** The most unsigned players the league keeps around. The rest leave the game. */
const FREE_AGENT_POOL = 100;

export function canAdvance(f: Franchise): { ok: true } | { ok: false; reason: string } {
  if (f.job.fired) return { ok: false, reason: "Choose your next job first." };
  return leagueModule(f.league).canAdvance(f);
}

/** `all` is every team in the league. */
export function advanceOffseason(start: Franchise, all: Team[]): Franchise {
  const f = autoStep(start);
  if (!f.offseason || !canAdvance(f).ok) return start;
  const m = leagueModule(f.league);
  const teams = worldTeams(all, f.world);
  const step = m.offseasonSteps[m.offseasonSteps.indexOf(f.offseason.step) + 1];
  if (!step) return startNewSeason(f, all);
  const date = m.offseasonDate(step, f.season.year);
  const moved: Franchise = { ...f, date: date && date > f.date ? date : f.date, offseason: { ...f.offseason, step } };
  return autoStep(prunePlan(clearUndo(m.daily(m.enterStep(moved, step, teams), teams, false).franchise)));
}

function summarize(f: Franchise): SeasonSummary {
  let w = 0,
    l = 0;
  for (const g of f.season.games) {
    if (!g.result || !inRecord(f, g) || (g.homeId !== f.teamId && g.awayId !== f.teamId)) continue;
    if (g.result.home > g.result.away === (g.homeId === f.teamId)) w++;
    else l++;
  }
  const { year, championId, awards } = f.season;
  return { year, ...(championId ? { championId } : {}), record: { w, l }, awards: awards.map((a) => ({ ...a, name: fullName(f.players[a.playerId]) })) };
}

/** Takes retired players out of the league, and the emptiest of the free agent pool with them. */
function leaveLeague(f: Franchise, year: number) {
  const report = f.offseason?.report;
  const pool = [...f.freeAgents].sort((a, b) => playerOvr(f.players[b]) - playerOvr(f.players[a]));
  const dropped = pool.slice(FREE_AGENT_POOL);
  const gone = [...(report?.retired ?? []), ...dropped];
  const players = { ...f.players };
  const retired: RetiredPlayer[] = [];
  for (const id of gone) {
    const p = f.players[id];
    delete players[id];
    if (!p.file?.service) continue;
    retired.push({
      id,
      name: fullName(p),
      pos: p.pos,
      year,
      age: p.age,
      peak: p.file.peak ?? playerOvr(p),
      lastTeamId: report?.lastTeams[id] ?? null,
      career: p.file.career,
      awards: p.file.awards,
      titles: p.file.titles,
    });
  }
  return { players, retired: [...f.retired, ...retired], freeAgents: pool.slice(0, FREE_AGENT_POOL) };
}

export function startNewSeason(old: Franchise, all: Team[]): Franchise {
  const f = applyPending(old);
  const teams = worldTeams(all, f.world);
  const year = f.season.year + 1;
  const m = leagueModule(f.league);
  const date = m.calendar(year).opening;
  const cleared = m.beforeNewSeason(f, date);
  const credited = { ...cleared, players: Object.fromEntries(Object.entries(cleared.players).map(([id, p]) => [id, addSeason(p, f.season.stats[id], f)])) };
  const left = leaveLeague(credited, year);
  const remembered = updateRecords({ ...credited, retired: left.retired });
  const inducted = left.retired.slice(credited.retired.length).reduce(induct, remembered);
  const healed = Object.fromEntries(
    Object.entries(left.players).map(([id, p]) => {
      if (!p.injury) return [id, p];
      const fresh = { ...p };
      delete fresh.injury;
      return [id, fresh];
    }),
  );
  const next: Franchise = {
    ...inducted,
    ...left,
    players: healed,
    date,
    devDate: date,
    phase: "regular",
    talks: {},
    history: [...f.history, summarize(f)],
    season: {
      year,
      games: m.schedule(teams, year, f.seed, f.settings.league, `${f.seed}:${year}`),
      series: [],
      brackets: [],
      ...(f.world.division ? { outside: { games: outsideSchedule(outsideTeams(all, f.world), f.world, year, f.seed, f.settings.league), brackets: [] } } : {}),
      stats: {},
      playoffStats: {},
      awards: [],
    },
  };
  delete next.offseason;
  delete next.freeAgency;
  const ready = prunePlan(clearUndo(m.newSeason(next, teams)));
  const coached = autoFinances(autoStep({ ...ready, aiTactics: leagueTactics(ready) }), teams);
  return { ...coached, job: { ...coached.job, goals: seasonGoals(coached, teams) } };
}
