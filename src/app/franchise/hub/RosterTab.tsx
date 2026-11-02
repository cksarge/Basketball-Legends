"use client";
import { heightStr, playerOvr } from "@/engine/player";
import type { Player } from "@/engine/types";
import { shownOvr } from "@/franchise/pro/scouting";
import type { Franchise } from "@/franchise/types";
import { Panel } from "@/ui/kit";
import { SortTable, type Column } from "@/ui/SortTable";

const money = (n: number) => `$${(n / 1e6).toFixed(1)}M`;

export function RosterTab({ f }: { f: Franchise }) {
  const rows = f.rosters[f.teamId].map((id) => f.players[id]);
  const line = (p: Player) => f.season.stats[p.id];
  const per = (p: Player, stat: "pts" | "ast") => {
    const l = line(p);
    return l ? +(l[stat] / l.gp).toFixed(1) : 0;
  };
  const columns: Column<Player>[] = [
    { key: "jersey", label: "#", value: (p) => p.jersey },
    { key: "name", label: "Player", text: true, value: (p) => `${p.lastName} ${p.firstName}`, render: (p) => `${p.firstName} ${p.lastName}` },
    { key: "pos", label: "Pos", text: true, value: (p) => p.pos },
    { key: "age", label: "Age", value: (p) => p.age },
    { key: "ht", label: "Ht", value: (p) => p.heightIn, render: (p) => heightStr(p.heightIn) },
    { key: "ovr", label: "OVR", value: (p) => (p.file?.range ? (p.file.range.ovr[0] + p.file.range.ovr[1]) / 2 : playerOvr(p)), render: shownOvr },
    { key: "gp", label: "GP", value: (p) => line(p)?.gp ?? 0 },
    { key: "gs", label: "GS", value: (p) => line(p)?.gs ?? 0 },
    { key: "ppg", label: "PPG", value: (p) => per(p, "pts") },
    { key: "apg", label: "APG", value: (p) => per(p, "ast") },
    { key: "salary", label: "Salary", value: (p) => p.contract?.salary ?? 0, render: (p) => (p.contract ? money(p.contract.salary) : "-") },
    {
      key: "status",
      label: "Status",
      text: true,
      value: (p) => p.injury?.name ?? "",
      render: (p) => (p.injury ? `${p.injury.name} (${p.injury.gamesOut})` : ""),
    },
  ];
  return (
    <Panel title="Roster">
      <SortTable label="Roster" rows={rows} columns={columns} rowKey={(p) => p.id} initial="ovr" />
    </Panel>
  );
}
