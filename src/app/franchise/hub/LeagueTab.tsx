"use client";
import { useState } from "react";
import type { Team } from "@/engine/types";
import type { Franchise } from "@/franchise/types";
import { Segmented } from "@/ui/kit";
import { HallPanel } from "./HallPanel";
import { HistoryPanel } from "./HistoryPanel";
import { NewsPanel } from "./NewsPanel";
import { PowerPanel } from "./PowerPanel";
import { RecordsPanel } from "./RecordsPanel";

const SECTIONS = ["News", "Power rankings", "History", "Records", "Hall of Fame"] as const;
type Section = (typeof SECTIONS)[number];

export function LeagueTab({ f, teams }: { f: Franchise; teams: Team[] }) {
  const [section, setSection] = useState<Section>("News");
  return (
    <div className="flex flex-col gap-5">
      <Segmented label="League section" value={section} options={SECTIONS.map((s) => ({ value: s, label: s }))} onChange={setSection} />
      {section === "News" && <NewsPanel f={f} />}
      {section === "Power rankings" && <PowerPanel f={f} teams={teams} />}
      {section === "History" && <HistoryPanel f={f} teams={teams} />}
      {section === "Records" && <RecordsPanel f={f} />}
      {section === "Hall of Fame" && <HallPanel f={f} teams={teams} />}
    </div>
  );
}
