"use client";
import { useState } from "react";
import { formatDate } from "@/career/format";
import { teamLabel } from "@/data/leagues";
import type { Team } from "@/engine/types";
import type { Franchise } from "@/franchise/types";
import { BoxScoreTable } from "@/ui/BoxScore";
import { Panel } from "@/ui/kit";

export function ScheduleTab({ f, teams, team }: { f: Franchise; teams: Team[]; team: Team }) {
  const [open, setOpen] = useState<string | null>(null);
  const name = (id: string) => teamLabel(teams.find((t) => t.id === id)!);
  const games = f.season.games.filter((g) => g.homeId === f.teamId || g.awayId === f.teamId).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const roster = f.rosters[f.teamId].map((id) => f.players[id]);
  return (
    <Panel title="Schedule">
      <ul className="flex flex-col text-sm tabular-nums">
        {games.map((g) => {
          const home = g.homeId === f.teamId;
          const r = g.result;
          const won = r ? r.home > r.away === home : false;
          return (
            <li key={g.id} className="border-t border-line/60 py-1.5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="w-28 flex-none text-steel">{formatDate(g.date)}</span>
                <span className="flex-1 truncate">
                  {home ? "vs" : "at"} {name(home ? g.awayId : g.homeId)}
                  {g.label ? <span className="text-steel"> · {g.label}</span> : null}
                </span>
                {r && (
                  <span>
                    <span className={won ? "text-good" : "text-bad"}>{won ? "W" : "L"}</span> {home ? r.home : r.away}-{home ? r.away : r.home}
                  </span>
                )}
                {r?.box && (
                  <button className="text-amber underline" aria-expanded={open === g.id} onClick={() => setOpen(open === g.id ? null : g.id)}>
                    Box score
                  </button>
                )}
              </div>
              {open === g.id && r?.box && <BoxScoreTable teams={[{ team, roster }]} box={r.box} />}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
