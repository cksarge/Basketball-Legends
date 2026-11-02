// The summer, one step at a time, and the start of the next season.
import { fullName, playerOvr } from "@/engine/player";
import type { Team } from "@/engine/types";
import { leagueModule } from "../leagues";
import { currentPick, trimRoster } from "../pro/draft";
import { newDraftState } from "../pro/draftClass";
import { runLottery } from "../pro/lottery";
import { rollPicks } from "../pro/picks";
import { OFFSEASON_ROSTER_MAX, ROSTER_MAX, nextCap } from "../pro/rules";
import type { Franchise, OffseasonStep, RetiredPlayer, SeasonSummary } from "../types";
import { leagueProgress } from "./progress";

/** The most unsigned players the league keeps around. The rest leave the game. */
const FREE_AGENT_POOL = 100;

export function canAdvance(f: Franchise): { ok: true } | { ok: false; reason: string } {
  if (f.offseason?.step === "draft" && currentPick(f)) return { ok: false, reason: "Finish the draft first." };
  return { ok: true };
}

const allTeams = (f: Franchise, limit: number, teams: Team[]) => teams.reduce((x, t) => trimRoster(x, t.id, limit), f);

/** Each contract loses a year. Task 7 replaces this with real expiries. */
function rollContracts(f: Franchise): Franchise {
  const players = Object.fromEntries(
    Object.entries(f.players).map(([id, p]) => {
      const file = { ...p.file!, service: p.file!.service + (p.teamId ? 1 : 0), teamSeasons: p.file!.teamSeasons + (p.teamId ? 1 : 0) };
      if (!p.contract) return [id, { ...p, file }];
      return [id, { ...p, file, contract: { ...p.contract, years: Math.max(1, p.contract.years - 1) } }];
    }),
  );
  return { ...f, players };
}

/** What happens on arriving at a step. */
function enter(f: Franchise, step: OffseasonStep, teams: Team[]): Franchise {
  if (step === "progress") {
    const { franchise, report } = leagueProgress(f);
    return { ...franchise, offseason: { step, report } };
  }
  if (step === "lottery") return runLottery(f, teams);
  if (step === "contracts") return allTeams(f, OFFSEASON_ROSTER_MAX, teams);
  if (step === "freeAgency") return { ...rollContracts(f), cap: nextCap(f.cap, f.seed) };
  return f;
}

export function advanceOffseason(f: Franchise, teams: Team[]): Franchise {
  if (!f.offseason || !canAdvance(f).ok) return f;
  const m = leagueModule(f.league);
  const step = m.offseasonSteps[m.offseasonSteps.indexOf(f.offseason.step) + 1];
  if (!step) return startNewSeason(f, teams);
  const date = m.offseasonDate(step, f.season.year);
  const moved: Franchise = { ...f, date: date && date > f.date ? date : f.date, offseason: { ...f.offseason, step } };
  return enter(moved, step, teams);
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
    });
  }
  return { players, retired: [...f.retired, ...retired], freeAgents: pool.slice(0, FREE_AGENT_POOL) };
}

export function startNewSeason(f: Franchise, teams: Team[]): Franchise {
  const year = f.season.year + 1;
  const m = leagueModule(f.league);
  const trimmed = allTeams(f, ROSTER_MAX, teams);
  const left = leaveLeague(trimmed, year);
  const healed = Object.fromEntries(
    Object.entries(left.players).map(([id, p]) => {
      if (!p.injury) return [id, p];
      const fresh = { ...p };
      delete fresh.injury;
      return [id, fresh];
    }),
  );
  const date = m.calendar(year).opening;
  const next: Franchise = {
    ...trimmed,
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
  return { ...next, picks: rollPicks(next, teams) };
}
