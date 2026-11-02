// The summer, one step at a time, and the start of the next season.
import { fullName, playerOvr } from "@/engine/player";
import { Rng } from "@/engine/rng";
import type { Team } from "@/engine/types";
import { seasonGoals } from "../club/owner";
import { addSeason } from "../history/career";
import { leagueModule } from "../leagues";
import { decideOptions, pendingOptions, rollContracts } from "../pro/contracts";
import { currentPick } from "../pro/draft";
import { newDraftState } from "../pro/draftClass";
import { aiFillRosters, aiResign, cutTo, finishBidding, openFreeAgency } from "../pro/freeAgency";
import { runLottery } from "../pro/lottery";
import { rollPicks } from "../pro/picks";
import { processWaivers, standardCount } from "../pro/rosterMoves";
import { aiTradeDay } from "../pro/tradeAi";
import { OFFSEASON_ROSTER_MAX, ROSTER_MAX, ROSTER_MIN } from "../pro/rules";
import type { Franchise, OffseasonStep, RetiredPlayer, SeasonSummary } from "../types";
import { clearUndo, prunePlan } from "./moves";
import { leagueProgress } from "./progress";

/** The most unsigned players the league keeps around. The rest leave the game. */
const FREE_AGENT_POOL = 100;

export function canAdvance(f: Franchise): { ok: true } | { ok: false; reason: string } {
  const step = f.offseason?.step;
  if (f.job.fired) return { ok: false, reason: "Choose your next job first." };
  if (step === "draft" && currentPick(f)) return { ok: false, reason: "Finish the draft first." };
  if (step === "contracts" && pendingOptions(f, f.teamId).length) return { ok: false, reason: "Decide your team options first." };
  if (step === "camp") {
    const n = standardCount(f, f.teamId);
    if (n < ROSTER_MIN || n > ROSTER_MAX) return { ok: false, reason: `You have ${n} players on standard deals, and need ${ROSTER_MIN} to ${ROSTER_MAX}.` };
  }
  return { ok: true };
}

/** What happens on arriving at a step. */
function enter(f: Franchise, step: OffseasonStep, teams: Team[]): Franchise {
  if (step === "progress") {
    const { franchise, report } = leagueProgress(f);
    return { ...franchise, offseason: { step, report } };
  }
  if (step === "lottery") return runLottery(f, teams);
  if (step === "draft") return aiTradeDay(f, new Rng(`${f.seed}:draftday:${f.draft.year}`)).franchise;
  if (step === "contracts") return teams.reduce((x, t) => (t.id === f.teamId ? x : cutTo(x, t.id, OFFSEASON_ROSTER_MAX)), decideOptions(f));
  if (step === "freeAgency") return openFreeAgency(aiResign(rollContracts(f)));
  if (step === "camp") return aiFillRosters(finishBidding(f));
  return f;
}

export function advanceOffseason(f: Franchise, teams: Team[]): Franchise {
  if (!f.offseason || !canAdvance(f).ok) return f;
  const m = leagueModule(f.league);
  const step = m.offseasonSteps[m.offseasonSteps.indexOf(f.offseason.step) + 1];
  if (!step) return startNewSeason(f, teams);
  const date = m.offseasonDate(step, f.season.year);
  const moved: Franchise = { ...f, date: date && date > f.date ? date : f.date, offseason: { ...f.offseason, step } };
  return prunePlan(clearUndo(processWaivers(enter(moved, step, teams)).franchise));
}

function summarize(f: Franchise): SeasonSummary {
  let w = 0,
    l = 0;
  for (const g of f.season.games) {
    if (!g.result || g.kind !== "region" || (g.homeId !== f.teamId && g.awayId !== f.teamId)) continue;
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

export function startNewSeason(f: Franchise, teams: Team[]): Franchise {
  const year = f.season.year + 1;
  const m = leagueModule(f.league);
  const date = m.calendar(year).opening;
  const trimmed = aiFillRosters(processWaivers({ ...f, date }).franchise);
  const cleared = processWaivers({ ...trimmed, waivers: trimmed.waivers.map((w) => ({ ...w, until: date })) }).franchise;
  const credited = { ...cleared, players: Object.fromEntries(Object.entries(cleared.players).map(([id, p]) => [id, addSeason(p, f.season.stats[id], f)])) };
  const left = leaveLeague(credited, year);
  const healed = Object.fromEntries(
    Object.entries(left.players).map(([id, p]) => {
      if (!p.injury) return [id, p];
      const fresh = { ...p };
      delete fresh.injury;
      return [id, fresh];
    }),
  );
  const next: Franchise = {
    ...credited,
    ...left,
    players: healed,
    date,
    devDate: date,
    phase: "regular",
    talks: {},
    history: [...f.history, summarize(f)],
    draft: newDraftState(f.seed, year + 1),
    season: { year, games: m.schedule(teams, year, f.seed), series: [], stats: {}, playoffStats: {}, awards: [] },
  };
  delete next.offseason;
  delete next.freeAgency;
  const ready = prunePlan(clearUndo({ ...next, picks: rollPicks(next, teams) }));
  return { ...ready, job: { ...ready.job, goals: seasonGoals(ready, teams) } };
}
