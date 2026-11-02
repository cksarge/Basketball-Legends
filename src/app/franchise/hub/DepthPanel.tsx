"use client";
import { fullName, playerOvr } from "@/engine/player";
import { POSITIONS, type Player } from "@/engine/types";
import { defaultPlan, depthWarnings, resolveLineup, type DepthWarning } from "@/franchise/coaching/plan";
import { leagueModule } from "@/franchise/leagues";
import type { Franchise, TeamPlan } from "@/franchise/types";
import { Button, Panel, Select, Slider, Toggle } from "@/ui/kit";

const WARNING: Record<DepthWarning["kind"], string> = {
  fatigue: "will tire: over 38 minutes",
  position: "is out of position",
  hurt: "is hurt and will sit",
  unused: "has no minutes",
};
const label = (p: Player) => `${fullName(p)} (${p.pos} ${playerOvr(p)})`;

export function DepthPanel({ f, setPlan }: { f: Franchise; setPlan: (p: Partial<TeamPlan>) => void }) {
  const roster = f.rosters[f.teamId].map((id) => f.players[id]).sort((a, b) => playerOvr(b) - playerOvr(a));
  const league = leagueModule(f.league);
  const total = league.quarterMinutes * league.periods * 5;
  const plan = f.plan;

  const setAuto = (on: boolean) => {
    if (on) return setPlan({ autoRotation: true });
    // manual starts from what auto would do
    const l = resolveLineup({ ...plan, autoRotation: true }, roster, total);
    setPlan({ autoRotation: false, starters: l.starters, minutes: l.rotation });
  };
  const setStarter = (slot: number, id: string) => {
    const starters = [...plan.starters];
    const was = starters.indexOf(id);
    if (was >= 0) starters[was] = starters[slot];
    starters[slot] = id;
    setPlan({ starters });
  };

  return (
    <Panel title="Depth chart">
      <Toggle label="Auto rotation" hint="Your staff picks the lineup and minutes" checked={plan.autoRotation} onChange={setAuto} />
      {!plan.autoRotation && (
        <>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            {POSITIONS.map((pos, slot) => (
              <div
                key={pos}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData("text/plain");
                  if (id) setStarter(slot, id);
                }}
              >
                <Select
                  label={`Starting ${pos}`}
                  value={plan.starters[slot]}
                  options={roster.map((p) => ({ value: p.id, label: label(p) }))}
                  onChange={(id) => setStarter(slot, id)}
                />
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm text-steel" role="status">
            Minutes planned: {Object.values(plan.minutes).reduce((a, b) => a + b, 0)} of {total}. The game scales them to fit.
          </p>
          <ul className="mt-2 flex flex-col">
            {roster.map((p) => (
              <li key={p.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", p.id)}>
                <Slider
                  label={label(p)}
                  value={plan.minutes[p.id] ?? 0}
                  min={0}
                  max={total / 5}
                  step={1}
                  format={(v) => `${v} min`}
                  onChange={(v) => setPlan({ minutes: { ...plan.minutes, [p.id]: v } })}
                />
              </li>
            ))}
          </ul>
          <ul className="mt-3 text-sm text-amber">
            {depthWarnings(plan, roster).map((w) => (
              <li key={`${w.playerId}-${w.kind}`}>
                {fullName(f.players[w.playerId])} {WARNING[w.kind]}
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <Button variant="ghost" onClick={() => setPlan({ autoRotation: true, starters: defaultPlan().starters, minutes: {} })}>
              Reset to auto
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}
