"use client";
import type { Match } from "@/game/sim/match";
import { PLAYS, SYSTEMS } from "@/game/sim/playbook";
import type { TeamIdx } from "@/game/sim/state";
import { toast } from "../Toaster";

/** Calls a play from the pause menu. It runs on your next half-court possession. */
export function PlaysPanel({ match, team }: { match: Match; team: TeamIdx }) {
  const system = match.state.teams[team].tactics.system;
  return (
    <div className="max-w-2xl">
      <h2 className="mb-1 font-display text-3xl font-black">Plays</h2>
      <p className="mb-3 text-sm text-steel">{system ? SYSTEMS[system].label : ""} playbook. The call button works through these during play.</p>
      <ul className="flex flex-col gap-2">
        {match.playBook(team).map((id) => (
          <li key={id}>
            <button
              onClick={() => {
                if (match.callPlay(team, id)) toast(`${PLAYS[id].label} called`, "good");
              }}
              className="w-full rounded-[var(--radius-chip)] bg-deck p-3 text-left ring-1 ring-line hover:bg-deck-2"
            >
              <span className="block font-display text-xl font-bold">{PLAYS[id].label}</span>
              <span className="text-sm text-steel">{PLAYS[id].hint}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
