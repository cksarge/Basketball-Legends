"use client";
import { useState } from "react";
import { standings, type Standing } from "@/career/hs/sim";
import { teamLabel } from "@/data/leagues";
import type { Team } from "@/engine/types";
import { conferenceSeeds } from "@/franchise/core/season";
import type { Franchise } from "@/franchise/types";
import { Panel, Segmented } from "@/ui/kit";
import { SortTable, type Column } from "@/ui/SortTable";

type Row = Standing & { seed: number };

export function StandingsTab({ f, teams }: { f: Franchise; teams: Team[] }) {
  const mine = teams.find((t) => t.id === f.teamId)!;
  const [conf, setConf] = useState<"East" | "West">(mine.conferenceId === "pro-east" ? "East" : "West");
  const order = conferenceSeeds(f, teams, conf);
  const table = standings(
    f.season.games.filter((g) => g.kind === "region"),
    order,
  );
  const rows: Row[] = order.map((id, i) => ({ ...table.get(id)!, seed: i + 1 }));
  const name = (id: string) => teamLabel(teams.find((t) => t.id === id)!);
  const columns: Column<Row>[] = [
    { key: "seed", label: "Seed", value: (r) => -r.seed, render: (r) => r.seed },
    { key: "team", label: "Team", text: true, value: (r) => name(r.teamId) },
    { key: "w", label: "W", value: (r) => r.w },
    { key: "l", label: "L", value: (r) => r.l },
    { key: "diff", label: "Diff", value: (r) => r.pf - r.pa },
    { key: "streak", label: "Streak", value: (r) => r.streak },
    { key: "last10", label: "Last 10", value: (r) => r.last10 },
  ];
  return (
    <Panel>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-2xl font-black">Standings</h2>
        <Segmented label="Conference" value={conf} options={(["East", "West"] as const).map((x) => ({ value: x, label: x }))} onChange={setConf} />
      </div>
      <SortTable label={`${conf} standings`} rows={rows} columns={columns} rowKey={(r) => r.teamId} initial="seed" highlight={(r) => r.teamId === f.teamId} />
    </Panel>
  );
}
