"use client";
import { addLine, emptyLine } from "@/game/sim/stats";
import type { Career, HsLevel } from "@/career/types";
import { classLabel, GRADE_LABEL, LEVEL_SHORT } from "@/career/format";
import { averages, type HsContext } from "@/career/hs/season";
import { useState } from "react";
import { seasonRows, gameLog } from "@/career/timeline";
import { LineChart } from "./Charts";
import { Panel, Segmented } from "@/ui/kit";

type Metric = "ppg" | "rpg" | "apg" | "mpg" | "ovr" | "game";
const METRICS: { value: Metric; label: string; unit: string }[] = [
  { value: "ppg", label: "Points", unit: "points per game" },
  { value: "rpg", label: "Rebounds", unit: "rebounds per game" },
  { value: "apg", label: "Assists", unit: "assists per game" },
  { value: "mpg", label: "Minutes", unit: "minutes per game" },
  { value: "ovr", label: "Overall", unit: "overall" },
  { value: "game", label: "This season", unit: "points" },
];

/** Stat history: one measure at a time, season by season, or game by game this year. */
function StatCharts({ career }: { career: Career }) {
  const [metric, setMetric] = useState<Metric>("ppg");
  const m = METRICS.find((x) => x.value === metric)!;
  const rows = seasonRows(career);
  const points =
    metric === "game"
      ? gameLog(career).map((g) => ({ label: String(g.n), value: g.pts, detail: `Game ${g.n}: ${g.reb} reb, ${g.ast} ast` }))
      : metric === "ovr"
        ? (career.history ?? []).map((h) => ({ label: `${String(h.year).slice(2)}`, value: h.ovr, detail: `${h.year}-${String(h.year + 1).slice(2)}` }))
        : rows.map((r) => ({ label: r.label, value: r[metric], detail: `${r.label} · ${r.stage}, ${r.gp} games` }));
  return (
    <Panel title="Stat history">
      <div className="mb-3">
        <Segmented label="Stat" value={metric} options={METRICS.map(({ value, label }) => ({ value, label }))} onChange={setMetric} />
      </div>
      <LineChart title={`${m.label}: ${m.unit}`} points={points} unit={m.unit} />
    </Panel>
  );
}

const pct = (v: number) => (v ? `${(v * 100).toFixed(1)}` : "-");

export function StatsTab({ career, ctx }: { career: Career; ctx: HsContext }) {
  const rows: { key: string; label: string; team: string; a: NonNullable<ReturnType<typeof averages>> }[] = [];
  let total = { ...emptyLine(), gp: 0, gs: 0 };
  for (const s of career.hs.seasons)
    for (const lvl of ["frso", "jv", "varsity"] as HsLevel[]) {
      const t = s.stats[lvl];
      const a = averages(t);
      if (!a || !t) continue;
      rows.push({
        key: `${s.year}-${lvl}`,
        label: `${s.year}-${String(s.year + 1).slice(2)} · ${GRADE_LABEL[s.grade]}`,
        team: `${ctx.byId.get(s.schoolId)?.abbrev ?? ""} ${LEVEL_SHORT[lvl]}`,
        a,
      });
      if (lvl === "varsity") total = { ...addLine(total, t), gp: total.gp + t.gp, gs: total.gs + t.gs };
    }
  const career_ = averages(total);
  const colleges = career.college?.seasons ?? [];
  let colTotal = { ...emptyLine(), gp: 0, gs: 0 };
  for (const s of colleges) {
    const a = averages(s.stats);
    if (a)
      rows.push({
        key: `col-${s.year}`,
        label: `${s.year}-${String(s.year + 1).slice(2)} · ${classLabel(s.classYear)}`,
        team: ctx.collegeById?.get(s.teamId)?.abbrev ?? "",
        a,
      });
    colTotal = { ...addLine(colTotal, s.stats), gp: colTotal.gp + s.stats.gp, gs: colTotal.gs + s.stats.gs };
  }
  const college_ = averages(colTotal);
  const proSeasons = (career.pro?.seasons ?? []).filter((s) => s.stats.gp > 0);
  let proTotal = { ...emptyLine(), gp: 0, gs: 0 };
  for (const s of proSeasons) {
    rows.push({
      key: `pro-${s.year}`,
      label: `${s.year}-${String(s.year + 1).slice(2)}${s.status === "standard" ? "" : " · Development"}`,
      team: ctx.proById?.get(s.teamId)?.abbrev ?? "",
      a: averages(s.stats)!,
    });
    proTotal = { ...addLine(proTotal, s.stats), gp: proTotal.gp + s.stats.gp, gs: proTotal.gs + s.stats.gs };
  }
  const pro_ = averages(proTotal);
  const awards = [...career.hs.seasons, ...colleges, ...(career.pro?.seasons ?? [])].flatMap((s) =>
    s.awards.map((a) => `${s.year}-${String(s.year + 1).slice(2)}: ${a}`),
  );
  return (
    <div className="flex flex-col gap-5">
      <StatCharts career={career} />
      <Panel title="Season averages">
        {rows.length === 0 ? (
          <p className="text-steel">No games yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="text-steel">
                <tr>
                  {["Season", "Team", "GP", "MIN", "PTS", "REB", "AST", "STL", "BLK", "FG%", "3P%", "FT%"].map((h) => (
                    <th key={h} className={`px-2 py-1 font-semibold ${h === "Season" || h === "Team" ? "text-left" : "text-right"}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ key, label, team, a }) => (
                  <tr key={key} className="border-t border-line/60">
                    <td className="px-2 py-1.5">{label}</td>
                    <td className="px-2">{team}</td>
                    <td className="px-2 text-right">{a.gp}</td>
                    <td className="px-2 text-right">{a.mpg.toFixed(1)}</td>
                    <td className="px-2 text-right font-semibold">{a.ppg.toFixed(1)}</td>
                    <td className="px-2 text-right">{a.rpg.toFixed(1)}</td>
                    <td className="px-2 text-right">{a.apg.toFixed(1)}</td>
                    <td className="px-2 text-right">{a.spg.toFixed(1)}</td>
                    <td className="px-2 text-right">{a.bpg.toFixed(1)}</td>
                    <td className="px-2 text-right">{pct(a.fgPct)}</td>
                    <td className="px-2 text-right">{pct(a.tpPct)}</td>
                    <td className="px-2 text-right">{pct(a.ftPct)}</td>
                  </tr>
                ))}
                {(
                  [
                    ["Varsity career", career_],
                    ["College career", college_],
                    ["Pro career", pro_],
                  ] as const
                ).map(
                  ([name, a]) =>
                    a && (
                      <tr key={name} className="border-t-2 border-line font-semibold">
                        <td className="px-2 py-1.5" colSpan={2}>
                          {name}
                        </td>
                        <td className="px-2 text-right">{a.gp}</td>
                        <td className="px-2 text-right">{a.mpg.toFixed(1)}</td>
                        <td className="px-2 text-right">{a.ppg.toFixed(1)}</td>
                        <td className="px-2 text-right">{a.rpg.toFixed(1)}</td>
                        <td className="px-2 text-right">{a.apg.toFixed(1)}</td>
                        <td className="px-2 text-right">{a.spg.toFixed(1)}</td>
                        <td className="px-2 text-right">{a.bpg.toFixed(1)}</td>
                        <td className="px-2 text-right">{pct(a.fgPct)}</td>
                        <td className="px-2 text-right">{pct(a.tpPct)}</td>
                        <td className="px-2 text-right">{pct(a.ftPct)}</td>
                      </tr>
                    ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Honors">
        {awards.length ? (
          <ul className="flex flex-col gap-1">
            {awards.map((a) => (
              <li key={a} className="text-amber">
                {a}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-steel">Honors are handed out at the end of each season.</p>
        )}
      </Panel>
    </div>
  );
}
