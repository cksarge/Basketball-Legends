"use client";
import type { TeamTactics } from "@/engine/types";
import { DEFAULT_TACTICS } from "@/game/sim/match";
import { Select, Slider, Toggle } from "./kit";

export const DEFENSE_OPTIONS: { value: TeamTactics["defense"]; label: string }[] = [
  { value: "man", label: "Man-to-man" },
  { value: "zone23", label: "2-3 zone" },
  { value: "zone32", label: "3-2 zone" },
  { value: "press", label: "Full-court press" },
];

const DEFENSE_HINTS: Record<TeamTactics["defense"], string> = {
  man: "Every defender takes a man. Best all-around.",
  zone23: "Packs the paint; gives up more threes and offensive rebounds.",
  zone32: "Takes away the perimeter; drives and the short corner open up.",
  press: "Traps the ball before half court: more steals and turnovers, but leaks easy baskets.",
};

const pct = (v: number) => `${Math.round(v * 100)}%`;
const pace = (v: number) => (v < 0.34 ? "Slow" : v < 0.67 ? "Normal" : "Fast");

/** Coach settings for one team: pace, shot profile, defense, rebounding, double teams. */
export function TacticsPanel({ value, onChange, compact }: { value: Partial<TeamTactics> | undefined; onChange: (t: TeamTactics) => void; compact?: boolean }) {
  const t: TeamTactics = { ...DEFAULT_TACTICS, ...(value ?? {}) };
  const set = (patch: Partial<TeamTactics>) => onChange({ ...t, ...patch });
  return (
    <div className={compact ? "" : "flex flex-col"}>
      <Select label="Defense" hint={DEFENSE_HINTS[t.defense]} value={t.defense} options={DEFENSE_OPTIONS} onChange={(defense) => set({ defense })} />
      <Slider label="Pace" value={t.pace} min={0} max={1} step={0.05} format={pace} onChange={(v) => set({ pace: v })} />
      <Slider label="Three-point emphasis" value={t.threeRate} min={0} max={1} step={0.05} format={pct} onChange={(v) => set({ threeRate: v })} />
      <Slider label="Crash the offensive glass" value={t.crashBoards} min={0} max={1} step={0.05} format={pct} onChange={(v) => set({ crashBoards: v })} />
      <Toggle
        label="Double-team stars"
        hint="Send help at the other team's best scorer"
        checked={t.doubleTeamStars}
        onChange={(v) => set({ doubleTeamStars: v })}
      />
    </div>
  );
}
