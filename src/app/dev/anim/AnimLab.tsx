"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { Player, Team } from "@/engine/types";
import { loadLeague, rosterFor } from "@/data/leagues";

const PoseLab = dynamic(() => import("@/game3d/dev/PoseLab"), { ssr: false });

/** Developer-only page for reviewing every animation pose. */
export function AnimLab() {
  const [pick, setPick] = useState<{ player: Player; team: Team } | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    loadLeague("pro").then((d) => {
      const team = d.teams.find((t) => t.id === "pro-phx") ?? d.teams[0];
      const roster = rosterFor(team);
      const idx = Number(new URLSearchParams(location.search).get("p") ?? 0);
      setPick({ player: roster[idx % roster.length], team });
    });
  }, []);
  if (process.env.NODE_ENV === "production") return <main className="grid min-h-dvh place-items-center text-steel">Developer tools are only available in development builds.</main>;
  if (!pick) return <main className="grid min-h-dvh place-items-center text-steel">Loading…</main>;
  return <PoseLab player={pick.player} team={pick.team} />;
}
