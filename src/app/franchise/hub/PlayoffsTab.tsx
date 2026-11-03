"use client";
import { useState } from "react";
import { seriesScore } from "@/career/pro/bracket";
import type { Bracket } from "@/career/types";
import type { Team } from "@/engine/types";
import type { Franchise } from "@/franchise/types";
import { BracketView } from "@/ui/BracketView";
import { Panel, Select } from "@/ui/kit";

/** The national brackets first, then the user's own, then the rest. */
function order(f: Franchise, brackets: Bracket[]) {
  const rank = (b: Bracket) => (b.id === "national" ? 0 : b.id === "invitational" ? 1 : b.seeds.includes(f.teamId) ? 2 : 3);
  return [...brackets].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

function Brackets({ f, teams }: { f: Franchise; teams: Team[] }) {
  const name = (id: string) => teams.find((t) => t.id === id)?.name ?? "";
  const list = order(f, f.season.brackets);
  const [picked, setPicked] = useState<string | null>(null);
  if (!list.length) return <Panel title="Postseason">The postseason starts when the regular season ends.</Panel>;
  const shown = list.find((b) => b.id === picked) ?? list.find((b) => b.rounds.length) ?? list[0];
  const champions = list.filter((b) => b.rounds.length === 0 && b.champion);
  return (
    <div className="flex flex-col gap-5">
      <Panel>
        <Select
          label="Bracket"
          value={shown.id}
          options={list.filter((b) => b.rounds.length).map((b) => ({ value: b.id, label: b.name }))}
          onChange={setPicked}
        />
      </Panel>
      {shown.rounds.length > 0 && <BracketView bracket={shown} games={f.season.games} name={name} teamId={f.teamId} />}
      {champions.length > 0 && (
        <Panel title="Automatic bids">
          <ul className="flex flex-col gap-1 text-sm">
            {champions.map((b) => (
              <li key={b.id} className={b.champion === f.teamId ? "text-amber" : ""}>
                {b.name}: {name(b.champion!)}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

export function PlayoffsTab({ f, teams }: { f: Franchise; teams: Team[] }) {
  if (f.league !== "pro") return <Brackets f={f} teams={teams} />;
  const name = (id: string) => teams.find((t) => t.id === id)?.name;
  const list = [...f.season.series].reverse();
  return (
    <Panel title="Playoffs">
      {list.length === 0 ? (
        <p className="text-steel">The playoffs start when the regular season ends.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm tabular-nums">
          {list.map((x) => {
            const w = seriesScore(x, f.season.games);
            const mine = x.high === f.teamId || x.low === f.teamId;
            return (
              <li key={x.id} className={`border-t border-line/60 py-1 ${mine ? "text-amber" : ""}`}>
                <span className="block text-xs text-steel">{x.label}</span>
                {name(x.high)} {w.high}, {name(x.low)} {w.low}
                {x.winner ? ` · ${name(x.winner)} ${x.bestOf === 1 ? "won" : "won the series"}` : ""}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
