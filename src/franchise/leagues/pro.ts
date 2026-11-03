// The pro league in Franchise: the 82-game schedule, play-in and best-of-seven playoffs, and the general manager's systems.
import { addDays, draftCalendar, iso, proCalendar } from "@/career/calendar";
import { standings } from "@/career/hs/sim";
import { nextSeries, seriesWins } from "@/career/pro/bracket";
import { generateProSchedule } from "@/career/pro/schedule";
import type { IsoDate, ProSeries, ScheduledGame } from "@/career/types";
import { Rng } from "@/engine/rng";
import type { Team } from "@/engine/types";
import { closeSeasonBooks, payGates } from "../club/finance";
import { proGoals, youngCore } from "../club/owner";
import { seasonAwards } from "../core/awards";
import { leagueProgress } from "../core/progress";
import { addNews, draftNews, retirementNews, signingNews, tradeNews } from "../history/news";
import { decideOptions, pendingOptions, rollContracts } from "../pro/contracts";
import { currentPick } from "../pro/draft";
import { newDraftState } from "../pro/draftClass";
import { aiFillRosters, aiResign, cutTo, finishBidding, openFreeAgency, setRoster, weeklyMarket } from "../pro/freeAgency";
import { runLottery } from "../pro/lottery";
import { rollPicks } from "../pro/picks";
import { processWaivers, rosterProblem, standardCount } from "../pro/rosterMoves";
import { OFFSEASON_ROSTER_MAX, ROSTER_MAX, ROSTER_MIN } from "../pro/rules";
import { weeklyScouting } from "../pro/scouting";
import { aiTradeDay, refreshOffers } from "../pro/tradeAi";
import { trimSchedule } from "../settings";
import type { Franchise, OffseasonStep } from "../types";
import type { LeagueModule } from "./index";

const conferenceOf = (t: Team): "East" | "West" => (t.conferenceId === "pro-east" ? "East" : "West");

/** Conference order, best first (win percentage, then point difference). */
export function conferenceSeeds(f: Franchise, teams: Team[], conf: "East" | "West"): string[] {
  const ids = teams.filter((t) => conferenceOf(t) === conf).map((t) => t.id);
  const table = standings(
    f.season.games.filter((g) => g.kind === "region"),
    ids,
  );
  return [...table.values()].sort((a, b) => b.w - a.w || b.pf - b.pa - (a.pf - a.pa) || a.teamId.localeCompare(b.teamId)).map((r) => r.teamId);
}

function postseason(f: Franchise, teams: Team[]): Franchise {
  if (f.phase === "offseason" || f.season.games.some((g) => g.kind === "region" && !g.result)) return f;
  const games = [...f.season.games];
  const series: ProSeries[] = f.season.series.map((x) => ({ ...x, games: [...x.games] }));
  const byId = new Map(games.map((g) => [g.id, g]));
  const seedOrder = { East: conferenceSeeds(f, teams, "East"), West: conferenceSeeds(f, teams, "West") };
  for (let guard = 0; guard < 100; guard++) {
    let changed = false;
    const fresh = nextSeries({ year: f.season.year, games, series, seeds: (conf) => seedOrder[conf], format: f.settings.league.playoffFormat });
    if (fresh.length) {
      series.push(...fresh);
      changed = true;
    }
    for (const x of series) {
      if (x.winner) continue;
      const w = seriesWins(x, byId);
      const need = Math.ceil(x.bestOf / 2);
      if (w.high >= need || w.low >= need) {
        x.winner = w.high >= need ? x.high : x.low;
        changed = true;
        continue;
      }
      const last = x.games.length ? byId.get(x.games[x.games.length - 1]) : undefined;
      if (last && !last.result) continue;
      const i = x.games.length;
      const highHome = x.bestOf === 1 || [0, 1, 4, 6].includes(i);
      const g: ScheduledGame = {
        id: `${x.id}-${f.season.year}-g${i}`,
        date: addDays(x.start, i * 2),
        level: "pro",
        homeId: highHome ? x.high : x.low,
        awayId: highHome ? x.low : x.high,
        kind: "playoff",
        label: x.bestOf === 1 ? x.label : `${x.label} Game ${i + 1}`,
      };
      x.games.push(g.id);
      games.push(g);
      byId.set(g.id, g);
      changed = true;
    }
    if (!changed) break;
  }
  const champion = series.find((x) => x.id === "finals")?.winner;
  const phase = champion ? "offseason" : series.some((x) => x.round >= 1) ? "playoffs" : series.length ? "playIn" : f.phase;
  return { ...f, phase, season: { ...f.season, games, series, ...(champion ? { championId: champion } : {}) } };
}

function enterStep(f: Franchise, step: OffseasonStep, teams: Team[]): Franchise {
  if (step === "progress") {
    const { franchise, report } = leagueProgress(f);
    const reported: Franchise = { ...franchise, offseason: { step, report } };
    return addNews(reported, retirementNews(reported, teams));
  }
  if (step === "lottery") return runLottery(f, teams);
  if (step === "draft") return aiTradeDay(f, new Rng(`${f.seed}:draftday:${f.draft.year}`)).franchise;
  if (step === "contracts")
    return addNews(
      teams.reduce((x, t) => (t.id === f.teamId ? x : cutTo(x, t.id, OFFSEASON_ROSTER_MAX)), decideOptions(f)),
      draftNews(f, teams),
    );
  if (step === "freeAgency") return openFreeAgency(aiResign(rollContracts(f)));
  if (step === "camp") {
    const done = finishBidding(f);
    return addNews(aiFillRosters(done), signingNews(done, teams));
  }
  return f;
}

function canAdvance(f: Franchise): { ok: true } | { ok: false; reason: string } {
  const step = f.offseason?.step;
  if (step === "draft" && currentPick(f)) return { ok: false, reason: "Finish the draft first." };
  if (step === "contracts" && pendingOptions(f, f.teamId).length) return { ok: false, reason: "Decide your team options first." };
  if (step === "camp") {
    const n = standardCount(f, f.teamId);
    if (n < ROSTER_MIN || n > ROSTER_MAX) return { ok: false, reason: `You have ${n} players on standard deals, and need ${ROSTER_MIN} to ${ROSTER_MAX}.` };
  }
  return { ok: true };
}

/** Free agents sign, scouts work, and AI teams talk trades. */
function weekly(f: Franchise, teams: Team[], date: IsoDate) {
  const market = weeklyMarket(weeklyScouting(f));
  const trades = aiTradeDay(refreshOffers(market.franchise), new Rng(`${f.seed}:trades:${date}`));
  const reported = addNews(
    trades.franchise,
    trades.franchise.tradeLog.slice(market.franchise.tradeLog.length).flatMap((t) => tradeNews(trades.franchise, t, teams)),
  );
  return { franchise: reported, changedPlayers: [...market.changedPlayers, ...trades.changedPlayers] };
}

/** Rosters fill and waivers clear on the new opening day. */
function beforeNewSeason(f: Franchise, date: IsoDate): Franchise {
  const trimmed = aiFillRosters(processWaivers({ ...f, date }).franchise);
  return processWaivers({ ...trimmed, waivers: trimmed.waivers.map((w) => ({ ...w, until: date })) }).franchise;
}

export const proLeague: LeagueModule = {
  id: "pro",
  calendar: (year) => {
    const c = proCalendar(year);
    return { opening: c.opening, lastGame: c.lastGame, seasonEnd: c.seasonEnd };
  },
  quarterMinutes: 12,
  periods: 4,
  lastPeriodLabel: "4th quarter",
  arena: "pro",
  boss: "owner",
  roster: { min: ROSTER_MIN, max: ROSTER_MAX, campMin: ROSTER_MIN },
  systems: { cap: true, trades: true, freeAgency: true, draft: true, finances: true, recruiting: false, squads: false },
  schedule: (teams, year, seed, settings, trimSeed = seed) =>
    trimSchedule(
      generateProSchedule(teams, year, seed),
      teams.map((t) => t.id),
      settings.gamesPerSeason,
      trimSeed,
    ),
  postseason,
  offseasonSteps: ["review", "progress", "lottery", "draft", "contracts", "freeAgency", "camp"],
  offseasonDate: (step, year) => {
    if (step === "lottery") return iso(year + 1, 6, 18);
    if (step === "draft") return draftCalendar(year + 1).draft;
    if (step === "contracts") return iso(year + 1, 6, 29);
    if (step === "freeAgency") return iso(year + 1, 7, 1);
    if (step === "camp") return proCalendar(year + 1).camp;
    return null;
  },
  setup: (f) => f,
  enterStep,
  canAdvance,
  rosterProblem,
  fixRoster: (f) => setRoster(f, f.teamId),
  weekly,
  daily: (f) => processWaivers(f),
  beforeNewSeason,
  newSeason: (f, teams) => ({ ...f, draft: newDraftState(f.seed, f.season.year + 1), picks: rollPicks(f, teams) }),
  gates: payGates,
  closeSeason: closeSeasonBooks,
  awards: seasonAwards,
  goals: proGoals,
  development: youngCore,
  settingsOptions: { games: [82, 70, 58, 41], fields: ["playoffFormat", "tradeDifficulty"] },
};
