"use client";
import { useEffect, useState } from "react";
import { fullName } from "@/engine/player";
import type { Team } from "@/engine/types";
import { pastSeasons } from "@/franchise/storage";
import type { Franchise, LeagueSeason } from "@/franchise/types";
import { Panel } from "@/ui/kit";

const TOP_SCORERS = 5;
const seasonName = (year: number) => `${year}-${String(year + 1).slice(2)}`;

/** Every finished season, and the coach's own record. */
export function HistoryPanel({ f, teams }: { f: Franchise; teams: Team[] }) {
  const [past, setPast] = useState<LeagueSeason[]>([]);
  useEffect(() => {
    pastSeasons(f.id).then(setPast);
  }, [f.id, f.history.length]);
  const teamName = (id?: string | null) => teams.find((t) => t.id === id)?.name ?? "";
  const nameOf = (id: string) => (f.players[id] ? fullName(f.players[id]) : (f.retired.find((r) => r.id === id)?.name ?? "A former player"));
  const scorers = (year: number) => {
    const s = past.find((x) => x.year === year);
    if (!s) return [];
    return Object.entries(s.stats)
      .filter(([, l]) => l.gp > 0)
      .sort(([, a], [, b]) => b.pts / b.gp - a.pts / a.gp)
      .slice(0, TOP_SCORERS)
      .map(([id, l]) => `${nameOf(id)} ${(l.pts / l.gp).toFixed(1)}`);
  };
  return (
    <div className="flex flex-col gap-5">
      <Panel title="Your career">
        <ul className="flex flex-col gap-1">
          {f.job.stints.map((s) => (
            <li key={`${s.teamId}-${s.from}`}>
              {teamName(s.teamId)}, {seasonName(s.from)}
              {s.to ? ` to ${seasonName(s.to)}` : " to now"}: {s.w}-{s.l}
              {s.titles ? `, ${s.titles} title${s.titles === 1 ? "" : "s"}` : ""}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="League history">
        {f.history.length === 0 ? (
          <p className="text-steel">The first season isn&apos;t finished yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {[...f.history].reverse().map((h) => (
              <li key={h.year}>
                <p className="font-semibold">
                  {seasonName(h.year)}: {teamName(h.championId)} won the title
                </p>
                <p className="text-sm text-steel">
                  You went {h.record.w}-{h.record.l}. MVP: {h.awards.find((a) => a.id === "mvp")?.name ?? "none"}.
                </p>
                {scorers(h.year).length > 0 && <p className="text-sm text-steel">Top scorers: {scorers(h.year).join(", ")}</p>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
