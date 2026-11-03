"use client";
import { useMemo, useState } from "react";
import { ranked, standings, type Standing } from "@/career/hs/sim";
import { teamLabel } from "@/data/leagues";
import type { CollegeDivision, Team } from "@/engine/types";
import { conferenceSeeds } from "@/franchise/core/season";
import type { Franchise } from "@/franchise/types";
import { Panel, Segmented, Select } from "@/ui/kit";
import { SortTable, type Column } from "@/ui/SortTable";
import { TeamRosterDialog } from "./OutsideTeamDialog";

type Row = Standing & { seed: number };
const TOP = 25;
const DIVISION_NAMES: Record<CollegeDivision, string> = { D1: "Division I", D2: "Division II", D3: "Division III" };

function TeamButton({ team, onOpen }: { team: Team; onOpen: (t: Team) => void }) {
  return (
    <button onClick={() => onOpen(team)} className="text-left hover:text-amber hover:underline">
      {teamLabel(team)}
    </button>
  );
}

function ProStandings({ f, teams, onOpen }: { f: Franchise; teams: Team[]; onOpen: (t: Team) => void }) {
  const mine = teams.find((t) => t.id === f.teamId)!;
  const [conf, setConf] = useState<"East" | "West">(mine.conferenceId === "pro-east" ? "East" : "West");
  const order = conferenceSeeds(f, teams, conf);
  const table = standings(
    f.season.games.filter((g) => g.kind === "region"),
    order,
  );
  const rows: Row[] = order.map((id, i) => ({ ...table.get(id)!, seed: i + 1 }));
  const byId = (id: string) => teams.find((t) => t.id === id)!;
  const columns: Column<Row>[] = [
    { key: "seed", label: "Seed", value: (r) => -r.seed, render: (r) => r.seed },
    { key: "team", label: "Team", text: true, value: (r) => teamLabel(byId(r.teamId)), render: (r) => <TeamButton team={byId(r.teamId)} onOpen={onOpen} /> },
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

type ConfRow = Standing & { rank: number };

/** Conference tables and a Top 25 for any division: the user's from its games, the others from their results. */
function SchoolStandings({ f, all, onOpen }: { f: Franchise; all: Team[]; onOpen: (t: Team) => void }) {
  const mine = all.find((t) => t.id === f.teamId)!;
  const divisions = f.world.division ? (["D1", "D2", "D3"] as CollegeDivision[]) : [];
  const [division, setDivision] = useState<CollegeDivision | undefined>(f.world.division);
  const members = useMemo(() => all.filter((t) => t.league === f.league && (!division || t.tier === division)), [all, f.league, division]);
  const regular = useMemo(
    () => (division && division !== f.world.division ? (f.season.outside?.games ?? []) : f.season.games).filter((g) => g.kind !== "playoff"),
    [division, f.world.division, f.season.outside, f.season.games],
  );
  const conferences = useMemo(
    () => [...new Set(members.map((t) => t.conferenceId))].sort((a, b) => (f.conferences?.[a]?.name ?? a).localeCompare(f.conferences?.[b]?.name ?? b)),
    [members, f.conferences],
  );
  const [conference, setConference] = useState(mine.conferenceId);
  const shown = conferences.includes(conference) ? conference : conferences[0];
  const byId = useMemo(() => new Map(all.map((t) => [t.id, t])), [all]);
  const top = useMemo(
    () =>
      ranked(
        regular,
        members.map((t) => t.id),
      ).slice(0, TOP),
    [regular, members],
  );
  const ids = members.filter((t) => t.conferenceId === shown).map((t) => t.id);
  const table = standings(regular, ids);
  const rows: ConfRow[] = [...table.values()]
    .sort((a, b) => b.rw - b.rl - (a.rw - a.rl) || b.w - a.w || a.teamId.localeCompare(b.teamId))
    .map((r, i) => ({ ...r, rank: i + 1 }));
  const overall = standings(regular, top);
  const columns: Column<ConfRow>[] = [
    { key: "rank", label: "#", value: (r) => -r.rank, render: (r) => r.rank },
    {
      key: "team",
      label: "Team",
      text: true,
      value: (r) => teamLabel(byId.get(r.teamId)!),
      render: (r) => <TeamButton team={byId.get(r.teamId)!} onOpen={onOpen} />,
    },
    { key: "conf", label: "Conf", value: (r) => r.rw - r.rl, render: (r) => `${r.rw}-${r.rl}` },
    { key: "all", label: "Overall", value: (r) => r.w - r.l, render: (r) => `${r.w}-${r.l}` },
    { key: "diff", label: "Diff", value: (r) => r.pf - r.pa },
    { key: "streak", label: "Streak", value: (r) => r.streak },
  ];
  return (
    <div className="flex flex-col gap-5">
      <Panel>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-black">Standings</h2>
          {divisions.length > 0 && (
            <Segmented label="Division" value={division!} options={divisions.map((d) => ({ value: d, label: DIVISION_NAMES[d] }))} onChange={setDivision} />
          )}
        </div>
        <Select
          label="Conference"
          value={shown}
          options={conferences.map((c) => ({ value: c, label: f.conferences?.[c]?.name ?? c }))}
          onChange={setConference}
        />
        <SortTable
          label="Conference standings"
          rows={rows}
          columns={columns}
          rowKey={(r) => r.teamId}
          initial="rank"
          highlight={(r) => r.teamId === f.teamId}
        />
      </Panel>
      <Panel title={`Top ${TOP}`}>
        <ol className="flex flex-col text-sm tabular-nums">
          {top.map((id, i) => (
            <li key={id} className={`flex justify-between gap-3 border-t border-line/60 py-1 ${id === f.teamId ? "text-amber" : ""}`}>
              <span>
                <span className="mr-2 text-steel">{i + 1}</span>
                <TeamButton team={byId.get(id)!} onOpen={onOpen} />
              </span>
              <span>
                {overall.get(id)!.w}-{overall.get(id)!.l}
              </span>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}

export function StandingsTab({ f, teams, all }: { f: Franchise; teams: Team[]; all: Team[] }) {
  const [open, setOpen] = useState<Team | null>(null);
  return (
    <>
      {f.league === "pro" ? <ProStandings f={f} teams={teams} onOpen={setOpen} /> : <SchoolStandings f={f} all={all} onOpen={setOpen} />}
      {open && <TeamRosterDialog f={f} team={open} onClose={() => setOpen(null)} />}
    </>
  );
}
