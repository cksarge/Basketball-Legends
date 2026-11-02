"use client";
import { moneyM, payroll, taxBill } from "@/franchise/pro/cap";
import { capRules } from "@/franchise/pro/rules";
import type { Franchise } from "@/franchise/types";
import { Panel } from "@/ui/kit";

/** Where the team stands against the cap. */
export function CapPanel({ f }: { f: Franchise }) {
  const rules = capRules(f.cap);
  const pay = payroll(f, f.teamId);
  const books = f.books[f.teamId];
  const tax = taxBill(pay, rules);
  const lines: [string, number][] = [
    ["Salary cap", rules.salaryCap],
    ["Tax line", rules.taxLine],
    ["First apron", rules.firstApron],
    ["Second apron", rules.secondApron],
  ];
  const usable = pay < rules.firstApron ? rules.midLevel : pay < rules.secondApron ? rules.taxMidLevel : 0;
  return (
    <Panel title="Cap sheet">
      <p className="mb-2 font-display text-2xl font-black">Payroll {moneyM(pay)}</p>
      <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {lines.map(([label, value]) => (
          <li key={label} className="flex justify-between">
            <span className="text-steel">{label}</span>
            <span className={`tabular-nums ${pay > value ? "text-amber" : ""}`}>{moneyM(value)}</span>
          </li>
        ))}
        <li className="flex justify-between">
          <span className="text-steel">Mid-level left</span>
          <span className="tabular-nums">{moneyM(Math.max(0, usable - books.midLevelUsed))}</span>
        </li>
        <li className="flex justify-between">
          <span className="text-steel">Tax bill at season&apos;s end</span>
          <span className="tabular-nums">{moneyM(tax)}</span>
        </li>
      </ul>
      {books.dead.length > 0 && (
        <>
          <h4 className="mt-3 font-semibold">Dead money</h4>
          <ul className="flex flex-col gap-1 text-sm">
            {books.dead.map((d) => (
              <li key={d.playerId} className="flex justify-between">
                <span>{d.name}</span>
                <span className="tabular-nums">
                  {moneyM(d.salary)} × {d.years}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
