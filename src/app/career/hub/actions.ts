"use client";
// Career actions the hub runs: season setup, tryouts, simulating or playing your games, recording results.
import { useEffect, useState } from "react";
import { loadLeague } from "@/data/leagues";
import { Match } from "@/game/sim/match";
import { simulateToEnd } from "@/game/simulate";
import { uniformColors } from "@/game3d/character/uniformTexture";
import type { AgentId, Career, ScheduledGame } from "@/career/types";
import {
  advanceTo,
  applyShowcaseGame,
  goToCamp,
  graduate,
  prepareShowcase,
  showcaseSetup,
  startNextYear,
  takeFinals,
  applyTryout,
  recruitStep,
  applyUserGame,
  currentSeason,
  finishSeason,
  hsContext,
  nextEvent,
  placeAtTryout,
  startSeason,
  userMatchSetup,
  type HsContext,
} from "@/career/hs/season";
import { outcomeFromMatch } from "@/career/hs/play";
import {
  advanceCollege,
  applyCollegeGame,
  collegeMatchSetup,
  currentCollege,
  declareForDraft,
  declineNil,
  enterCollege,
  enterPortal,
  finishCollegeSeason,
  nextCollegeEvent,
  returnToSchool,
  setRedshirt,
  signNil,
  startNextCollegeYear,
  transferTo,
  undeclare,
  userCollegeGames,
  withdrawFromPortal,
} from "@/career/college/season";
import { chooseCollege, commit, decommit, officialVisit, reclassify, toggleFavorite, type VisitFocus } from "@/career/recruiting";
import { answerInterview, chooseAgent, enterPreDraft, finishDraft, joinDevLeague, runCombine, runDraft, signTwoWay, workOut } from "@/career/pro/draft";
import {
  advancePro,
  applyProGame,
  currentPro,
  finishProSeason,
  negotiate,
  nextProEvent,
  proMatchSetup,
  requestTrade,
  signContract,
  signEndorsement,
  trainingCamp,
  userProGames,
} from "@/career/pro/season";
import { useCareer } from "@/state/careerStore";
import { useMatchStore, type MatchResult, type PendingMatch } from "@/state/matchStore";
import { clearSuspended, findCareerSave, pruneCareerSaves } from "@/state/suspended";

/** The controller for your player: the first connected gamepad unless you're on the keyboard. */
export function primaryDevice(device: string): string {
  if (device === "keyboard" || typeof navigator === "undefined") return "keyboard";
  const pad = [...(navigator.getGamepads?.() ?? [])].find((p): p is Gamepad => !!p && p.connected);
  return pad ? `pad${pad.index}` : "keyboard";
}

export function useHsContext(): HsContext | null {
  const [ctx, setCtx] = useState<HsContext | null>(null);
  useEffect(() => {
    Promise.all([loadLeague("hs"), loadLeague("college"), loadLeague("pro")]).then(([h, col, pro]) =>
      setCtx(hsContext(h.teams, col.teams, col.conferences, pro.teams)),
    );
  }, []);
  return ctx;
}

const cur = () => useCareer.getState().career!;
const update = (fn: (c: Career) => Career) => useCareer.getState().update(fn);

/** Starts the school year if the career is waiting on one (new careers and every August). */
export async function ensureSeason(ctx: HsContext) {
  const c = cur();
  const ev = nextEvent(c);
  if (ev.kind === "season" && c.stage === "hs") await update((x) => startSeason(x, Number(ev.date.slice(0, 4)), ctx));
}

/** Records a 3D game you just finished (or simmed from the pause menu) if it belongs to this career. */
export async function applyFinishedMatch(ctx: HsContext) {
  const res: MatchResult | null = useMatchStore.getState().lastResult;
  const c = cur();
  if (!res?.career || res.career.careerId !== c.id) return false;
  if (c.stage === "pro") {
    const s = currentPro(c);
    const id = res.career.gameId;
    const game = [...(s?.games ?? []), ...(s?.devGames ?? [])].find((g) => g.id === id);
    useMatchStore.getState().setResult(null);
    if (!game || game.result) return false;
    const outcome = {
      homeScore: res.homeScore,
      awayScore: res.awayScore,
      overtimes: Math.max(0, res.periods - 4),
      box: res.box,
      played: !res.simulated,
      playerOfGame: res.playerOfGame,
      injuries: res.injuries,
    };
    await update((x) => advancePro(applyProGame(x, game.id, outcome, ctx), game.date, ctx));
    return true;
  }
  if (c.stage === "college") {
    const game = currentCollege(c)?.games.find((g) => g.id === res.career!.gameId);
    useMatchStore.getState().setResult(null);
    if (!game || game.result) return false;
    const outcome = {
      homeScore: res.homeScore,
      awayScore: res.awayScore,
      overtimes: Math.max(0, res.periods - 2),
      box: res.box,
      played: !res.simulated,
      playerOfGame: res.playerOfGame,
    };
    await update((x) => advanceCollege(applyCollegeGame(x, game.id, outcome, ctx), game.date, ctx));
    return true;
  }
  const s = currentSeason(c);
  useMatchStore.getState().setResult(null);
  // a summer showcase game
  const show = s?.summer?.showcase?.find((g) => g.id === res.career!.gameId);
  if (show) {
    if (show.result) return false;
    await update((x) =>
      recruitStep(
        applyShowcaseGame(x, show.id, {
          homeScore: res.homeScore,
          awayScore: res.awayScore,
          overtimes: Math.max(0, res.periods - 4),
          box: res.box,
          played: !res.simulated,
          playerOfGame: res.playerOfGame,
        }),
        ctx,
        show.date,
      ),
    );
    return true;
  }
  const game = s?.games.find((g) => g.id === res.career!.gameId);
  if (!game || game.result) return false;
  const regulation = res.periods > 4 ? 4 : res.periods;
  await update((x) =>
    advanceTo(
      applyUserGame(
        x,
        game.id,
        {
          homeScore: res.homeScore,
          awayScore: res.awayScore,
          overtimes: Math.max(0, res.periods - regulation),
          box: res.box,
          played: !res.simulated,
          playerOfGame: res.playerOfGame,
        },
        ctx,
      ),
      game.date,
      ctx,
    ),
  );
  return true;
}

export async function runTryout(ctx: HsContext, drillBonus: number) {
  const ev = nextEvent(cur());
  if (ev.kind !== "tryout") return null;
  await update((x) => advanceTo(x, ev.date, ctx));
  const t = placeAtTryout(cur(), ctx, drillBonus);
  await update((x) => applyTryout(x, t));
  return t;
}

export interface SimProgress {
  index: number;
  total: number;
  label: string;
  fraction: number;
}

/**
 * Simulates your next games (`count`, or every remaining one with Infinity), each through the real game engine
 * so your box score is authentic. Reports progress and stops if `cancelled()` turns true.
 */
export async function simUserGames(ctx: HsContext, count: number, onProgress: (p: SimProgress | null) => void, cancelled: () => boolean = () => false) {
  const planned = (() => {
    const s = currentSeason(cur());
    const left = s ? s.games.filter((g) => g.level === s.level && (g.homeId === s.schoolId || g.awayId === s.schoolId) && !g.result).length : 0;
    return Math.min(count, Math.max(1, left));
  })();
  for (let i = 0; i < count; i++) {
    if (cancelled()) break;
    const ev = nextEvent(cur());
    if (ev.kind !== "game") break;
    await update((x) => advanceTo(x, ev.date, ctx));
    const game = currentSeason(cur())!.games.find((g) => g.id === ev.game.id)!;
    const setup = userMatchSetup(cur(), game, ctx);
    const opp = ctx.byId.get(game.homeId === currentSeason(cur())!.schoolId ? game.awayId : game.homeId);
    const label = `${game.label ?? ""}${game.label ? " · " : ""}vs ${opp?.name ?? "opponent"}`;
    onProgress({ index: i + 1, total: planned, label, fraction: 0 });
    const match = new Match({ ...setup, fast: true });
    await simulateToEnd(match, (f) => onProgress({ index: i + 1, total: planned, label, fraction: f }));
    const outcome = outcomeFromMatch(match, false);
    await update((x) => advanceTo(applyUserGame(x, game.id, outcome, ctx), game.date, ctx));
  }
  onProgress(null);
}

/** Simulates the rest of the league through the end of the season, then wraps it up and starts the next school year. */
export async function finishCurrentSeason(ctx: HsContext) {
  const ev = nextEvent(cur());
  if (ev.kind !== "seasonEnd") return;
  await update((x) => advanceTo(x, ev.date, ctx));
  if (nextEvent(cur()).kind === "game") return; // a playoff game of yours turned up
  await update((x) => finishSeason(x, ctx));
}

export async function finalsAction(semester: "fall" | "spring", exam: number, ctx: HsContext) {
  const ev = nextEvent(cur());
  if (ev.kind !== "finals") return;
  await update((x) => {
    const y = takeFinals(advanceTo(x, ev.date, ctx), semester, exam);
    return recruitStep(y, ctx, y.date);
  });
}

export const campAction = (campId: string, ctx: HsContext) => update((x) => recruitStep(goToCamp(x, campId), ctx, x.date));
export const showcaseAction = () => update((x) => prepareShowcase(x));
export const nextYearAction = (ctx: HsContext) => update((x) => startNextYear(x, ctx));
export const graduateAction = (ctx: HsContext) => update((x) => graduate(x, ctx));

// recruiting
export const commitAction = (teamId: string, ctx: HsContext) => update((x) => commit(x, teamId, ctx.colleges ?? [], x.date));
export const decommitAction = (ctx: HsContext) => update((x) => decommit(x, ctx.colleges ?? [], x.date));
export const favoriteAction = (teamId: string) => update((x) => toggleFavorite(x, teamId));
export const reclassifyAction = () => update((x) => reclassify(x, x.date));
export const chooseCollegeAction = (teamId: string, ctx: HsContext) => update((x) => chooseCollege(x, teamId, ctx.colleges ?? [], x.date));
/** Takes an official visit and returns how it went. */
export async function visitAction(teamId: string, focus: VisitFocus, ctx: HsContext) {
  const { career, story } = officialVisit(cur(), teamId, focus, ctx.colleges ?? [], cur().date);
  await update(() => career);
  return story;
}

/** Simulates the remaining showcase games through the real engine. */
export async function simShowcase(ctx: HsContext, onProgress: (p: SimProgress | null) => void) {
  for (let i = 0; i < 5; i++) {
    const ev = nextEvent(cur());
    if (ev.kind !== "showcase" || !ev.game) break;
    const game = ev.game;
    const setup = showcaseSetup(cur(), game);
    const label = game.label ?? "Showcase";
    onProgress({ index: i + 1, total: 3, label, fraction: 0 });
    const match = new Match({ ...setup, fast: true });
    await simulateToEnd(match, (f) => onProgress({ index: i + 1, total: 3, label, fraction: f }));
    await update((x) => recruitStep(applyShowcaseGame(x, game.id, outcomeFromMatch(match, false)), ctx, game.date));
  }
  onProgress(null);
}

/** Simulates your next college games through the real game engine. */
export async function simCollegeGames(ctx: HsContext, count: number, onProgress: (p: SimProgress | null) => void, cancelled: () => boolean = () => false) {
  const left = userCollegeGames(currentCollege(cur())!).filter((g) => !g.result).length;
  const planned = Math.min(count, Math.max(1, left));
  for (let i = 0; i < count; i++) {
    if (cancelled()) break;
    const ev = nextCollegeEvent(cur());
    if (ev.kind !== "game") break;
    await update((x) => advanceCollege(x, ev.date, ctx));
    const s = currentCollege(cur())!;
    const game = s.games.find((g) => g.id === ev.game.id)!;
    const opp = ctx.collegeById?.get(game.homeId === s.teamId ? game.awayId : game.homeId);
    const label = `${game.label ?? ""}${game.label ? " · " : ""}vs ${opp?.name ?? "opponent"}`;
    onProgress({ index: i + 1, total: planned, label, fraction: 0 });
    const match = new Match({ ...collegeMatchSetup(cur(), game, ctx), fast: true });
    await simulateToEnd(match, (f) => onProgress({ index: i + 1, total: planned, label, fraction: f }));
    const outcome = outcomeFromMatch(match, false);
    await update((x) => advanceCollege(applyCollegeGame(x, game.id, outcome, ctx), game.date, ctx));
  }
  onProgress(null);
}

/** Simulates the rest of the division through the end of the season and wraps it up. */
export async function finishCollegeYear(ctx: HsContext) {
  const ev = nextCollegeEvent(cur());
  if (ev.kind !== "seasonEnd") return;
  await update((x) => advanceCollege(x, ev.date, ctx));
  if (nextCollegeEvent(cur()).kind === "game") return; // a postseason game of yours turned up
  await update((x) => finishCollegeSeason(x, ctx));
}

export const enterCollegeAction = (ctx: HsContext) => update((x) => enterCollege(x, ctx));
export const returnAction = () => update((x) => returnToSchool(x));
export const portalAction = (ctx: HsContext) => update((x) => enterPortal(x, ctx));
export const transferAction = (teamId: string, ctx: HsContext) => update((x) => transferTo(x, teamId, ctx));
export const withdrawAction = () => update((x) => withdrawFromPortal(x));
export const declareAction = () => update((x) => declareForDraft(x));
export const undeclareAction = () => update((x) => undeclare(x));
export const nextCollegeYearAction = (ctx: HsContext) => update((x) => startNextCollegeYear(x, ctx));
export const redshirtAction = (on: boolean) => update((x) => setRedshirt(x, on));
export const signNilAction = (id: string) => update((x) => signNil(x, id));
export const declineNilAction = (id: string) => update((x) => declineNil(x, id));

/** Simulates your next pro games through the real game engine. */
export async function simProGames(ctx: HsContext, count: number, onProgress: (p: SimProgress | null) => void, cancelled: () => boolean = () => false) {
  const planned = Math.min(count, Math.max(1, userProGames(currentPro(cur())!).filter((g) => !g.result).length));
  for (let i = 0; i < count; i++) {
    if (cancelled()) break;
    const ev = nextProEvent(cur());
    if (ev.kind !== "game") break;
    await update((x) => advancePro(x, ev.date, ctx));
    // All-Star weekend can land in front of the game you were heading to
    const now = nextProEvent(cur());
    if (now.kind !== "game") continue;
    const game = now.game;
    const s = currentPro(cur())!;
    const opp = ctx.proById?.get(game.homeId === s.teamId ? game.awayId : game.homeId);
    const label = `${game.label ?? ""}${game.label ? " · " : ""}vs ${opp?.name ?? "the other conference"}`;
    onProgress({ index: i + 1, total: planned, label, fraction: 0 });
    const match = new Match({ ...proMatchSetup(cur(), game, ctx), fast: true });
    await simulateToEnd(match, (f) => onProgress({ index: i + 1, total: planned, label, fraction: f }));
    const outcome = outcomeFromMatch(match, false);
    await update((x) => advancePro(applyProGame(x, game.id, outcome, ctx), game.date, ctx));
  }
  onProgress(null);
}

/** Moves past the games you're missing. */
export const sitOutAction = (ctx: HsContext) =>
  update((x) => {
    const ev = nextProEvent(x);
    return ev.kind === "injured" ? advancePro(x, ev.date, ctx) : x;
  });

/** Plays out the rest of the league to the end of the year and wraps it up. */
export async function finishProYear(ctx: HsContext) {
  const ev = nextProEvent(cur());
  if (ev.kind !== "seasonEnd") return;
  await update((x) => advancePro(x, ev.date, ctx));
  if (nextProEvent(cur()).kind !== "seasonEnd") return; // a playoff game of yours turned up
  await update((x) => finishProSeason(x, ctx));
}

export const campAndStartAction = (focus: string, ctx: HsContext) => update((x) => trainingCamp(x, focus, ctx));
export const signContractAction = (teamId: string, ctx: HsContext) => update((x) => signContract(x, teamId, ctx));
export const tradeRequestAction = () => update((x) => requestTrade(x));
export const signBrandAction = (brand: string) => update((x) => signEndorsement(x, brand));
/** Asks for more money and says how it went. */
export async function negotiateAction(teamId: string, raise: number) {
  const { career, accepted } = negotiate(cur(), teamId, raise);
  await update(() => career);
  return accepted;
}

/** The 3D match for one of your pro games. */
function proPending(c: Career, game: ScheduledGame, ctx: HsContext, controller: string): PendingMatch {
  const setup = proMatchSetup(c, game, ctx);
  const { home, away } = setup;
  const homeIsUs = home.roster.some((p) => p.id === c.player.id);
  const awayUniform = uniformColors(home.team, "home").base.toLowerCase() === uniformColors(away.team, "away").base.toLowerCase() ? "alt" : "away";
  return {
    mode: "career",
    league: "pro",
    arena: "pro",
    home: {
      team: home.team,
      roster: home.roster,
      starters: home.starters,
      rotation: home.rotation,
      uniform: "home",
      controllers: homeIsUs ? [controller] : [],
    },
    away: {
      team: away.team,
      roster: away.roster,
      starters: away.starters,
      rotation: away.rotation,
      uniform: awayUniform,
      controllers: homeIsUs ? [] : [controller],
    },
    quarterMinutes: c.settings.quarterMinutes,
    lockPlayerId: c.player.id,
    returnTo: `/career/hub/?id=${encodeURIComponent(c.id)}`,
    seed: setup.seed ?? 1,
    occasion: game.label,
    career: { careerId: c.id, gameId: game.id },
    difficulty: c.settings.difficulty,
    bench: c.settings.bench,
    resume: false,
  };
}

const pros = (ctx: HsContext) => ctx.pros ?? [];
export const preDraftAction = () => update((x) => enterPreDraft(x));
export const agentAction = (id: AgentId) => update((x) => chooseAgent(x, id));
export const combineAction = (scores: number[], bonus: number) => update((x) => runCombine(x, scores, bonus));
export const workoutAction = (teamId: string, ctx: HsContext) => update((x) => workOut(x, teamId, pros(ctx)));
export const interviewAction = (answer: number) => update((x) => answerInterview(x, answer));
export const draftAction = (ctx: HsContext) => update((x) => runDraft(x, pros(ctx)));
export const finishDraftAction = (ctx: HsContext) => update((x) => finishDraft(x, pros(ctx)));
export const twoWayAction = (teamId: string, ctx: HsContext) => update((x) => signTwoWay(x, teamId, pros(ctx)));
export const devLeagueAction = (teamId: string, ctx: HsContext) => update((x) => joinDevLeague(x, teamId, pros(ctx)));

/** The 3D match for one of your college games: two halves, each as long as two of your career's quarters. */
function collegePending(c: Career, game: ScheduledGame, ctx: HsContext, controller: string): PendingMatch {
  const setup = collegeMatchSetup(c, game, ctx);
  const homeIsUs = game.homeId === currentCollege(c)!.teamId;
  const { home, away } = setup;
  const awayUniform = uniformColors(home.team, "home").base.toLowerCase() === uniformColors(away.team, "away").base.toLowerCase() ? "alt" : "away";
  return {
    mode: "career",
    league: "college",
    arena: "college",
    home: {
      team: home.team,
      roster: home.roster,
      starters: home.starters,
      rotation: home.rotation,
      uniform: "home",
      controllers: homeIsUs ? [controller] : [],
    },
    away: {
      team: away.team,
      roster: away.roster,
      starters: away.starters,
      rotation: away.rotation,
      uniform: awayUniform,
      controllers: homeIsUs ? [] : [controller],
    },
    quarterMinutes: c.settings.quarterMinutes * 2,
    lockPlayerId: c.player.id,
    returnTo: `/career/hub/?id=${encodeURIComponent(c.id)}`,
    seed: setup.seed ?? 1,
    occasion: game.label ?? (game.kind === "region" ? "Conference game" : undefined),
    career: { careerId: c.id, gameId: game.id },
    difficulty: c.settings.difficulty,
    bench: c.settings.bench,
    resume: false,
  };
}

/** The 3D match for one of your games (season or summer showcase). */
export function careerPending(c: Career, game: ScheduledGame, ctx: HsContext, controller: string): PendingMatch {
  if (c.stage === "pro") return proPending(c, game, ctx, controller);
  if (c.stage === "college") return collegePending(c, game, ctx, controller);
  const isShowcase = game.id.startsWith("aau-");
  const setup = isShowcase ? { ...showcaseSetup(c, game), level: "varsity" as const } : userMatchSetup(c, game, ctx);
  const s = currentSeason(c)!;
  const homeIsUs = isShowcase ? setup.home.roster.some((p) => p.id === c.player.id) : game.homeId === s.schoolId;
  const home = setup.home,
    away = setup.away;
  let awayUniform: "away" | "alt" = "away";
  if (uniformColors(home.team, "home").base.toLowerCase() === uniformColors(away.team, "away").base.toLowerCase()) awayUniform = "alt";
  return {
    mode: "career",
    league: "hs",
    arena: "gym",
    home: { team: home.team, roster: home.roster, starters: home.starters, uniform: "home", controllers: homeIsUs ? [controller] : [] },
    away: { team: away.team, roster: away.roster, starters: away.starters, uniform: awayUniform, controllers: homeIsUs ? [] : [controller] },
    quarterMinutes: c.settings.quarterMinutes,
    lockPlayerId: c.player.id,
    returnTo: `/career/hub/?id=${encodeURIComponent(c.id)}`,
    seed: setup.seed ?? 1,
    occasion: game.label ?? (game.kind === "region" ? "Region game" : undefined),
    career: { careerId: c.id, gameId: game.id },
    difficulty: c.settings.difficulty,
    bench: c.settings.bench,
    resume: false,
  };
}

/** A saved game that belongs to this career game (the autosave or any Career slot), ready to resume. */
export const suspendedFor = findCareerSave;

/** Clears saves of games that have since been simmed or have passed: only the current season's open games can resume. */
export function pruneFinishedSaves(c: Career) {
  const s = currentSeason(c);
  const pro = currentPro(c);
  const games =
    c.stage === "pro"
      ? [...(pro?.games ?? []), ...(pro?.devGames ?? [])]
      : c.stage === "college"
        ? (currentCollege(c)?.games ?? [])
        : [...(s?.games ?? []), ...(s?.summer?.showcase ?? [])];
  const open = games.filter((g) => !g.result).map((g) => g.id);
  pruneCareerSaves(c.id, (gameId) => open.includes(gameId));
}

export { clearSuspended };
