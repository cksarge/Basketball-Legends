"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatDate } from "@/career/format";
import { teamLabel } from "@/data/leagues";
import { applyFranchiseResult } from "@/state/franchiseResult";
import { stopFranchiseSim, useFranchiseSim } from "@/state/franchiseSim";
import { useFranchise } from "@/state/franchiseStore";
import { Button, PageShell, Panel } from "@/ui/kit";
import { toast } from "@/ui/Toaster";
import { pruneSaves, useLeagueTeams } from "./actions";
import { CoachingTab } from "./CoachingTab";
import { DraftTab } from "./DraftTab";
import { HomeTab } from "./HomeTab";
import { LeadersTab } from "./LeadersTab";
import { OffseasonTab } from "./OffseasonTab";
import { PlayoffsTab } from "./PlayoffsTab";
import { RosterTab } from "./RosterTab";
import { ScheduleTab } from "./ScheduleTab";
import { StandingsTab } from "./StandingsTab";

const TABS = ["Home", "Offseason", "Schedule", "Roster", "Coaching", "Draft", "Standings", "Leaders", "Playoffs"] as const;
type Tab = (typeof TABS)[number];

export function FranchiseHub() {
  const id = useSearchParams().get("id");
  const { franchise, team, status, error, open } = useFranchise();

  const teams = useLeagueTeams(franchise);
  const sim = useFranchiseSim();
  const [tab, setTab] = useState<Tab>("Home");
  const prepared = useRef<string | null>(null);

  useEffect(() => {
    if (id) open(id);
  }, [id, open]);

  // record a game you just played, once the save and league are loaded
  useEffect(() => {
    if (status !== "ready" || !franchise || !teams || franchise.id !== id || prepared.current === id) return;
    prepared.current = id;
    applyFranchiseResult(franchise, teams).then((outcome) => {
      if (outcome === "unused") toast("That game was already decided, so this result wasn't used.", "bad");
    });
  }, [status, franchise, teams, id]);

  // a game simmed from the hub can't be resumed anymore, so any save of it goes
  useEffect(() => {
    if (franchise && franchise.id === id) pruneSaves(franchise);
  }, [franchise, id]);

  if (status === "stale")
    return (
      <PageShell title="Franchise">
        <Panel>
          <p className="mb-4">This franchise was changed in another tab. Reload to continue.</p>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </Panel>
      </PageShell>
    );
  if (status === "missing" || !id)
    return (
      <PageShell title="Franchise">
        <Panel>
          <p className="mb-4">That franchise isn&apos;t saved in this browser.</p>
          <Link href="/franchise/" className="text-amber underline">
            Back to your franchises
          </Link>
        </Panel>
      </PageShell>
    );
  if (status === "error" && !franchise)
    return (
      <PageShell title="Franchise">
        <Panel>
          <p role="alert">{error ?? "Couldn't open this franchise."}</p>
        </Panel>
      </PageShell>
    );
  if (!franchise || !team || !teams)
    return (
      <PageShell title="Franchise">
        <p className="text-steel" role="status">
          Loading your franchise…
        </p>
      </PageShell>
    );

  const record = franchise.season.games.reduce(
    (r, g) => {
      if (!g.result || g.kind !== "region" || (g.homeId !== franchise.teamId && g.awayId !== franchise.teamId)) return r;
      return g.result.home > g.result.away === (g.homeId === franchise.teamId) ? { ...r, w: r.w + 1 } : { ...r, l: r.l + 1 };
    },
    { w: 0, l: 0 },
  );

  return (
    <PageShell title={teamLabel(team)} back="/franchise/" backLabel="Franchises" wide>
      {error && (
        <p className="mb-4 text-sm text-amber" role="alert">
          {error}
        </p>
      )}
      <p className="mb-4 text-steel">
        {franchise.season.year}-{String(franchise.season.year + 1).slice(2)} · {record.w}-{record.l} · {formatDate(franchise.date)}
      </p>
      {sim.running && (
        <div className="mb-4 flex items-center gap-3 rounded-[var(--radius-chip)] bg-deck p-3 ring-1 ring-line" role="status">
          <span className="flex-1">Simulating{sim.date ? `: ${formatDate(sim.date)}` : "…"}</span>
          <Button variant="secondary" onClick={stopFranchiseSim}>
            Stop
          </Button>
        </div>
      )}
      <nav aria-label="Franchise sections" role="tablist" className="mb-5 flex flex-wrap gap-1">
        {TABS.filter((t) => t !== "Offseason" || franchise.offseason).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-[var(--radius-chip)] px-4 py-2 font-display text-lg font-bold ${tab === t ? "bg-amber text-navy" : "bg-deck text-steel ring-1 ring-line hover:text-net"}`}
          >
            {t}
          </button>
        ))}
      </nav>
      {(tab === "Home" || (tab === "Offseason" && !franchise.offseason)) && <HomeTab f={franchise} teams={teams} onOffseason={() => setTab("Offseason")} />}
      {tab === "Offseason" && <OffseasonTab f={franchise} teams={teams} />}
      {tab === "Schedule" && <ScheduleTab f={franchise} teams={teams} team={team} />}
      {tab === "Roster" && <RosterTab f={franchise} />}
      {tab === "Coaching" && <CoachingTab f={franchise} />}
      {tab === "Draft" && <DraftTab f={franchise} teams={teams} />}
      {tab === "Standings" && <StandingsTab f={franchise} teams={teams} />}
      {tab === "Leaders" && <LeadersTab f={franchise} teams={teams} />}
      {tab === "Playoffs" && <PlayoffsTab f={franchise} teams={teams} />}
    </PageShell>
  );
}
