"use client";
import { useMemo } from "react";
import type { Career } from "@/career/types";
import { formatDate } from "@/career/format";
import { LEGEND_BAR, PILLARS, RANKS, legendStatus } from "@/career/legend";
import { Panel } from "@/ui/kit";

/** Your place on the Road to Legend: rank, points by pillar, what's next and recent milestones. */
export function LegendPanel({ career }: { career: Career }) {
  const st = useMemo(() => legendStatus(career), [career]);
  const step = RANKS.indexOf(st.rank);
  const recent = st.events.slice(-3).reverse();
  return (
    <Panel title="Road to Legend">
      <p className="font-display text-3xl font-black text-amber">{st.rank}</p>
      <p className="mb-3 text-sm text-steel">
        {st.points} Legend points
        {st.next ? ` · ${st.next.points - st.points} to ${st.next.rank}` : ""}
      </p>
      <ol aria-label="Ranks" className="mb-4 flex gap-1">
        {RANKS.map((r, i) => (
          <li key={r} title={r} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-amber" : "bg-navy"}`}>
            <span className="sr-only">
              {r}
              {i === step ? " (you are here)" : ""}
            </span>
          </li>
        ))}
      </ol>
      {st.chance !== null && (
        <p className="mb-3 rounded-[var(--radius-chip)] bg-amber/10 p-3 font-semibold text-amber ring-1 ring-amber/50">
          {st.chance}% chance will be a Legend at retirement
        </p>
      )}
      <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {PILLARS.map((p) => (
          <div key={p.id} className="flex justify-between" title={p.blurb}>
            <dt className="text-steel">{p.label}</dt>
            <dd className="font-semibold tabular-nums">{st.pillars[p.id]}</dd>
          </div>
        ))}
      </dl>
      {recent.length > 0 && (
        <ul className="mb-3 flex flex-col gap-1 text-sm">
          {recent.map((e) => (
            <li key={`${e.date}-${e.text}`} className="flex justify-between gap-3">
              <span>{e.text}</span>
              <span className="flex-none text-steel" title={formatDate(e.date)}>
                +{e.points}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-steel">
        The Legend title is only decided at retirement, for Icons with {LEGEND_BAR.toLocaleString("en-US")} points or more. Moments only come from games you
        play yourself.
      </p>
    </Panel>
  );
}
