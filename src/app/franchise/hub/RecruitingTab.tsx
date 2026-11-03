"use client";
import type { Team } from "@/engine/types";
import type { Franchise } from "@/franchise/types";
import { Panel } from "@/ui/kit";

/** Recruiting. Until its board is built, the user's staff recruits the way an AI program does. */
export function RecruitingTab({ f }: { f: Franchise; teams: Team[] }) {
  const committed = (f.college?.recruits ?? []).filter((r) => r.committed === f.teamId);
  return (
    <Panel title="Recruiting">
      <p className="text-steel">Coming soon. Until then, your staff is recruiting for you.</p>
      <p className="mt-2">
        {committed.length} committed to your {f.college?.classYear} class.
      </p>
    </Panel>
  );
}
