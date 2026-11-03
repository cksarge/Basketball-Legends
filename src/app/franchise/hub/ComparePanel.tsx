"use client";
import { useMemo, useState } from "react";
import { fullName } from "@/engine/player";
import type { Team } from "@/engine/types";
import { compareRows, compareTeams, type CompareRow } from "@/franchise/history/compare";
import type { Franchise } from "@/franchise/types";
import { Panel, Segmented } from "@/ui/kit";

const NONE = "";

function Table({ label, rows }: { label: string; rows: CompareRow[] }) {
  const mark = (r: CompareRow, side: "a" | "b") => (r.better === side ? "font-semibold text-amber" : "");
  return (
    <table className="w-full text-sm tabular-nums" aria-label={label}>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-t border-line/60">
            <td className={`py-1.5 text-right ${mark(r, "a")}`}>{r.a}</td>
            <th className="px-3 py-1.5 font-normal text-steel">{r.label}</th>
            <td className={`py-1.5 text-left ${mark(r, "b")}`}>{r.b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Two players, a player and a Hall of Famer, or two teams, side by side. */
export function ComparePanel({ f, teams }: { f: Franchise; teams: Team[] }) {
  const [mode, setMode] = useState<"players" | "teams">("players");
  const [a, setA] = useState(NONE);
  const [b, setB] = useState(NONE);
  const people = useMemo(() => {
    const abbrev = (id: string | null) => teams.find((t) => t.id === id)?.abbrev ?? "FA";
    const active = Object.values(f.players)
      .filter((p) => p.teamId || f.freeAgents.includes(p.id))
      .map((p) => ({ id: p.id, label: `${fullName(p)} (${abbrev(p.teamId)})`, side: p }));
    const hall = f.hall.map((h) => ({ id: `hall:${h.id}`, label: `${h.name} (Hall of Fame)`, side: h }));
    return [...active, ...hall].sort((x, y) => x.label.localeCompare(y.label));
  }, [f, teams]);
  const pick = (id: string) => people.find((x) => x.id === id)?.side;
  const select = "w-full rounded-[var(--radius-chip)] bg-navy px-3 py-2 text-net ring-1 ring-line";
  const options = mode === "players" ? people.map((p) => ({ id: p.id, label: p.label })) : teams.map((t) => ({ id: t.id, label: t.name }));
  const choose = (label: string, value: string, onChange: (v: string) => void) => (
    <select aria-label={label} className={select} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value={NONE}>Choose…</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
  const players = mode === "players" && pick(a) && pick(b);
  return (
    <Panel title="Compare">
      <div className="mb-3">
        <Segmented
          label="Compare"
          value={mode}
          options={[
            { value: "players", label: "Players" },
            { value: "teams", label: "Teams" },
          ]}
          onChange={(m) => {
            setMode(m);
            setA(NONE);
            setB(NONE);
          }}
        />
      </div>
      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        {choose(mode === "players" ? "First player" : "First team", a, setA)}
        {choose(mode === "players" ? "Second player" : "Second team", b, setB)}
      </div>
      {players && <Table label="Player comparison" rows={compareRows(pick(a)!, pick(b)!, f)} />}
      {mode === "teams" && a && b && <Table label="Team comparison" rows={compareTeams(f, a, b, teams)} />}
    </Panel>
  );
}
