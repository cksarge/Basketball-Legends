"use client";
import { fullName, playerOvr } from "@/engine/player";
import type { Player, TeamTactics } from "@/engine/types";
import { Select } from "./kit";

const AUTO = "";

/** Who guards whom, and which opponent gets doubled. */
export function MatchupPicker({
  mine,
  theirs,
  value,
  onChange,
  disabled,
}: {
  mine: Player[];
  theirs: Player[];
  value: TeamTactics;
  onChange: (t: TeamTactics) => void;
  disabled?: boolean;
}) {
  const options = [{ value: AUTO, label: "Automatic" }, ...theirs.map((p) => ({ value: p.id, label: fullName(p) }))];
  const top = [...mine].sort((a, b) => playerOvr(b) - playerOvr(a)).slice(0, 5);
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
