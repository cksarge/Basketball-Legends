"use client";
import type { SystemId } from "@/engine/types";
import { setSystem, togglePlay } from "@/franchise/coaching/plan";
import type { Franchise } from "@/franchise/types";
import { PLAYS, SYSTEMS, type PlayId } from "@/game/sim/playbook";
import { useFranchise } from "@/state/franchiseStore";
import { Panel, Select } from "@/ui/kit";

const NONE = "none";
const systems = Object.values(SYSTEMS);
const allPlays = Object.keys(PLAYS) as PlayId[];

export function PlaybookPanel({ f }: { f: Franchise }) {
  const update = useFranchise((s) => s.update);
  const { system, plays = [] } = f.plan.tactics;
  return (
    <Panel title="Playbook">
      <Select
        label="System"
        hint={system ? SYSTEMS[system].hint : "Your team plays the game's standard offense."}
        value={system ?? NONE}
        options={[{ value: NONE, label: "None" }, ...systems.map((s) => ({ value: s.id, label: s.label }))]}
        onChange={(v) => update((x) => ({ ...x, plan: setSystem(x.plan, v === NONE ? undefined : (v as SystemId)) }))}
      />
      {system && (
        <>
          <p className="mt-3 text-sm text-steel">Your book holds up to six plays. {plays.length} chosen.</p>
          <ul className="mt-2 flex flex-col divide-y divide-line/60">
            {allPlays.map((id) => (
              <li key={id}>
                <label className="flex items-center gap-3 py-2">
                  <input type="checkbox" checked={plays.includes(id)} onChange={() => update((x) => ({ ...x, plan: togglePlay(x.plan, id) }))} />
                  <span className="flex-1">
                    {PLAYS[id].label}
                    <span className="block text-sm text-steel">{PLAYS[id].hint}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
