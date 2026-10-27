"use client";
import { useEffect, useRef, useState } from "react";
import type { Match } from "@/game/sim/match";
import type { TeamIdx } from "@/game/sim/state";
import { fmtPct, reb, teamTotals } from "@/game/sim/stats";
import { ordinal } from "@/game/commentary";
import { TeamLogo } from "../TeamLogo";

export type BreakKind = "periodEnd" | "halftime" | "timeout";

/**
 * Side panel shown at quarter breaks, halftime and timeouts: line score, team stat
 * comparison, leaders, and quick access to substitutions and highlights.
 */
export function BreakScreen({ match, kind, humanTeam, autoContinue, highlightCount, onContinue, onSubs, onHighlights }: {
  match: Match; kind: BreakKind; humanTeam: TeamIdx | null; autoContinue: boolean; highlightCount: number;
  onContinue: () => void; onSubs: () => void; onHighlights: () => void;
}) {
  const s = match.state;
  const per = s.cfg.rules.periods;
  const cont = useRef<HTMLButtonElement>(null);
  const [left, setLeft] = useState(autoContinue ? 10 : 0);
  useEffect(() => { cont.current?.focus(); }, []);
  useEffect(() => {
    if (!autoContinue) return;
    const h = setInterval(() => setLeft((x) => {
      if (x <= 1) { clearInterval(h); onContinue(); return 0; }
      return x - 1;
    }), 1000);
    return () => clearInterval(h);
  }, [autoContinue, onContinue]);

  const title = kind === "timeout"
    ? `Timeout, ${s.timeoutTeam !== null ? s.teams[s.timeoutTeam].team.name : ""}`
    : kind === "halftime" ? "Halftime"
    : s.period > per ? `End of overtime` : `End of the ${ordinal(s.period)}`;
  const order: TeamIdx[] = [1, 0]; // away first, like the score bug
  const totals = order.map((ti) => teamTotals(s.box, s.teams[ti].roster.map((p) => p.id)));
  const periods = Math.max(s.teams[0].periodScores.length, s.period);
  const lineFor = (ti: TeamIdx) => {
    const done = s.teams[ti].periodScores;
    const cur = s.teams[ti].score - done.reduce((a, b) => a + b, 0);
    return Array.from({ length: periods }, (_, i) => (i < done.length ? done[i] : i === done.length ? cur : 0));
  };
  const leader = (ti: TeamIdx, key: "pts" | "reb" | "ast") => {
    let best: { name: string; v: number } | null = null;
    for (const p of s.teams[ti].roster) {
      const b = s.box[p.id];
      if (!b) continue;
      const v = key === "reb" ? reb(b) : b[key];
      if (!best || v > best.v) best = { name: `${p.firstName[0]}. ${p.lastName}`, v };
    }
    return best;
  };
  const rows: [string, (i: number) => string, (i: number) => number][] = [
    ["Field goals", (i) => `${totals[i].fgm}/${totals[i].fga} · ${fmtPct(totals[i].fgm, totals[i].fga)}`, (i) => totals[i].fga ? totals[i].fgm / totals[i].fga : 0],
    ["Threes", (i) => `${totals[i].tpm}/${totals[i].tpa} · ${fmtPct(totals[i].tpm, totals[i].tpa)}`, (i) => totals[i].tpa ? totals[i].tpm / totals[i].tpa : 0],
    ["Free throws", (i) => `${totals[i].ftm}/${totals[i].fta}`, (i) => totals[i].fta ? totals[i].ftm / totals[i].fta : 0],
    ["Rebounds", (i) => String(reb(totals[i])), (i) => reb(totals[i])],
    ["Assists", (i) => String(totals[i].ast), (i) => totals[i].ast],
    ["Turnovers", (i) => String(totals[i].tov), (i) => -totals[i].tov],
    ["Steals", (i) => String(totals[i].stl), (i) => totals[i].stl],
  ];
  const injuries = s.injuries;
  const btn = "rounded-[var(--radius-chip)] px-4 py-2.5 text-left font-display text-xl font-bold hover:bg-deck-2 focus-visible:bg-deck-2";
  return (
    <aside className="scrollbar-thin fixed inset-y-0 right-0 z-40 flex w-[min(460px,100vw)] flex-col gap-5 overflow-y-auto border-l border-line bg-navy/92 p-6 backdrop-blur" data-nav-scope="modal" role="dialog" aria-label={title}>
      <div>
        <p className="font-display text-sm font-bold uppercase tracking-widest text-amber">{kind === "timeout" ? `${ordinal(Math.min(s.period, per))} · ${Math.floor(s.clock / 60)}:${String(Math.floor(s.clock % 60)).padStart(2, "0")}` : "Break"}</p>
        <h2 className="font-display text-4xl font-black">{title}</h2>
      </div>
      {/* line score */}
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="text-steel">
            <th className="py-1 text-left font-normal">Team</th>
            {Array.from({ length: periods }, (_, i) => <th key={i} className="w-9 font-normal">{i < per ? i + 1 : `OT${i - per + 1 > 1 ? i - per + 1 : ""}`}</th>)}
            <th className="w-10 font-semibold text-net">T</th>
          </tr>
        </thead>
        <tbody>
          {order.map((ti) => (
            <tr key={ti} className="border-t border-line/60">
              <td className="py-1.5"><span className="flex items-center gap-2"><TeamLogo team={s.teams[ti].team} size={22} />{s.teams[ti].team.abbrev}</span></td>
              {lineFor(ti).map((v, i) => <td key={i} className="text-center">{v}</td>)}
              <td className="text-center font-display text-lg font-black text-amber">{s.teams[ti].score}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* team comparison */}
      <div className="flex flex-col gap-2">
        {rows.map(([label, text, val]) => {
          const a = val(0), b = val(1);
          const better = a === b ? -1 : a > b ? 0 : 1;
          return (
            <div key={label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-sm">
              <span className={`tabular-nums ${better === 0 ? "font-semibold text-net" : "text-steel"}`}>{text(0)}</span>
              <span className="text-xs uppercase tracking-wider text-steel">{label}</span>
              <span className={`text-right tabular-nums ${better === 1 ? "font-semibold text-net" : "text-steel"}`}>{text(1)}</span>
            </div>
          );
        })}
      </div>
      {/* leaders */}
      <div className="grid grid-cols-2 gap-3">
        {order.map((ti) => (
          <div key={ti} className="rounded-[var(--radius-chip)] bg-deck p-3 ring-1 ring-line" style={{ borderTop: `3px solid ${s.teams[ti].team.colors.primary}` }}>
            <p className="mb-1 font-display text-sm font-bold text-steel">{s.teams[ti].team.name} leaders</p>
            {!(["pts", "reb", "ast"] as const).some((k) => (leader(ti, k)?.v ?? 0) > 0) && <p className="text-sm text-steel">No stats yet</p>}
            {(["pts", "reb", "ast"] as const).map((k) => {
              const l = leader(ti, k);
              return l && l.v > 0 && <p key={k} className="text-sm"><span className="inline-block w-9 text-steel uppercase">{k}</span>{l.name} <b className="tabular-nums">{l.v}</b></p>;
            })}
          </div>
        ))}
      </div>
      {injuries.length > 0 && (
        <div className="rounded-[var(--radius-chip)] bg-bad/10 p-3 text-sm ring-1 ring-bad/40">
          <p className="font-semibold text-bad">Injuries</p>
          {injuries.map((i) => {
            const p = s.teams[i.team].roster.find((r) => r.id === i.playerId);
            return <p key={i.playerId}>{p ? `${p.firstName[0]}. ${p.lastName}` : ""} ({s.teams[i.team].team.abbrev}): {i.name}{i.gamesOut > 0 ? `, out about ${i.gamesOut} game${i.gamesOut === 1 ? "" : "s"}` : ", day to day"}</p>;
          })}
        </div>
      )}
      <div className="mt-auto flex flex-col gap-1">
        <button ref={cont} onClick={onContinue} className="rounded-[var(--radius-chip)] bg-amber px-4 py-3 text-left font-display text-2xl font-black text-navy">
          Continue{autoContinue && left > 0 ? ` (${left})` : ""}
        </button>
        {humanTeam !== null && <button onClick={onSubs} className={btn}>Substitutions</button>}
        {highlightCount > 0 && <button onClick={onHighlights} className={btn}>Watch highlights ({highlightCount})</button>}
      </div>
    </aside>
  );
}
