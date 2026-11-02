"use client";
import { fullName } from "@/engine/player";
import type { Franchise } from "@/franchise/types";
import { Panel } from "@/ui/kit";

const NOTABLE_RETIREMENTS = 8;

/** Who got better, who slipped and who called it a career. */
export function ProgressPanel({ f }: { f: Franchise }) {
  const report = f.offseason?.report;
  if (!report) return null;
  const changes = [...report.changes].sort((a, b) => b.after - b.before - (a.after - a.before));
  const retired = report.retired.map((id) => f.players[id]).sort((a, b) => (b.file?.peak ?? 0) - (a.file?.peak ?? 0));
  return (
    <>
      <Panel title="Your players">
        <ul className="flex flex-col gap-1">
          {changes.map((c) => (
            <li key={c.id} className="flex justify-between gap-3">
              <span>{fullName(f.players[c.id])}</span>
              <span className="tabular-nums">
                {c.before} → {c.after}{" "}
                <span className={c.after > c.before ? "text-amber" : "text-steel"}>
                  ({c.after >= c.before ? "+" : ""}
                  {c.after - c.before})
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Retirements">
        {retired.length === 0 ? (
          <p className="text-steel">Nobody retired this year.</p>
        ) : (
          <>
            <p className="mb-2 text-sm text-steel">
              {retired.length} player{retired.length === 1 ? "" : "s"} retired.
            </p>
            <ul className="flex flex-col gap-1">
              {retired.slice(0, NOTABLE_RETIREMENTS).map((p) => (
                <li key={p.id}>
                  {fullName(p)}, age {p.age}, best overall {p.file?.peak}
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
    </>
  );
}
