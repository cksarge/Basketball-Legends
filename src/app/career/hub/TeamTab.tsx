"use client";
import { useState } from "react";
import { heightStr, playerOvr } from "@/engine/player";
import type { Career, HsLevel, ScheduledGame } from "@/career/types";
import { LEVEL_SHORT } from "@/career/format";
import { currentSeason, withUser, type HsContext } from "@/career/hs/season";
import { schoolLevels } from "@/career/hs/rosters";
import { standings } from "@/career/hs/sim";
import { winnerOf } from "@/career/hs/playoffs";
import { TeamLogo } from "@/ui/TeamLogo";
import { Panel, Segmented } from "@/ui/kit";

export function TeamTab({ career, ctx }: { career: Career; ctx: HsContext }) {
  const s = currentSeason(career);
  const school = s ? ctx.byId.get(s.schoolId) : undefined;
  const [level, setLevel] = useState<HsLevel | null>(null);
  const lvl = level ?? s?.level ?? "varsity";
  const regionIds = school ? ctx.teams.filter((t) => t.conferenceId === school.conferenceId).map((t) => t.id) : [];
  if (!s || !school) return <Panel>No team yet.</Panel>;
  const roster = [...(s.level === lvl ? withUser(s.rosters[lvl] ?? [], career.player) : (s.rosters[lvl] ?? []))].sort((a, b) => playerOvr(b) - playerOvr(a));
  const varsity = s.games.filter((g) => g.level === "varsity" && g.kind !== "playoff");
  const table = s.regionTable ? new Map(s.regionTable.map((r) => [r.teamId, { ...r, pf: 0, pa: 0, streak: 0, last10: "" }])) : standings(varsity, regionIds);
  const rows = [...table.values()].sort((a, b) => b.rw - b.rl - (a.rw - a.rl) || b.w - b.l - (a.w - a.l));
  const bracket = s.playoffs?.find((b) => b.seeds.includes(s.schoolId)) ?? s.playoffs?.find((b) => b.id === school.tier?.toLowerCase());
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <TeamLogo team={school} size={40} />
          <h2 className="font-display text-2xl font-black">
            {school.name} {school.nickname}
          </h2>
          <span className="ml-auto">
            <Segmented label="Level" value={lvl} options={schoolLevels(school).map((x) => ({ value: x, label: LEVEL_SHORT[x] }))} onChange={setLevel} />
          </span>
        </div>
        <table className="w-full text-sm tabular-nums">
          <thead className="text-left text-steel">
            <tr>
              <th className="py-1 font-semibold">#</th>
              <th className="font-semibold">Player</th>
              <th className="font-semibold">Pos</th>
              <th className="font-semibold">Class</th>
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
                <td>{p.classYear}</td>
                <td>{heightStr(p.heightIn)}</td>
                <td className="text-right font-semibold">{playerOvr(p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <div className="flex flex-col gap-5">
        <Panel
          title={`${school.tier} ${school.conferenceId
            .split("-")
            .slice(2)
            .join(" ")
            .replace(/\b\w/g, (m) => m.toUpperCase())} Region`}
        >
          <table className="w-full text-sm tabular-nums">
            <thead className="text-left text-steel">
              <tr>
                <th className="py-1 font-semibold">Team</th>
                <th className="text-right font-semibold">Region</th>
                <th className="text-right font-semibold">Overall</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.teamId} className={`border-t border-line/60 ${r.teamId === s.schoolId ? "text-amber" : ""}`}>
                  <td className="py-1.5">{ctx.byId.get(r.teamId)?.name}</td>
                  <td className="text-right">
                    {r.rw}-{r.rl}
                  </td>
                  <td className="text-right">
                    {r.w}-{r.l}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-steel">Varsity standings. Region play runs from January to mid-February.</p>
        </Panel>
        {bracket && <BracketView bracket={bracket} games={s.games} ctx={ctx} schoolId={s.schoolId} />}
      </div>
    </div>
  );
}

function BracketView({
  bracket,
  games,
  ctx,
  schoolId,
}: {
  bracket: NonNullable<ReturnType<typeof currentSeason>>["playoffs"] extends (infer B)[] | undefined ? B : never;
  games: ScheduledGame[];
  ctx: HsContext;
  schoolId: string;
}) {
  const byId = new Map(games.map((g) => [g.id, g]));
  const seed = (id: string) => bracket.seeds.indexOf(id) + 1;
  return (
    <Panel title={bracket.name}>
      {bracket.champion && (
        <p className="mb-3 font-semibold text-amber">
          Champion: {ctx.byId.get(bracket.champion)?.name} {ctx.byId.get(bracket.champion)?.nickname}
        </p>
      )}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {bracket.rounds.map((ids, r) => (
          <div key={r} className="flex min-w-44 flex-col justify-around gap-2">
            <p className="text-xs font-semibold text-steel">{byId.get(ids[0])?.label?.replace(`${bracket.name} `, "")}</p>
            {ids.map((id) => {
              const g = byId.get(id);
              if (!g) return null;
              const w = winnerOf(g);
              return (
                <div key={id} className="rounded-[var(--radius-chip)] bg-navy p-1.5 text-xs ring-1 ring-line">
                  {[g.homeId, g.awayId].map((t) => (
                    <p key={t} className={`flex justify-between gap-2 ${t === schoolId ? "text-amber" : ""} ${w && w !== t ? "text-steel" : ""}`}>
                      <span className="truncate">
                        <span className="text-steel">{seed(t)}</span> {ctx.byId.get(t)?.name}
                      </span>
                      <span className="tabular-nums">{g.result ? (t === g.homeId ? g.result.home : g.result.away) : ""}</span>
                    </p>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
        {bracket.rounds.length === 0 && <p className="text-steel">The bracket is set when the regular season ends.</p>}
      </div>
    </Panel>
  );
}
