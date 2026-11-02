"use client";
import { useState } from "react";
import { formatDate } from "@/career/format";
import type { Franchise, NewsItem } from "@/franchise/types";
import { Panel, Segmented } from "@/ui/kit";

type Filter = "all" | "mine" | NewsItem["kind"];
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "mine", label: "My team" },
  { value: "trade", label: "Trades" },
  { value: "signing", label: "Signings" },
  { value: "injury", label: "Injuries" },
  { value: "upset", label: "Upsets" },
  { value: "milestone", label: "Milestones" },
];

/** The newest stories first, with the user's team highlighted. */
export function NewsList({ f, items }: { f: Franchise; items: NewsItem[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {[...items].reverse().map((n) => (
        <li key={n.id} className={n.teamIds.includes(f.teamId) ? "font-semibold" : ""}>
          <span className="text-sm text-steel">{formatDate(n.date)}:</span> {n.text}
        </li>
      ))}
    </ul>
  );
}

export function NewsPanel({ f }: { f: Franchise }) {
  const [filter, setFilter] = useState<Filter>("all");
  const items = f.news.filter((n) => filter === "all" || (filter === "mine" ? n.teamIds.includes(f.teamId) : n.kind === filter));
  return (
    <Panel title="News">
      <div className="mb-3">
        <Segmented label="Show" value={filter} options={FILTERS} onChange={setFilter} />
      </div>
      {items.length ? <NewsList f={f} items={items} /> : <p className="text-steel">Nothing here yet.</p>}
    </Panel>
  );
}
