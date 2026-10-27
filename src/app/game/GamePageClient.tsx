"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { loadLeague, rosterFor } from "@/data/leagues";
import { useSettings } from "@/state/settings";
import { type PendingMatch, useMatchStore } from "@/state/matchStore";
import { GameView } from "@/ui/game/GameView";

/** Fallback matchup when /game is opened directly (bookmark, reload without session). */
async function demoMatch(): Promise<PendingMatch> {
  const pro = await loadLeague("pro");
  const home = pro.teams.find((t) => t.id === "pro-phx") ?? pro.teams[0];
  const away = pro.teams.find((t) => t.id === "pro-law") ?? pro.teams[1];
  return {
    mode: "quick",
    league: "pro",
    arena: "pro",
    home: { team: home, roster: rosterFor(home), uniform: "home", controllers: ["keyboard"] },
    away: { team: away, roster: rosterFor(away), uniform: "away", controllers: [] },
    quarterMinutes: useSettings.getState().gameplay.quarterMinutes,
    returnTo: "/",
    seed: Date.now() % 100000,
  };
}

export function GamePageClient() {
  const stored = useMatchStore((s) => s.pending);
  // the match set up before a reload lives in session storage; read it without a hydration mismatch
  const savedRaw = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return sessionStorage.getItem("bl-pending");
      } catch {
        return null;
      }
    },
    () => undefined,
  );
  const saved = useMemo(() => {
    try {
      return savedRaw ? (JSON.parse(savedRaw) as PendingMatch) : null;
    } catch {
      return null;
    }
  }, [savedRaw]);
  const [demo, setDemo] = useState<PendingMatch | null>(null);
  const hydrated = savedRaw !== undefined;
  const pending = stored ?? saved ?? demo;
  useEffect(() => {
    if (hydrated && !stored && !saved) demoMatch().then(setDemo);
  }, [hydrated, stored, saved]);
  if (!pending) {
    return (
      <div className="grid min-h-dvh place-items-center" role="status">
        <p className="font-display text-3xl font-black text-steel">Loading the arena…</p>
      </div>
    );
  }
  return <GameView pending={pending} />;
}
