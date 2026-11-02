"use client";
import { useMemo } from "react";
import { fullName } from "@/engine/player";
import type { Team } from "@/engine/types";
import { reb, type StatLine } from "@/game/sim/stats";
import type { Franchise, SeasonLine } from "@/franchise/types";
import { Panel } from "@/ui/kit";
import { SortTable, type Column } from "@/ui/SortTable";

type Row = { id: string; l: SeasonLine };
const avg = (l: SeasonLine, n: number) => +(n / l.gp).toFixed(1);
const pct = (m: number, a: number) => (a ? +((m / a) * 100).toFixed(1) : 0);

/** Every player's averages, sortable by any stat. */
export function LeadersTab({ f, teams }: { f: Franchise; teams: Team[] }) {
  const rows = useMemo<Row[]>(
    () =>
      Object.entries(f.season.stats)
        .filter(([, l]) => l.gp > 0)
        .map(([id, l]) => ({ id, l })),
    [f.season.stats],
  );
  const stat = (key: keyof StatLine, label: string): Column<Row> => ({ key, label, value: (r) => avg(r.l, r.l[key]) });
  const columns: Column<Row>[] = [
    { key: "name", label: "Player", text: true, value: (r) => fullName(f.players[r.id]) },
    { key: "team", label: "Team", text: true, value: (r) => teams.find((t) => t.id === f.players[r.id].teamId)?.abbrev ?? "" },
    { key: "gp", label: "GP", value: (r) => r.l.gp },
    stat("pts", "PPG"),
    { key: "reb", label: "RPG", value: (r) => avg(r.l, reb(r.l)) },
    stat("ast", "APG"),
    stat("stl", "SPG"),
    stat("blk", "BPG"),
    { key: "fg", label: "FG%", value: (r) => pct(r.l.fgm, r.l.fga) },
    { key: "tp", label: "3P%", value: (r) => pct(r.l.tpm, r.l.tpa) },
    { key: "ft", label: "FT%", value: (r) => pct(r.l.ftm, r.l.fta) },
  ];
  return (
    <Panel title="League leaders">
      {rows.length === 0 ? (
        <p className="text-steel">Stats appear once games are played.</p>
      ) : (
        <div className="scrollbar-thin max-h-[36rem] overflow-y-auto">
          <SortTable
            label="League leaders"
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            initial="pts"
            highlight={(r) => f.players[r.id].teamId === f.teamId}
          />
        </div>
      )}
    </Panel>
  );
}
