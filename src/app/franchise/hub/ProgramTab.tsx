"use client";
import type { Team } from "@/engine/types";
import type { Franchise } from "@/franchise/types";
import { Panel } from "@/ui/kit";

/** The program: its boss's goals, the budgets and the coach's job. */
export function ProgramTab({}: { f: Franchise; teams: Team[]; team: Team }) {
  return (
    <Panel title="Program">
      <p className="text-steel">Coming soon.</p>
    </Panel>
  );
}
