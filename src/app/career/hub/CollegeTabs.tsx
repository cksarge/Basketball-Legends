"use client";
import { Fragment, useState } from "react";
import { heightStr, playerOvr } from "@/engine/player";
import type { Player } from "@/engine/types";
import type { Career, ScheduledGame } from "@/career/types";
import { formatDate } from "@/career/format";
import { conferenceName, currentCollege, userCollegeGames } from "@/career/college/season";
import { NATIONAL_ID } from "@/career/college/postseason";
import { withUser, type HsContext } from "@/career/hs/season";
import { standings } from "@/career/hs/sim";
import { TeamLogo } from "@/ui/TeamLogo";
import { Panel, Segmented } from "@/ui/kit";
import { BoxTable } from "./ScheduleTab";
import { BracketView } from "@/ui/BracketView";

const seasonName = (s: { year: number }) => `${s.year}-${String(s.year + 1).slice(2)}`;

interface ScheduleSeason {
  year: number;
  teamId: string;
  roster: Player[];
  games: ScheduledGame[];
}

/** A season's games for college or the pros. */
export function SeasonSchedule({
  career,
  seasons,
  gamesOf,
  teamName,
}: {
  career: Career;
  seasons: ScheduleSeason[];
  gamesOf: (s: never) => ScheduledGame[];
  teamName: (id: string) => string | undefined;
}) {
  const [year, setYear] = useState(seasons.at(-1)?.year ?? 0);
  const [open, setOpen] = useState<string | null>(null);
  const s = seasons.find((x) => x.year === year) ?? seasons.at(-1);
  if (!s) return <Panel>No schedule yet.</Panel>;
  const games = gamesOf(s as never);
  const people = new Map<string, Player>(s.roster.map((p) => [p.id, p]));
  people.set(career.player.id, career.player);
  const decided = games.filter((g) => g.result && g.kind !== "allstar");
  const w = decided.filter((g) => (g.homeId === s.teamId) === g.result!.home > g.result!.away).length;
  const l = decided.length - w;
  return (
    <Panel>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {seasons.length > 1 && (
          <Segmented label="Season" value={s.year} options={seasons.map((x) => ({ value: x.year, label: seasonName(x) }))} onChange={setYear} />
        )}
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
            const home = g.homeId === s.teamId;
            const opp = teamName(home ? g.awayId : g.homeId) ?? (g.kind === "allstar" ? "All-Stars" : "");
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
                    {g.neutral || home ? "vs" : "at"} {opp}
                    {g.label && <span className="ml-2 text-xs text-amber">{g.label}</span>}
                    {!g.label && g.kind === "region" && <span className="ml-2 text-xs text-steel">Conference</span>}
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
                    {line ? `${line.pts} pts · ${line.oreb + line.dreb} reb · ${line.ast} ast` : r?.dnp ? "DNP" : ""}
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

export function CollegeSchedule({ career, ctx }: { career: Career; ctx: HsContext }) {
  return (
    <SeasonSchedule
      career={career}
      seasons={career.college?.seasons ?? []}
      gamesOf={userCollegeGames as (s: never) => ScheduledGame[]}
      teamName={(id) => ctx.collegeById?.get(id)?.name}
    />
  );
}

export function CollegeTeam({ career, ctx }: { career: Career; ctx: HsContext }) {
  const s = currentCollege(career)!;
  const team = ctx.collegeById?.get(s.teamId);
  if (!team) return <Panel>No team yet.</Panel>;
  const roster = [...(s.redshirt ? [...s.roster, career.player] : withUser(s.roster, career.player))].sort((a, b) => playerOvr(b) - playerOvr(a));
  const ids = (ctx.colleges ?? []).filter((t) => t.conferenceId === team.conferenceId).map((t) => t.id);
  const live = standings(
    s.games.filter((g) => g.kind !== "playoff"),
    ids,
  );
  const table = s.conferenceTable ?? [...live.values()];
  const rows = [...table].sort((a, b) => b.rw - b.rl - (a.rw - a.rl) || b.w - b.l - (a.w - a.l));
  const brackets = s.brackets ?? [];
  const mine =
    brackets.find((b) => !b.id.startsWith("conf-") && b.seeds.includes(s.teamId)) ??
    brackets.find((b) => b.id === NATIONAL_ID) ??
    brackets.find((b) => b.id === `conf-${team.conferenceId}`);
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <TeamLogo team={team} size={40} />
          <h2 className="font-display text-2xl font-black">
            {team.name} {team.nickname}
          </h2>
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
        <Panel title={conferenceName(ctx, team)}>
          <table className="w-full text-sm tabular-nums">
            <thead className="text-left text-steel">
              <tr>
                <th className="py-1 font-semibold">Team</th>
                <th className="text-right font-semibold">Conf</th>
                <th className="text-right font-semibold">Overall</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.teamId} className={`border-t border-line/60 ${r.teamId === s.teamId ? "text-amber" : ""}`}>
                  <td className="py-1.5">{ctx.collegeById?.get(r.teamId)?.name}</td>
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
        </Panel>
        {mine && <BracketView bracket={mine} games={s.games} name={(id) => ctx.collegeById?.get(id)?.name ?? ""} teamId={s.teamId} />}
      </div>
    </div>
  );
}
