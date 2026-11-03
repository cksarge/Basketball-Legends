"use client";
import type { Bracket, ScheduledGame } from "@/career/types";
import { formatDate } from "@/career/format";
import { winnerOf } from "@/career/hs/playoffs";
import { Panel } from "./kit";

/** A bracket, latest round first: big ones are long, and the end of the tournament is what matters. */
export function BracketView({ bracket, games, name, teamId }: { bracket: Bracket; games: ScheduledGame[]; name: (id: string) => string; teamId: string }) {
  const byId = new Map(games.map((g) => [g.id, g]));
  const seed = (id: string) => bracket.seeds.indexOf(id) + 1;
  const rounds = bracket.rounds.map((ids) => ids.map((id) => byId.get(id)).filter((g): g is ScheduledGame => !!g)).reverse();
  return (
    <Panel title={bracket.name}>
      {bracket.champion && <p className="mb-3 font-semibold text-amber">Champion: {name(bracket.champion)}</p>}
      {rounds.length === 0 && <p className="text-steel">The bracket is set after conference play.</p>}
      <div className="flex max-h-[32rem] flex-col gap-4 overflow-y-auto pr-1">
        {rounds.map((list) => (
          <div key={list[0].id}>
            <p className="mb-1 text-sm font-semibold text-steel">
              {list[0].label?.replace(`${bracket.name} `, "")} · {formatDate(list[0].date)}
            </p>
            <ul className="flex flex-col gap-1 text-sm">
              {list.map((g) => {
                const w = winnerOf(g);
                const row = (id: string, score?: number) => (
                  <span className={`${id === teamId ? "text-amber" : ""} ${w === id ? "font-semibold" : ""}`}>
                    <span className="text-steel">{seed(id)}</span> {name(id)} {score ?? ""}
                  </span>
                );
                return (
                  <li key={g.id} className="flex flex-wrap justify-between gap-x-3 border-t border-line/60 py-1 tabular-nums">
                    {row(g.homeId, g.result?.home)}
                    {row(g.awayId, g.result?.away)}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  );
}
