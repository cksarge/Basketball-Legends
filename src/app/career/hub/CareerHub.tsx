"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { playerOvr } from "@/engine/player";
import { formatDate, GRADE_LABEL, LEVEL_SHORT, stageLabel } from "@/career/format";
import { currentSeason } from "@/career/hs/season";
import { useCareer } from "@/state/careerStore";
import { PageShell, Panel } from "@/ui/kit";
import { applyFinishedMatch, ensureSeason, useHsContext } from "./actions";
import { HomeTab } from "./HomeTab";
import { ScheduleTab } from "./ScheduleTab";
import { StatsTab } from "./StatsTab";
import { TeamTab } from "./TeamTab";
import { PlayerTab } from "./PlayerTab";
import { SettingsTab } from "./SettingsTab";

export const HUB_TABS = ["Home", "Schedule", "Stats", "Team", "Player", "Settings"] as const;
export type HubTab = (typeof HUB_TABS)[number];

export function CareerHub() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const { career, team, status, error, open } = useCareer();
  const ctx = useHsContext();
  const [tab, setTab] = useState<HubTab>("Home");
  const prepared = useRef<string | null>(null);

  useEffect(() => {
    if (id) open(id);
  }, [id, open]);

  // once the career and league are loaded: record a game you just played, and start the school year if needed
  useEffect(() => {
    if (!ctx || !career || career.id !== id || prepared.current === id) return;
    prepared.current = id;
    (async () => {
      await applyFinishedMatch(ctx);
      await ensureSeason(ctx);
    })();
  }, [ctx, career, id]);

  if (!id || status === "missing") {
    return (
      <PageShell title="Career" back="/career/" backLabel="Careers">
        <Panel>
          <p className="mb-4">That career isn&apos;t saved in this browser.</p>
          <Link href="/career/" className="text-amber underline">
            See your careers
          </Link>
        </Panel>
      </PageShell>
    );
  }
  if (status === "error") {
    return (
      <PageShell title="Career" back="/career/" backLabel="Careers">
        <Panel>
          <p className="text-bad">Couldn&apos;t open this career: {error}</p>
        </Panel>
      </PageShell>
    );
  }
  if (!career || career.id !== id || !ctx) {
    return (
      <PageShell title="Career" back="/career/" backLabel="Careers">
        <p className="text-steel" role="status">
          Loading your career…
        </p>
      </PageShell>
    );
  }

  const p = career.player;
  const s = currentSeason(career);
  const unread = career.inbox.filter((m) => !m.read).length;
  return (
    <PageShell title={`${p.firstName} ${p.lastName}`} back="/career/" backLabel="Careers" wide>
      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-steel">
        <span>
          #{p.jersey} · {p.pos} · {p.archetype}
        </span>
        {team && (
          <span>
            {team.name} {team.nickname}
            {s?.tryout && ` · ${LEVEL_SHORT[s.level]}`}
          </span>
        )}
        <span>
          {s ? GRADE_LABEL[s.grade] : stageLabel(career.stage)} · {formatDate(career.date)}
        </span>
        <span className="ml-auto flex items-baseline gap-4">
          {p.skillPoints > 0 && (
            <button onClick={() => setTab("Player")} className="rounded-full bg-amber/15 px-3 py-1 text-sm font-semibold text-amber ring-1 ring-amber/50">
              {p.skillPoints} skill point{p.skillPoints > 1 ? "s" : ""} to spend
            </button>
          )}
          <span className="font-display text-3xl font-black text-amber">
            {playerOvr(p)} <span className="text-sm font-semibold text-steel">OVR</span>
          </span>
        </span>
      </div>
      <nav aria-label="Career sections" role="tablist" className="mb-5 flex flex-wrap gap-1">
        {HUB_TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-[var(--radius-chip)] px-4 py-2 font-display text-lg font-bold ${tab === t ? "bg-amber text-navy" : "bg-deck text-steel ring-1 ring-line hover:text-net"}`}
          >
            {t}
            {t === "Home" && unread > 0 && <span className="ml-1.5 rounded-full bg-bad px-1.5 text-xs text-white">{unread}</span>}
          </button>
        ))}
      </nav>
      {tab === "Home" && <HomeTab career={career} ctx={ctx} />}
      {tab === "Schedule" && <ScheduleTab career={career} ctx={ctx} />}
      {tab === "Stats" && <StatsTab career={career} ctx={ctx} />}
      {tab === "Team" && <TeamTab career={career} ctx={ctx} />}
      {tab === "Player" && <PlayerTab career={career} />}
      {tab === "Settings" && <SettingsTab career={career} />}
    </PageShell>
  );
}
