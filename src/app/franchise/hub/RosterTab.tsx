"use client";
import { useState } from "react";
import { fullName, heightStr, playerOvr } from "@/engine/player";
import type { Player } from "@/engine/types";
import { buyOut, buyoutAsk, callUp, releasePlayer } from "@/franchise/pro/rosterMoves";
import { shownOvr } from "@/franchise/pro/scouting";
import type { Franchise } from "@/franchise/types";
import { useFranchiseSim } from "@/state/franchiseSim";
import { Button, Panel } from "@/ui/kit";
import { SortTable, type Column } from "@/ui/SortTable";
import { useRosterMove } from "./actions";
import { CapPanel } from "./CapPanel";
import { NegotiateDialog } from "./NegotiateDialog";

const money = (n: number) => `$${(n / 1e6).toFixed(1)}M`;
const small = "!px-3 !py-1 !text-base";
const yearsLabel = (p: Player) => {
  const c = p.contract;
  if (!c) return "-";
  const marks = [
    c.teamOptionYears ? `${c.teamOptionYears}T` : "",
    c.playerOption ? "P" : "",
    c.twoWay ? "2W" : "",
    c.dev ? "Dev" : "",
    c.extension ? "Ext" : "",
  ].filter(Boolean);
  return marks.length ? `${c.years} (${marks.join(", ")})` : String(c.years);
};

export function RosterTab({ f }: { f: Franchise }) {
  const move = useRosterMove();
  const running = useFranchiseSim((s) => s.running);
  const [talk, setTalk] = useState<Player | null>(null);
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
    { key: "years", label: "Yrs", value: (p) => p.contract?.years ?? 0, render: yearsLabel },
    {
      key: "status",
      label: "Status",
      text: true,
      value: (p) => p.injury?.name ?? "",
      render: (p) => (p.injury ? `${p.injury.name} (${p.injury.gamesOut})` : ""),
    },
    {
      key: "act",
      label: "",
      text: true,
      value: () => 0,
      render: (p) => {
        const c = p.contract;
        const standard = c && !c.twoWay && !c.dev;
        return (
          <span className="flex gap-1">
            {standard && c.years === 1 && !c.extension && (
              <Button variant="ghost" className={small} disabled={running} onClick={() => setTalk(p)}>
                Extend
              </Button>
            )}
            {c?.twoWay && (
              <Button variant="ghost" className={small} disabled={running} onClick={() => move(`Called up ${fullName(p)}`, (x) => callUp(x, p.id))}>
                Call up
              </Button>
            )}
            {standard && (
              <Button
                variant="ghost"
                className={small}
                disabled={running}
                onClick={() => move(`Bought out ${fullName(p)}`, (x) => buyOut(x, p.id, buyoutAsk(x, p.id)))}
              >
                Buy out ({money(buyoutAsk(f, p.id))})
              </Button>
            )}
            <Button variant="ghost" className={small} disabled={running} onClick={() => move(`Released ${fullName(p)}`, (x) => releasePlayer(x, p.id))}>
              Release
            </Button>
          </span>
        );
      },
    },
  ];
  const dev = f.devRosters[f.teamId].map((id) => f.players[id]);
  return (
    <div className="flex flex-col gap-5">
      <CapPanel f={f} />
      <Panel title="Roster">
        <SortTable label="Roster" rows={rows} columns={columns} rowKey={(p) => p.id} initial="ovr" />
      </Panel>
      {dev.length > 0 && (
        <Panel title="Developmental players">
          <ul className="flex flex-col gap-2">
            {dev.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {fullName(p)}, {p.pos}, {shownOvr(p)}
                </span>
                <Button variant="secondary" className={small} disabled={running} onClick={() => move(`Called up ${fullName(p)}`, (x) => callUp(x, p.id))}>
                  Call up
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {talk && <NegotiateDialog f={f} player={talk} kind="extend" onClose={() => setTalk(null)} />}
    </div>
  );
}
