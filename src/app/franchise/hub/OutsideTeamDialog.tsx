"use client";
import { useEffect, useRef } from "react";
import { heightStr, playerOvr } from "@/engine/player";
import { teamLabel } from "@/data/leagues";
import type { Player, Team } from "@/engine/types";
import type { Franchise } from "@/franchise/types";
import { outsideRoster } from "@/franchise/world";
import { shownOvr } from "@/franchise/pro/scouting";
import { Button } from "@/ui/kit";
import { TeamLogo } from "@/ui/TeamLogo";

/** Any team's roster: the saved one for teams in the user's world, a generated one for the rest. */
export function TeamRosterDialog({ f, team, onClose }: { f: Franchise; team: Team; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const saved = f.rosters[team.id];
  const roster: Player[] = saved ? saved.map((id) => f.players[id]) : outsideRoster(team, f.season.year, f.seed);
  const sorted = [...roster].sort((a, b) => playerOvr(b) - playerOvr(a));
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={`${teamLabel(team)} roster`}
      className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-[var(--radius-chip)] bg-deck p-5 text-net ring-1 ring-line backdrop:bg-black/60"
    >
      <div className="mb-3 flex items-center gap-3">
        <TeamLogo team={team} size={40} />
        <h3 className="font-display text-2xl font-black">{teamLabel(team)}</h3>
      </div>
      <div className="scrollbar-thin max-h-[60vh] overflow-y-auto">
        <table className="w-full text-sm tabular-nums">
          <thead className="text-steel">
            <tr>
              <th className="text-left">Player</th>
              <th className="text-left">Pos</th>
              <th>Class</th>
              <th>Ht</th>
              <th className="text-right">OVR</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.id} className="border-t border-line/60">
                <td className="py-1">
                  {p.firstName} {p.lastName}
                </td>
                <td>{p.pos}</td>
                <td className="text-center">{p.classYear ?? p.age}</td>
                <td className="text-center">{heightStr(p.heightIn)}</td>
                <td className="text-right">{saved ? shownOvr(p) : playerOvr(p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="ghost" onClick={() => ref.current?.close()}>
          Close
        </Button>
      </div>
    </dialog>
  );
}
