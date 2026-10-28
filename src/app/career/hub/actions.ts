"use client";
// Career actions the hub runs: season setup, tryouts, simulating or playing your games, recording results.
import { useEffect, useState } from "react";
import { loadLeague } from "@/data/leagues";
import { Match } from "@/game/sim/match";
import { simulateToEnd } from "@/game/simulate";
import { uniformColors } from "@/game3d/character/uniformTexture";
import type { Career, ScheduledGame } from "@/career/types";
import {
  advanceTo,
  applyTryout,
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
import { useCareer } from "@/state/careerStore";
import { useMatchStore, type MatchResult, type PendingMatch } from "@/state/matchStore";
import { clearSuspended, loadSuspended } from "@/state/suspended";

export function useHsContext(): HsContext | null {
  const [ctx, setCtx] = useState<HsContext | null>(null);
  useEffect(() => {
    loadLeague("hs").then((d) => setCtx(hsContext(d.teams)));
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
  const s = currentSeason(c);
  const game = s?.games.find((g) => g.id === res.career!.gameId);
  useMatchStore.getState().setResult(null);
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

/** The 3D match for one of your games. */
export function careerPending(c: Career, game: ScheduledGame, ctx: HsContext, controller: string): PendingMatch {
  const setup = userMatchSetup(c, game, ctx);
  const s = currentSeason(c)!;
  const homeIsUs = game.homeId === s.schoolId;
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

/** A suspended game that belongs to this career game, if one is saved. */
export function suspendedFor(careerId: string, gameId: string) {
  const s = loadSuspended();
  return s?.pending.career?.careerId === careerId && s.pending.career.gameId === gameId ? s : null;
}

export { clearSuspended };
