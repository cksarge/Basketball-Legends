"use client";
import { useMemo, useState } from "react";
import type { Career } from "@/career/types";
import { formatDate } from "@/career/format";
import type { HsContext } from "@/career/hs/season";
import { calendarItems } from "@/career/timeline";
import { Button, Panel } from "@/ui/kit";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A month at a time: your games, results and the dates that matter. */
export function CalendarView({ career, ctx }: { career: Career; ctx: HsContext }) {
  const items = useMemo(() => calendarItems(career, ctx), [career, ctx]);
  const [offset, setOffset] = useState(0);
  const y0 = +career.date.slice(0, 4);
  const m0 = +career.date.slice(5, 7) - 1;
  const year = y0 + Math.floor((m0 + offset) / 12);
  const month = (((m0 + offset) % 12) + 12) % 12;
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const iso = (d: number) => `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const list = items.filter((i) => i.date.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`));
  return (
    <Panel>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Button variant="secondary" aria-label="Previous month" onClick={() => setOffset((o) => o - 1)}>
          ←
        </Button>
        <h2 className="font-display text-2xl font-black">
          {MONTHS[month]} {year}
        </h2>
        <Button variant="secondary" aria-label="Next month" onClick={() => setOffset((o) => o + 1)}>
          →
        </Button>
      </div>
      <div className="hidden grid-cols-7 gap-1 text-xs sm:grid" role="grid" aria-label={`${MONTHS[month]} ${year}`}>
        {DAYS.map((d) => (
          <div key={d} role="columnheader" className="px-1 pb-1 font-semibold text-steel">
            {d}
          </div>
        ))}
        {Array.from({ length: first }, (_, i) => (
          <div key={`e${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const day = iso(i + 1);
          const here = items.filter((x) => x.date === day);
          const today = day === career.date;
          return (
            <div key={day} role="gridcell" className={`min-h-16 rounded bg-deck-2 p-1 ${today ? "ring-2 ring-amber" : ""}`}>
              <span className="text-steel">{i + 1}</span>
              {here.map((x, n) => (
                <p key={n} className={`leading-tight ${x.kind === "key" ? "font-semibold text-amber" : ""}`}>
                  {x.result && <b className={x.result === "W" ? "text-good" : "text-bad"}>{x.result} </b>}
                  {x.label}
                </p>
              ))}
            </div>
          );
        })}
      </div>
      {/* small screens get a list: seven columns won't fit */}
      <ul className="flex flex-col gap-1 text-sm sm:hidden">
        {list.length === 0 && <li className="text-steel">Nothing on the calendar this month.</li>}
        {list.map((x, i) => (
          <li key={i} className="flex justify-between gap-3 border-t border-line/60 py-1">
            <span className={x.kind === "key" ? "font-semibold text-amber" : ""}>{x.label}</span>
            <span className="text-steel">
              {x.result ? `${x.result} ${x.score} · ` : ""}
              {formatDate(x.date).replace(/, \d{4}$/, "")}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
