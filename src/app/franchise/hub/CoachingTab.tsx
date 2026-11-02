"use client";
import { useState } from "react";
import type { Franchise, TeamPlan } from "@/franchise/types";
import { useFranchiseSim } from "@/state/franchiseSim";
import { useFranchise } from "@/state/franchiseStore";
import { Panel, Segmented } from "@/ui/kit";
import { TacticsPanel } from "@/ui/TacticsPanel";
import { DepthPanel } from "./DepthPanel";
import { PlaybookPanel } from "./PlaybookPanel";
import { PracticePanel } from "./PracticePanel";
import { StaffPanel } from "./StaffPanel";

const SECTIONS = ["Depth", "Tactics", "Playbook", "Practice", "Staff"] as const;
type Section = (typeof SECTIONS)[number];

export function CoachingTab({ f }: { f: Franchise }) {
  const [section, setSection] = useState<Section>("Depth");
  const update = useFranchise((s) => s.update);
  const running = useFranchiseSim((s) => s.running);
  const setPlan = (patch: Partial<TeamPlan>) => update((x) => ({ ...x, plan: { ...x.plan, ...patch } }));
  return (
    <div className="flex flex-col gap-5">
      <Segmented label="Coaching section" value={section} options={SECTIONS.map((s) => ({ value: s, label: s }))} onChange={setSection} />
      {running && (
        <p className="text-sm text-steel" role="status">
          Changes are off while a sim is running.
        </p>
      )}
      <fieldset disabled={running} className="min-w-0">
        {section === "Depth" && <DepthPanel f={f} setPlan={setPlan} />}
        {section === "Tactics" && (
          <Panel title="Tactics">
            <TacticsPanel value={f.plan.tactics} onChange={(tactics) => setPlan({ tactics })} />
          </Panel>
        )}
        {section === "Playbook" && <PlaybookPanel f={f} />}
        {section === "Practice" && <PracticePanel f={f} setPlan={setPlan} />}
        {section === "Staff" && <StaffPanel f={f} />}
      </fieldset>
    </div>
  );
}
