"use client";
import { fullName, playerOvr } from "@/engine/player";
import type { Player, TeamTactics } from "@/engine/types";
import { Select } from "./kit";

const AUTO = "";

/** The players who get a matchup: the planned starters, or the five best. */
export function defenderList(mine: Player[], lineup?: string[]): Player[] {
  const ranked = [...mine].sort((a, b) => playerOvr(b) - playerOvr(a));
  const starters = (lineup ?? []).map((id) => mine.find((p) => p.id === id)).filter((p): p is Player => !!p);
  return [...starters, ...ranked.filter((p) => !starters.includes(p))].slice(0, 5);
}

/** Who guards whom, and which opponent gets doubled. */
export function MatchupPicker({
  mine,
  theirs,
  value,
  onChange,
  disabled,
  lineup,
}: {
  mine: Player[];
  /** The starters to list, when the user has set them. */
  lineup?: string[];
  theirs: Player[];
  value: TeamTactics;
  onChange: (t: TeamTactics) => void;
  disabled?: boolean;
}) {
  const options = [{ value: AUTO, label: "Automatic" }, ...theirs.map((p) => ({ value: p.id, label: fullName(p) }))];
  const top = defenderList(mine, lineup);
  const setMatchup = (id: string, mark: string) => {
    // a player can only have one defender assigned
    const rest = Object.entries(value.matchups ?? {}).filter(([who, them]) => who !== id && them !== mark);
    onChange({ ...value, matchups: Object.fromEntries(mark ? [...rest, [id, mark]] : rest) });
  };
  return (
    <fieldset disabled={disabled}>
      {top.map((p) => (
        <Select key={p.id} label={`${fullName(p)} guards`} value={value.matchups?.[p.id] ?? AUTO} options={options} onChange={(v) => setMatchup(p.id, v)} />
      ))}
      <Select
        label="Double-team"
        hint="Sends the nearest helper at this player whenever he has the ball"
        value={value.doubleTarget ?? AUTO}
        options={options.map((o) => (o.value === AUTO ? { ...o, label: "Nobody" } : o))}
        onChange={(v) => onChange({ ...value, doubleTarget: v || undefined })}
      />
    </fieldset>
  );
}
