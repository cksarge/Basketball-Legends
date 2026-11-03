"use client";
import { useState } from "react";
import type { Team } from "@/engine/types";
import { attendance, seasonExpenses, setBudget, setTicketPrice } from "@/franchise/club/finance";
import { moneyM } from "@/franchise/pro/cap";
import { capRules } from "@/franchise/pro/rules";
import type { BudgetKey, Franchise, OwnerGoal } from "@/franchise/types";
import { useFranchiseSim } from "@/state/franchiseSim";
import { useFranchise } from "@/state/franchiseStore";
import { Panel, Slider } from "@/ui/kit";

const BUDGETS: { key: BudgetKey; label: string; hint: string }[] = [
  { key: "coaching", label: "Coaching", hint: "Players improve faster." },
  { key: "scouting", label: "Scouting", hint: "Draft ranges narrow faster." },
  { key: "facilities", label: "Facilities", hint: "Builds slowly. Helps attendance and signing free agents." },
];
const GOAL_NAME: Partial<Record<OwnerGoal["key"], (target: number) => string>> = {
  winning: (n) => `Win ${n} games`,
  profit: (n) => `Make ${moneyM(n)}`,
  development: () => "Grow your young core",
};

function Line({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex justify-between gap-4">
      <span className="text-steel">{label}</span>
      <span className="tabular-nums">{value}</span>
    </li>
  );
}

/** The business side: tickets, budgets, the books and the owner. */
export function ClubTab({ f, team }: { f: Franchise; team: Team }) {
  const update = useFranchise((s) => s.update);
  const running = useFranchiseSim((s) => s.running);
  const b = f.finance[f.teamId];
  const rules = capRules(f.cap);
  const [price, setPrice] = useState(String(b.ticketPrice));
  const commitPrice = async () => {
    await update((x) => setTicketPrice(x, +price), []);
    const saved = useFranchise.getState().franchise;
    if (saved) setPrice(String(saved.finance[saved.teamId].ticketPrice));
  };
  const crowd = attendance(f, f.teamId, team.arena.capacity);
  const expenses = seasonExpenses(f, f.teamId);
  return (
    <div className="flex flex-col gap-5">
      <fieldset disabled={running} className="flex flex-col gap-5">
        <Panel title="Tickets">
          <label className="mb-2 flex items-center justify-between gap-4">
            Ticket price
            <input
              type="number"
              aria-label="Ticket price"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              onBlur={commitPrice}
              className="w-28 rounded-[var(--radius-chip)] bg-navy px-3 py-2 text-net ring-1 ring-line"
            />
          </label>
          <ul className="flex flex-col gap-1">
            <Line label={`Expected crowd at ${team.arena.name}`} value={`${crowd.toLocaleString("en-US")} of ${team.arena.capacity.toLocaleString("en-US")}`} />
            <Line label="Fan interest" value={String(Math.round(b.hype))} />
            <Line label="Facilities" value={String(Math.round(b.facilities))} />
          </ul>
        </Panel>
        <Panel title="Budgets">
          {BUDGETS.map((x) => (
            <div key={x.key}>
              <Slider
                label={x.label}
                value={b.budgets[x.key]}
                min={rules.budgetMin}
                max={rules.budgetMax}
                step={1_000_000}
                format={moneyM}
                onChange={(v) => update((y) => setBudget(y, x.key, v), [])}
              />
              <p className="-mt-1 mb-1 text-sm text-steel">{x.hint}</p>
            </div>
          ))}
        </Panel>
      </fieldset>
      <Panel title="The books">
        <ul className="flex flex-col gap-1">
          <Line label="Revenue so far" value={moneyM(b.season.revenue)} />
          <Line label="Expected expenses" value={moneyM(expenses)} />
          <Line label="Club balance" value={moneyM(b.balance)} />
        </ul>
        {b.lastSeason && (
          <>
            <h4 className="mt-3 font-semibold">Last season</h4>
            <ul className="flex flex-col gap-1">
              <Line label="Revenue" value={moneyM(b.lastSeason.revenue)} />
              <Line label="Expenses" value={moneyM(b.lastSeason.expenses)} />
              <Line label="Profit" value={moneyM(b.lastSeason.profit)} />
              <Line label="Average crowd" value={b.lastSeason.attendance.toLocaleString("en-US")} />
            </ul>
          </>
        )}
      </Panel>
      <Panel title="The owner">
        <p className="mb-2 font-semibold">Job security: {Math.round(f.job.security)} of 100</p>
        {f.job.goals.length > 0 && (
          <>
            <p className="text-steel">Your owner wants you to:</p>
            <ul className="list-inside list-disc">
              {f.job.goals.map((g) => (
                <li key={g.key}>{GOAL_NAME[g.key]?.(g.target)}</li>
              ))}
            </ul>
          </>
        )}
      </Panel>
    </div>
  );
}
