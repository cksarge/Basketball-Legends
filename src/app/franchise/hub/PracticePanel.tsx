"use client";
import { TRAINING } from "@/career/pro/season";
import { fullName, playerOvr } from "@/engine/player";
import { POSITIONS, type Position } from "@/engine/types";
import type { Franchise, PlayerPlan, PracticeFocus, TeamPlan } from "@/franchise/types";
import { Panel, Select } from "@/ui/kit";

const TEAM: { value: PracticeFocus; label: string }[] = [
  { value: "balanced", label: "Balanced" },
  { value: "shooting", label: "Shooting" },
  { value: "finishing", label: "Finishing" },
  { value: "playmaking", label: "Playmaking" },
  { value: "defense", label: "Defense" },
  { value: "conditioning", label: "Conditioning" },
];
const NONE = "";

export function PracticePanel({ f, setPlan }: { f: Franchise; setPlan: (p: Partial<TeamPlan>) => void }) {
  const roster = f.rosters[f.teamId].map((id) => f.players[id]).sort((a, b) => playerOvr(b) - playerOvr(a));
  const setPlayer = (id: string, plan: PlayerPlan | null) => {
    const playerPlans = { ...f.plan.playerPlans };
    delete playerPlans[id];
    setPlan({ playerPlans: plan ? { ...playerPlans, [id]: plan } : playerPlans });
  };
  return (
    <div className="flex flex-col gap-5">
      <Panel title="Team practice">
        <Select
          label="Team focus"
          hint="Younger players with a strong work ethic improve fastest"
          value={f.plan.practice}
          options={TEAM}
          onChange={(practice) => setPlan({ practice })}
        />
      </Panel>
      <Panel title="Player plans">
        <p className="mb-2 text-sm text-steel">A player&apos;s own plan counts double. A new position takes 12 weeks.</p>
        <ul className="flex flex-col divide-y divide-line/60">
          {roster.map((p) => {
            const own = f.plan.playerPlans[p.id];
            return (
              <li key={p.id} className="grid gap-x-6 sm:grid-cols-2">
                <Select
                  label={`${fullName(p)} focus`}
                  value={own?.focus ?? NONE}
                  options={[{ value: NONE, label: "Team focus" }, ...TRAINING.map((t) => ({ value: t.id, label: t.label }))]}
                  onChange={(focus) => setPlayer(p.id, focus ? { ...own, focus } : null)}
                />
                <Select
                  label="New position"
                  value={own?.newPos ?? NONE}
                  options={[
                    { value: NONE, label: "None" },
                    ...POSITIONS.filter((x) => x !== p.pos && x !== p.secondaryPos).map((x) => ({ value: x, label: x })),
                  ]}
                  onChange={(v) => setPlayer(p.id, { focus: own?.focus ?? "", posWeeks: 0, ...(v ? { newPos: v as Position } : {}) })}
                />
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
