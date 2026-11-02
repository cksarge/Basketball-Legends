"use client";
import type { Franchise, LeagueRecord } from "@/franchise/types";
import { Panel } from "@/ui/kit";

const GROUPS: { title: string; prefix: string }[] = [
  { title: "Single season", prefix: "season" },
  { title: "Career", prefix: "career" },
  { title: "Your best games", prefix: "game" },
];
const seasonName = (year: number) => `${year}-${String(year + 1).slice(2)}`;

function Row({ r }: { r: LeagueRecord }) {
  return (
    <li className="flex flex-wrap justify-between gap-2">
      <span className="text-steel">{r.label}</span>
      <span>
        {r.value.toLocaleString("en-US")}, {r.name} ({seasonName(r.year)})
      </span>
    </li>
  );
}

export function RecordsPanel({ f }: { f: Franchise }) {
  if (!f.records.length)
    return (
      <Panel title="Records">
        <p className="text-steel">Records start when the first season is finished.</p>
      </Panel>
    );
  return (
    <div className="flex flex-col gap-5">
      {GROUPS.map((g) => {
        const rows = f.records.filter((r) => r.key.startsWith(g.prefix));
        return rows.length > 0 ? (
          <Panel key={g.title} title={g.title}>
            <ul className="flex flex-col gap-1">
              {rows.map((r) => (
                <Row key={r.key} r={r} />
              ))}
            </ul>
          </Panel>
        ) : null;
      })}
    </div>
  );
}
