"use client";
import { seriesScore } from "@/career/pro/bracket";
import type { Team } from "@/engine/types";
import type { Franchise } from "@/franchise/types";
import { Panel } from "@/ui/kit";

export function PlayoffsTab({ f, teams }: { f: Franchise; teams: Team[] }) {
  const name = (id: string) => teams.find((t) => t.id === id)?.name;
  const list = [...f.season.series].reverse();
  return (
    <Panel title="Playoffs">
      {list.length === 0 ? (
        <p className="text-steel">The playoffs start when the regular season ends.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm tabular-nums">
          {list.map((x) => {
            const w = seriesScore(x, f.season.games);
            const mine = x.high === f.teamId || x.low === f.teamId;
            return (
              <li key={x.id} className={`border-t border-line/60 py-1 ${mine ? "text-amber" : ""}`}>
                <span className="block text-xs text-steel">{x.label}</span>
                {name(x.high)} {w.high}, {name(x.low)} {w.low}
                {x.winner ? ` · ${name(x.winner)} ${x.bestOf === 1 ? "won" : "won the series"}` : ""}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
