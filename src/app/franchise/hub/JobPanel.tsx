"use client";
import type { Team } from "@/engine/types";
import { jobOffers, takeJob } from "@/franchise/club/jobs";
import type { Franchise } from "@/franchise/types";
import { useFranchiseSim } from "@/state/franchiseSim";
import { useFranchise } from "@/state/franchiseStore";
import { Button, Panel } from "@/ui/kit";

const GOALS = [
  ["winning", "Winning"],
  ["profit", "Profit"],
  ["development", "Development"],
] as const;

/** The owner's verdict on the season, and the phone calls if it went badly. */
export function JobPanel({ f, teams }: { f: Franchise; teams: Team[] }) {
  const update = useFranchise((s) => s.update);
  const running = useFranchiseSim((s) => s.running);
  const review = f.job.reviews.at(-1);
  const total = f.job.stints.reduce((t, s) => ({ w: t.w + s.w, l: t.l + s.l }), { w: 0, l: 0 });
  return (
    <>
      {review && (
        <Panel title="The owner's review">
          <p className="mb-2">{review.note}</p>
          <ul className="flex flex-wrap gap-4">
            {GOALS.map(([key, label]) => (
              <li key={key}>
                <span className="text-steel">{label}:</span> <b>{review.grades[key]}</b>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-steel">Job security is now {Math.round(f.job.security)} of 100.</p>
        </Panel>
      )}
      {f.job.fired && (
        <Panel title="You've been fired">
          <p className="mb-3 text-steel">
            Your career record is {total.w}-{total.l}. These teams want to talk.
          </p>
          <ul className="flex flex-col gap-2">
            {jobOffers(f, teams).map((id) => {
              const team = teams.find((t) => t.id === id)!;
              return (
                <li key={id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {team.city} {team.nickname}
                  </span>
                  <Button variant="secondary" disabled={running} onClick={() => update((x) => takeJob(x, id, teams))}>
                    Take the job
                  </Button>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </>
  );
}
