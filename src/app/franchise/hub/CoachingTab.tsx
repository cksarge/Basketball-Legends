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
export type PlanPatch = Partial<TeamPlan> | ((plan: TeamPlan) => Partial<TeamPlan>);

export function CoachingTab({ f }: { f: Franchise }) {
  const [section, setSection] = useState<Section>("Depth");
  const update = useFranchise((s) => s.update);
  const running = useFranchiseSim((s) => s.running);
  // a patch reads the latest plan, so a quick change can't undo the one before it; plans touch no player rows
  const setPlan = (patch: PlanPatch) => update((x) => ({ ...x, plan: { ...x.plan, ...(typeof patch === "function" ? patch(x.plan) : patch) } }), []);
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
            <TacticsPanel value={f.plan.tactics} onChange={() => {}} onPatch={(t) => setPlan((x) => ({ tactics: { ...x.tactics, ...t } }))} />
          </Panel>
        )}
        {section === "Playbook" && <PlaybookPanel f={f} />}
        {section === "Practice" && <PracticePanel f={f} setPlan={setPlan} />}
        {section === "Staff" && <StaffPanel f={f} />}
      </fieldset>
    </div>
  );
}
