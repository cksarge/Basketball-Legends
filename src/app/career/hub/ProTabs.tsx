"use client";
import { useState } from "react";
import { heightStr, playerOvr } from "@/engine/player";
import type { Career, ProSeason as Season, ScheduledGame } from "@/career/types";
import { conferenceShort, conferenceTable, currentPro, inDevLeague, seriesScore, userProGames } from "@/career/pro/season";
import { withUser, type HsContext } from "@/career/hs/season";
import { TeamLogo } from "@/ui/TeamLogo";
import { Panel, Segmented } from "@/ui/kit";
import { SeasonSchedule } from "./CollegeTabs";

export function ProSchedule({ career, ctx }: { career: Career; ctx: HsContext }) {
  return (
    <SeasonSchedule
      career={career}
      seasons={career.pro?.seasons ?? []}
      gamesOf={userProGames as (s: never) => ScheduledGame[]}
      teamName={(id) => ctx.proById?.get(id)?.name}
    />
  );
}

export function ProTeam({ career, ctx }: { career: Career; ctx: HsContext }) {
  const s = currentPro(career);
  const team = s ? ctx.proById?.get(s.teamId) : undefined;
  const [conf, setConf] = useState<"East" | "West" | null>(null);
  if (!s || !team) return <Panel>No team yet.</Panel>;
  const roster = [...withUser(s.roster, career.player)].sort((a, b) => playerOvr(b) - playerOvr(a));
  const side = conf ?? conferenceShort(ctx, s.teamId);
  const live = conferenceTable(s, ctx, side);
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <TeamLogo team={team} size={40} />
          <h2 className="font-display text-2xl font-black">
            {team.name} {team.nickname}
            {inDevLeague(s) ? " (development)" : ""}
          </h2>
        </div>
        <table className="w-full text-sm tabular-nums">
          <thead className="text-left text-steel">
            <tr>
              <th className="py-1 font-semibold">#</th>
              <th className="font-semibold">Player</th>
              <th className="font-semibold">Pos</th>
              <th className="font-semibold">Age</th>
              <th className="font-semibold">Ht</th>
              <th className="text-right font-semibold">OVR</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((p) => (
              <tr key={p.id} className={`border-t border-line/60 ${p.id === career.player.id ? "text-amber" : ""}`}>
                <td className="py-1.5">{p.jersey}</td>
                <td>
                  {p.firstName} {p.lastName}
                </td>
                <td>{p.pos}</td>
                <td>{p.age}</td>
                <td>{heightStr(p.heightIn)}</td>
                <td className="text-right font-semibold">{playerOvr(p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <div className="flex flex-col gap-5">
        <Panel>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-display text-2xl font-black">Standings</h2>
            <Segmented label="Conference" value={side} options={(["East", "West"] as const).map((x) => ({ value: x, label: x }))} onChange={setConf} />
          </div>
          <table className="w-full text-sm tabular-nums">
            <thead className="text-left text-steel">
              <tr>
                <th className="py-1 font-semibold">Team</th>
                <th className="text-right font-semibold">W</th>
                <th className="text-right font-semibold">L</th>
              </tr>
            </thead>
            <tbody>
              {live.map((r, i) => (
                <tr key={r.teamId} className={`border-t border-line/60 ${r.teamId === s.teamId ? "text-amber" : ""}`}>
                  <td className="py-1.5">
                    {i + 1}. {ctx.proById?.get(r.teamId)?.name}
                  </td>
                  <td className="text-right">{r.w}</td>
                  <td className="text-right">{r.l}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        {s.series.length > 0 && <Playoffs s={s} ctx={ctx} />}
      </div>
    </div>
  );
}

function Playoffs({ s, ctx }: { s: Season; ctx: HsContext }) {
  const list = [...s.series].reverse();
  const name = (id: string) => ctx.proById?.get(id)?.name;
  return (
    <Panel title="Playoffs">
      <ul className="flex max-h-[28rem] flex-col gap-1 overflow-y-auto pr-1 text-sm tabular-nums">
        {list.map((x) => {
          const w = seriesScore(x, s.games);
          const mine = x.high === s.teamId || x.low === s.teamId;
          return (
            <li key={x.id} className={`border-t border-line/60 py-1 ${mine ? "text-amber" : ""}`}>
              <span className="block text-xs text-steel">{x.label}</span>
              {name(x.high)} {w.high}, {name(x.low)} {w.low}
              {x.winner ? ` · ${name(x.winner)} ${x.bestOf === 1 ? "won" : "won the series"}` : ""}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
