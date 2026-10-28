"use client";
import { Fragment, useState } from "react";
import type { Player } from "@/engine/types";
import { fmtMin } from "@/game/sim/stats";
import type { Career, HsLevel, HsSeason } from "@/career/types";
import { formatDate, LEVEL_SHORT } from "@/career/format";
import { currentSeason, type HsContext } from "@/career/hs/season";
import { schoolLevels } from "@/career/hs/rosters";
import { Panel, Segmented } from "@/ui/kit";

export function playerIndex(career: Career, s: HsSeason) {
  const m = new Map<string, Player>();
  for (const l of Object.values(s.rosters)) for (const p of l ?? []) m.set(p.id, p);
  m.set(career.player.id, career.player);
  return m;
}

export function ScheduleTab({ career, ctx }: { career: Career; ctx: HsContext }) {
  const seasons = career.hs.seasons;
  const [year, setYear] = useState(seasons.at(-1)?.year ?? career.startYear);
  const s = seasons.find((x) => x.year === year) ?? currentSeason(career);
  const school = s ? ctx.byId.get(s.schoolId) : undefined;
  const [level, setLevel] = useState<HsLevel | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const lvl = level ?? s?.level ?? "varsity";
  const people = s ? playerIndex(career, s) : new Map<string, Player>();
  if (!s || !school) return <Panel>No schedule yet.</Panel>;
  const games = s.games.filter((g) => g.level === lvl && (g.homeId === s.schoolId || g.awayId === s.schoolId));
  let w = 0,
    l = 0;
  for (const g of games)
    if (g.result) {
      const won = (g.homeId === s.schoolId) === g.result.home > g.result.away;
      if (won) w++;
      else l++;
    }
  return (
    <Panel>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {seasons.length > 1 && (
          <Segmented
            label="Season"
            value={year}
            options={seasons.map((x) => ({ value: x.year, label: `${x.year}-${String(x.year + 1).slice(2)}` }))}
            onChange={(v) => {
              setYear(v);
              setLevel(null);
            }}
          />
        )}
        <Segmented label="Level" value={lvl} options={schoolLevels(school).map((x) => ({ value: x, label: LEVEL_SHORT[x] }))} onChange={setLevel} />
        <span className="ml-auto font-display text-2xl font-black">
          {w}-{l}
        </span>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-steel">
          <tr>
            <th className="py-1 font-semibold">Date</th>
            <th className="font-semibold">Opponent</th>
            <th className="font-semibold">Result</th>
            <th className="hidden font-semibold sm:table-cell">You</th>
          </tr>
        </thead>
        <tbody>
          {games.map((g) => {
            const home = g.homeId === s.schoolId;
            const opp = ctx.byId.get(home ? g.awayId : g.homeId);
            const r = g.result;
            const won = r && (home ? r.home > r.away : r.away > r.home);
            const line = r?.userLine;
            const expandable = !!r?.box && Object.keys(r.box).length > 0;
            return (
              <Fragment key={g.id}>
                <tr
                  className={`border-t border-line/60 ${expandable ? "cursor-pointer hover:bg-deck-2" : ""}`}
                  onClick={() => expandable && setOpen(open === g.id ? null : g.id)}
                  aria-expanded={expandable ? open === g.id : undefined}
                >
                  <td className="py-2 pr-3 text-steel">{formatDate(g.date).replace(/, \d{4}$/, "")}</td>
                  <td className="pr-3">
                    {g.neutral ? "vs" : home ? "vs" : "at"} {opp?.name}
                    {g.label && <span className="ml-2 text-xs text-amber">{g.label}</span>}
                    {!g.label && g.kind === "region" && <span className="ml-2 text-xs text-steel">Region</span>}
                  </td>
                  <td className="pr-3 tabular-nums">
                    {r ? (
                      <>
                        <span className={won ? "text-good" : "text-bad"}>{won ? "W" : "L"}</span> {home ? r.home : r.away}-{home ? r.away : r.home}
                        {r.overtimes > 0 && ` (${r.overtimes > 1 ? r.overtimes : ""}OT)`}
                        {r.played && <span className="ml-1 text-xs text-steel">played</span>}
                      </>
                    ) : (
                      <span className="text-steel">—</span>
                    )}
                  </td>
                  <td className="hidden text-steel sm:table-cell">
                    {line ? `${line.pts} pts · ${line.oreb + line.dreb} reb · ${line.ast} ast` : r?.dnp ? "DNP" : r && g.level !== s.level ? "" : ""}
                  </td>
                </tr>
                {open === g.id && r?.box && (
                  <tr>
                    <td colSpan={4} className="pb-3">
                      <BoxTable box={r.box} people={people} userId={career.player.id} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

function BoxTable({
  box,
  people,
  userId,
}: {
  box: NonNullable<NonNullable<HsSeason["games"][number]["result"]>["box"]>;
  people: Map<string, Player>;
  userId: string;
}) {
  const rows = Object.entries(box)
    .filter(([, l]) => l.min > 0)
    .sort((a, b) => b[1].pts - a[1].pts);
  return (
    <div className="overflow-x-auto rounded-[var(--radius-chip)] bg-navy p-2">
      <table className="w-full text-xs tabular-nums">
        <thead className="text-steel">
          <tr>
            {["Player", "MIN", "PTS", "FG", "3P", "FT", "REB", "AST", "STL", "BLK", "TO"].map((h) => (
              <th key={h} className={`px-1 py-1 font-semibold ${h === "Player" ? "text-left" : "text-right"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([id, l]) => {
            const p = people.get(id);
            return (
              <tr key={id} className={id === userId ? "text-amber" : ""}>
                <td className="px-1 py-0.5">{p ? `${p.firstName[0]}. ${p.lastName}` : "—"}</td>
                <td className="px-1 text-right">{fmtMin(l.min)}</td>
                <td className="px-1 text-right">{l.pts}</td>
                <td className="px-1 text-right">
                  {l.fgm}-{l.fga}
                </td>
                <td className="px-1 text-right">
                  {l.tpm}-{l.tpa}
                </td>
                <td className="px-1 text-right">
                  {l.ftm}-{l.fta}
                </td>
                <td className="px-1 text-right">{l.oreb + l.dreb}</td>
                <td className="px-1 text-right">{l.ast}</td>
                <td className="px-1 text-right">{l.stl}</td>
                <td className="px-1 text-right">{l.blk}</td>
                <td className="px-1 text-right">{l.tov}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
