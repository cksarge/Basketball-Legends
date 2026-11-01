"use client";
import { useMemo, useState } from "react";
import type { Career } from "@/career/types";
import { formatDate } from "@/career/format";
import { PILLARS, legendStatus } from "@/career/legend";
import { HALL_OF_LEGENDS, HALL_STATS, allTimeRank, careerTotals, nextToPass, type HallKey } from "@/career/pro/retire";
import { money } from "@/career/pro/season";
import { Panel, Segmented } from "@/ui/kit";

/** The end of the road: the verdict, the ceremonies and your speech. */
export function RetiredHome({ career }: { career: Career }) {
  const r = career.retirement;
  if (!r) return <Panel title="Retired">Your career is over.</Panel>;
  const name = `${career.player.firstName} ${career.player.lastName}`;
  return (
    <>
      <Panel>
        <p className="text-sm text-steel">{formatDate(r.date)}</p>
        {r.legend ? (
          <>
            <p className="font-display text-5xl font-black text-amber">Basketball Legend</p>
            <p className="mt-2">{name} is one of the very few. Your name is on the Hall of Legends forever.</p>
          </>
        ) : (
          <>
            <p className="font-display text-4xl font-black text-amber">{r.rank}</p>
            <p className="mt-2">
              {name} retires at {r.age} with {r.points.toLocaleString("en-US")} Legend points. The Legend title takes more than this, and it&apos;s only ever
              given to an Icon. What a career, all the same.
            </p>
          </>
        )}
      </Panel>
      <Panel title="The ceremonies">
        <p className="mb-2">{r.hallOfFame ? "Elected to the Hall of Fame." : "The Hall of Fame vote didn't go your way."}</p>
        {r.jerseys.length > 0 ? (
          <ul className="flex flex-col gap-1 text-amber">
            {r.jerseys.map((j) => (
              <li key={j}>
                {j} retired number {career.player.jersey}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-steel">Nobody has hung your number yet.</p>
        )}
      </Panel>
      <Panel title="Your speech">
        <blockquote className="italic">&ldquo;{r.speech}&rdquo;</blockquote>
      </Panel>
      <Panel title="Final numbers">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          {(
            [
              ["Games", r.totals.games],
              ["Points", r.totals.pts],
              ["Rebounds", r.totals.reb],
              ["Assists", r.totals.ast],
              ["Championships", r.totals.rings],
              ["MVPs", r.totals.mvps],
              ["All-Star selections", r.totals.allStars],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <dt className="text-steel">{k}</dt>
              <dd className="font-semibold tabular-nums">{v.toLocaleString("en-US")}</dd>
            </div>
          ))}
          <div className="flex justify-between">
            <dt className="text-steel">Earned</dt>
            <dd className="font-semibold tabular-nums">{money(career.pro?.earnings ?? 0)}</dd>
          </div>
        </dl>
      </Panel>
    </>
  );
}

/** The Hall of Legends: the all-time greats, where you'd stand among them, and everything that built your legacy. */
export function LegendsTab({ career }: { career: Career }) {
  const [key, setKey] = useState<HallKey>("pts");
  const totals = useMemo(() => careerTotals(career), [career]);
  const st = useMemo(() => legendStatus(career), [career]);
  const you = { name: `${career.player.firstName} ${career.player.lastName}`, era: "You", ...totals };
  const list = [...HALL_OF_LEGENDS, you].sort((a, b) => b[key] - a[key]);
  const next = nextToPass(totals, key);
  const label = HALL_STATS.find((s) => s.key === key)!.label;
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="Hall of Legends">
        <div className="mb-3">
          <Segmented label="Record" value={key} options={HALL_STATS.map((s) => ({ value: s.key, label: s.label }))} onChange={setKey} />
        </div>
        <p className="mb-3 text-sm text-steel">
          {career.stage === "hs" || career.stage === "college"
            ? "Pro numbers only. Your name goes on this list when you turn pro."
            : `You're No. ${allTimeRank(totals, key)} all time.`}
          {next && career.pro ? ` ${next.gap.toLocaleString("en-US")} behind ${next.name}.` : ""}
        </p>
        <ol className="flex flex-col text-sm tabular-nums" aria-label={`All-time ${label}`}>
          {list.map((h, i) => (
            <li key={h.name} className={`flex justify-between gap-3 border-t border-line/60 py-1.5 ${h.era === "You" ? "font-semibold text-amber" : ""}`}>
              <span>
                {i + 1}. {h.name} <span className="text-xs text-steel">{h.era}</span>
              </span>
              <span>{h[key].toLocaleString("en-US")}</span>
            </li>
          ))}
        </ol>
      </Panel>
      <Panel title="Your legacy">
        <p className="mb-3 text-sm text-steel">
          {st.points.toLocaleString("en-US")} Legend points: {PILLARS.map((p) => `${st.pillars[p.id]} ${p.label}`).join(", ")}.
        </p>
        {st.events.length === 0 && <p className="text-steel">Nothing yet. Go make some history.</p>}
        <ul className="flex max-h-[32rem] flex-col gap-1 overflow-y-auto pr-1 text-sm">
          {[...st.events].reverse().map((e, i) => (
            <li key={`${e.date}-${e.text}-${i}`} className="flex justify-between gap-3 border-t border-line/60 py-1">
              <span>
                {e.text} <span className="text-xs text-steel">{formatDate(e.date)}</span>
              </span>
              <span className="flex-none text-amber">+{e.points}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
