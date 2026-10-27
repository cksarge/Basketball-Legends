"use client";
import { useEffect, useState } from "react";
import { loadLeague, rosterFor } from "@/data/leagues";
import { useSettings } from "@/state/settings";
import { type PendingMatch, restorePending, useMatchStore } from "@/state/matchStore";
import { GameView } from "@/ui/game/GameView";

/** Fallback matchup when /game is opened directly (bookmark, reload without session). */
async function demoMatch(): Promise<PendingMatch> {
  const pro = await loadLeague("pro");
  const home = pro.teams.find((t) => t.id === "pro-phx") ?? pro.teams[0];
  const away = pro.teams.find((t) => t.id === "pro-law") ?? pro.teams[1];
  return {
    mode: "quick", league: "pro", arena: "pro",
    home: { team: home, roster: rosterFor(home), uniform: "home", controllers: ["keyboard"] },
    away: { team: away, roster: rosterFor(away), uniform: "away", controllers: [] },
    quarterMinutes: useSettings.getState().gameplay.quarterMinutes, returnTo: "/", seed: Date.now() % 100000,
  };
}

export function GamePageClient() {
  const stored = useMatchStore((s) => s.pending);
  const [pending, setPending] = useState<PendingMatch | null>(() => stored ?? restorePending());
  useEffect(() => {
    if (!pending) demoMatch().then(setPending);
  }, [pending]);
  if (!pending) {
    return (
      <div className="grid min-h-dvh place-items-center" role="status">
        <p className="font-display text-3xl font-black text-steel">Loading the arena…</p>
      </div>
    );
  }
  return <GameView pending={pending} />;
}
