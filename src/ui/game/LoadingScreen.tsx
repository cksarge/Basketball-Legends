"use client";
import { useProgress } from "@react-three/drei";
import { useEffect, useState } from "react";
import type { Team } from "@/engine/types";
import { useSettings, type ActionName } from "@/state/settings";
import { keyLabel } from "../KeyHint";
import { TeamLogo } from "../TeamLogo";
import { formatTip, TIPS } from "./tips";

/** Covers the scene while the arena and players load: matchup, real progress and rotating tips. */
export function LoadingScreen({ home, away, ready, place }: { home: Team; away: Team; ready: boolean; place?: { name: string; where: string } }) {
  const { progress, active } = useProgress();
  const showTips = useSettings((s) => s.presentation.showTips);
  const keys = useSettings((s) => s.controls.keys);
  const [tip, setTip] = useState(() => Math.floor(Math.random() * TIPS.length));
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const h = setInterval(() => setTip((t) => (t + 1) % TIPS.length), 5000);
    return () => clearInterval(h);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const h = setTimeout(() => setGone(true), 450); // let the fade finish
    return () => clearTimeout(h);
  }, [ready]);
  if (gone) return null;
  const pct = ready ? 100 : active ? Math.min(99, Math.round(progress)) : Math.max(5, Math.round(progress));
  const label = (a: string) => keyLabel(keys[a as ActionName]?.[0] ?? "");
  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-10 bg-navy transition-opacity duration-400 ${ready ? "opacity-0" : "opacity-100"}`}
      role="status"
      aria-live="polite"
    >
      {place ? (
        <div className="text-center">
          <p className="font-display text-5xl font-black">{place.name}</p>
          <p className="text-lg text-steel">{place.where}</p>
        </div>
      ) : (
        <div className="flex items-center gap-10">
          <div className="flex flex-col items-center gap-2">
            <TeamLogo team={away} size={110} />
            <span className="font-display text-2xl font-bold">{away.name}</span>
          </div>
          <span className="font-display text-4xl font-black text-steel">at</span>
          <div className="flex flex-col items-center gap-2">
            <TeamLogo team={home} size={110} />
            <span className="font-display text-2xl font-bold">{home.name}</span>
          </div>
        </div>
      )}
      <div className="w-[min(520px,85vw)]">
        <div className="mb-2 flex justify-between text-sm text-steel">
          <span>{ready ? "Ready" : place ? "Heading to the park" : "Loading the arena"}</span>
          <span className="tabular-nums">{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-deck">
          <div className="h-full bg-amber transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {showTips && (
        <p key={tip} className="max-w-xl px-6 text-center text-lg text-net">
          <span className="mr-2 font-display font-bold text-amber">TIP</span>
          {formatTip(TIPS[tip], label)}
        </p>
      )}
    </div>
  );
}
