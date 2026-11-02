"use client";
import type { Team } from "@/engine/types";
import { powerRankings } from "@/franchise/history/power";
import { winShare } from "@/franchise/pro/market";
import type { Franchise } from "@/franchise/types";
import { Panel } from "@/ui/kit";
import { SortTable, type Column } from "@/ui/SortTable";

type Row = ReturnType<typeof powerRankings>[number];

export function PowerPanel({ f, teams }: { f: Franchise; teams: Team[] }) {
  const rows = powerRankings(f);
  const move = (r: Row) => r.last - r.rank;
  const columns: Column<Row>[] = [
    { key: "rank", label: "#", value: (r) => -r.rank, render: (r) => r.rank },
    { key: "team", label: "Team", text: true, value: (r) => teams.find((t) => t.id === r.teamId)?.name ?? "" },
    { key: "move", label: "Move", value: move, render: (r) => (move(r) > 0 ? `+${move(r)}` : move(r) < 0 ? String(move(r)) : "-") },
    { key: "win", label: "Win %", value: (r) => Math.round(winShare(f, r.teamId) * 100) },
    { key: "score", label: "Score", value: (r) => Math.round(r.score) },
  ];
  return (
    <Panel title="Power rankings">
      <SortTable label="Power rankings" rows={rows} columns={columns} rowKey={(r) => r.teamId} initial="rank" highlight={(r) => r.teamId === f.teamId} />
    </Panel>
  );
}
