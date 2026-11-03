"use client";
import { STAFF_ROLES, staffPool } from "@/franchise/coaching/staff";
import { staffBudget, tryHireStaff } from "@/franchise/club/program";
import { toast } from "@/ui/Toaster";
import type { Franchise } from "@/franchise/types";
import { useFranchise } from "@/state/franchiseStore";
import { Button, Panel } from "@/ui/kit";

const money = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1000)}K`);

export function StaffPanel({ f }: { f: Franchise }) {
  const update = useFranchise((s) => s.update);
  const team = useFranchise((s) => s.team);
  const budget = team ? staffBudget(team, f.league) : Infinity;
  const spent = f.plan.staff.reduce((sum, s) => sum + s.salary, 0);
  const hire = (who: Parameters<typeof tryHireStaff>[1]) => {
    if (!team) return;
    const tried = tryHireStaff(f, who, team);
    if ("error" in tried) return toast(tried.error, "bad");
    update((x) => {
      const done = tryHireStaff(x, who, team);
      return "error" in done ? x : done;
    });
  };
  return (
    <div className="flex flex-col gap-5">
      {Number.isFinite(budget) && (
        <Panel>
          <p>
            Staff budget: {money(spent)} of {money(budget)} a year.
          </p>
        </Panel>
      )}
      {STAFF_ROLES.map(({ role, label, hint }) => {
        const current = f.plan.staff.find((s) => s.role === role);
        return (
          <Panel key={role} title={label}>
            <p className="text-sm text-steel">{hint}</p>
            <p className="mt-1">Current: {current ? `${current.name}, rated ${current.rating}` : "Nobody hired (rated 50)"}</p>
            <ul className="mt-2 flex flex-col divide-y divide-line/60 text-sm tabular-nums">
              {staffPool(f, role).map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-1.5">
                  <span className="flex-1 truncate">{s.name}</span>
                  <span className="text-amber">{s.rating}</span>
                  <span className="w-16 text-right text-steel">{money(s.salary)}</span>
                  <Button variant="secondary" className="!px-3 !py-1 !text-base" disabled={current?.id === s.id} onClick={() => hire(s)}>
                    Hire
                  </Button>
                </li>
              ))}
            </ul>
          </Panel>
        );
      })}
    </div>
  );
}
