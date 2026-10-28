"use client";
import { addLine, emptyLine } from "@/game/sim/stats";
import type { Career, HsLevel } from "@/career/types";
import { GRADE_LABEL, LEVEL_SHORT } from "@/career/format";
import { averages, type HsContext } from "@/career/hs/season";
import { Panel } from "@/ui/kit";

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
  const awards = career.hs.seasons.flatMap((s) => s.awards.map((a) => `${s.year}-${String(s.year + 1).slice(2)}: ${a}`));
  return (
    <div className="flex flex-col gap-5">
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
                {career_ && (
                  <tr className="border-t-2 border-line font-semibold">
                    <td className="px-2 py-1.5" colSpan={2}>
                      Varsity career
                    </td>
                    <td className="px-2 text-right">{career_.gp}</td>
                    <td className="px-2 text-right">{career_.mpg.toFixed(1)}</td>
                    <td className="px-2 text-right">{career_.ppg.toFixed(1)}</td>
                    <td className="px-2 text-right">{career_.rpg.toFixed(1)}</td>
                    <td className="px-2 text-right">{career_.apg.toFixed(1)}</td>
                    <td className="px-2 text-right">{career_.spg.toFixed(1)}</td>
                    <td className="px-2 text-right">{career_.bpg.toFixed(1)}</td>
                    <td className="px-2 text-right">{pct(career_.fgPct)}</td>
                    <td className="px-2 text-right">{pct(career_.tpPct)}</td>
                    <td className="px-2 text-right">{pct(career_.ftPct)}</td>
                  </tr>
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
