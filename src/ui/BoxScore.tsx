"use client";
import { useState } from "react";
import type { Player, Team } from "@/engine/types";
import { type BoxScore, type StatLine, fmtMin, fmtPct, reb, teamTotals } from "@/game/sim/stats";
import { TeamLogo } from "./TeamLogo";

const COLS: { key: string; label: string; title: string; get: (s: StatLine) => string | number }[] = [
  { key: "min", label: "MIN", title: "Minutes", get: (s) => fmtMin(s.min) },
  { key: "pts", label: "PTS", title: "Points", get: (s) => s.pts },
  { key: "reb", label: "REB", title: "Rebounds", get: (s) => reb(s) },
  { key: "ast", label: "AST", title: "Assists", get: (s) => s.ast },
  { key: "stl", label: "STL", title: "Steals", get: (s) => s.stl },
  { key: "blk", label: "BLK", title: "Blocks", get: (s) => s.blk },
  { key: "fg", label: "FG", title: "Field goals", get: (s) => `${s.fgm}-${s.fga}` },
  { key: "3p", label: "3P", title: "Three-pointers", get: (s) => `${s.tpm}-${s.tpa}` },
  { key: "ft", label: "FT", title: "Free throws", get: (s) => `${s.ftm}-${s.fta}` },
  { key: "tov", label: "TO", title: "Turnovers", get: (s) => s.tov },
  { key: "pf", label: "PF", title: "Personal fouls", get: (s) => s.pf },
  { key: "pm", label: "+/-", title: "Plus/minus", get: (s) => (s.plusMinus > 0 ? `+${s.plusMinus}` : s.plusMinus) },
];

export function BoxScoreTable({ teams, box, onCourt }: { teams: { team: Team; roster: Player[] }[]; box: BoxScore; onCourt?: string[] }) {
  const [tab, setTab] = useState(0);
  const t = teams[tab];
  const rows = [...t.roster]
    .filter((p) => box[p.id])
    .sort((a, b) => (box[b.id].min > 0 ? 1 : 0) - (box[a.id].min > 0 ? 1 : 0) || box[b.id].pts - box[a.id].pts);
  const tot = teamTotals(
    box,
    t.roster.map((p) => p.id),
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2" role="tablist" aria-label="Team">
        {teams.map((x, i) => (
          <button
            key={x.team.id}
            role="tab"
            aria-selected={tab === i}
            onClick={() => setTab(i)}
            className={`flex items-center gap-2 rounded-[var(--radius-chip)] px-3 py-2 font-display text-lg font-bold ${tab === i ? "bg-deck-2 text-net ring-1 ring-amber" : "bg-deck text-steel hover:text-net"}`}
          >
            <TeamLogo team={x.team} size={24} /> {x.team.name}
          </button>
        ))}
      </div>
      <div className="scrollbar-thin overflow-x-auto rounded-[var(--radius-chip)] ring-1 ring-line">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-deck text-steel">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Player</th>
              {COLS.map((c) => (
                <th key={c.key} title={c.title} className="px-2 py-2 text-right font-semibold">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const s = box[p.id];
              const dnp = s.min === 0;
              return (
                <tr key={p.id} className="border-t border-line/60 odd:bg-navy even:bg-deck/40">
                  <td className="px-3 py-1.5">
                    <span className="mr-2 inline-block w-6 text-right text-steel">{p.jersey}</span>
                    <span className={onCourt?.includes(p.id) ? "text-amber" : ""}>
                      {p.firstName[0]}. {p.lastName}
                    </span>
                    <span className="ml-2 text-xs text-steel">{p.pos}</span>
                  </td>
                  {dnp ? (
                    <td colSpan={COLS.length} className="px-2 text-right text-steel">
                      Did not play
                    </td>
                  ) : (
                    COLS.map((c) => (
                      <td key={c.key} className="px-2 py-1.5 text-right tabular-nums">
                        {c.get(s)}
                      </td>
                    ))
                  )}
                </tr>
              );
            })}
            <tr className="border-t-2 border-line bg-deck font-semibold">
              <td className="px-3 py-2">Team</td>
              {COLS.map((c) => (
                <td key={c.key} className="px-2 py-2 text-right tabular-nums">
                  {c.key === "min" || c.key === "pm" ? "" : c.get(tot)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-steel">
        FG {fmtPct(tot.fgm, tot.fga)} · 3P {fmtPct(tot.tpm, tot.tpa)} · FT {fmtPct(tot.ftm, tot.fta)}
      </p>
    </div>
  );
}
