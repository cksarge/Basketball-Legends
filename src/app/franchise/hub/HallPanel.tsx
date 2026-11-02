"use client";
import { fullName } from "@/engine/player";
import type { Team } from "@/engine/types";
import type { Franchise } from "@/franchise/types";
import { useLegends } from "@/state/legends";
import { Panel } from "@/ui/kit";

/** Franchise greats, and the Legends from the player's own careers. */
export function HallPanel({ f, teams }: { f: Franchise; teams: Team[] }) {
  const legends = useLegends();
  return (
    <div className="flex flex-col gap-5">
      <Panel title="Hall of Fame">
        {f.hall.length === 0 ? (
          <p className="text-steel">Nobody has been inducted yet. Great careers are judged at retirement.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {[...f.hall].reverse().map((h) => (
              <li key={h.id}>
                <p className="font-semibold">
                  {h.name}, {h.pos} ({h.year})
                </p>
                <p className="text-sm text-steel">
                  {h.career.pts.toLocaleString("en-US")} points in {h.career.seasons} seasons, {h.awards} honors, {h.titles} title{h.titles === 1 ? "" : "s"}
                  {h.lastTeamId ? `, last with ${teams.find((t) => t.id === h.lastTeamId)?.name}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {legends.length > 0 && (
        <Panel title="Road to Legend">
          <ul className="flex flex-col gap-1">
            {legends.map((l) => (
              <li key={l.careerId}>
                {fullName(l.player)}, {l.player.pos}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
