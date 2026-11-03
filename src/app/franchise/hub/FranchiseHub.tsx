"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDate } from "@/career/format";
import { teamLabel } from "@/data/leagues";
import { undoMove } from "@/franchise/core/moves";
import { inRecord } from "@/franchise/club/owner";
import { leagueModule, type LeagueModule } from "@/franchise/leagues";
import { worldTeams } from "@/franchise/world";
import { applyFranchiseResult } from "@/state/franchiseResult";
import { stopFranchiseSim, useFranchiseSim } from "@/state/franchiseSim";
import { useFranchise } from "@/state/franchiseStore";
import { Button, PageShell, Panel } from "@/ui/kit";
import { toast } from "@/ui/Toaster";
import { pruneSaves, useLeagueTeams, useRosterMove } from "./actions";
import { ClubTab } from "./ClubTab";
import { CoachingTab } from "./CoachingTab";
import { DraftTab } from "./DraftTab";
import { FreeAgentsTab } from "./FreeAgentsTab";
import { HomeTab } from "./HomeTab";
import { LeadersTab } from "./LeadersTab";
import { LeagueTab } from "./LeagueTab";
import { OffseasonTab } from "./OffseasonTab";
import { PlayoffsTab } from "./PlayoffsTab";
import { ProgramTab } from "./ProgramTab";
import { RecruitingTab } from "./RecruitingTab";
import { RosterTab } from "./RosterTab";
import { ScheduleTab } from "./ScheduleTab";
import { SettingsTab } from "./SettingsTab";
import { StandingsTab } from "./StandingsTab";
import { TradesTab } from "./TradesTab";

const PRO_TABS = [
  "Home",
  "Offseason",
  "Schedule",
  "Roster",
  "Coaching",
  "Trades",
  "Free agents",
  "Draft",
  "Club",
  "League",
  "Standings",
  "Leaders",
  "Playoffs",
  "Settings",
] as const;
const SCHOOL_TABS = [
  "Home",
  "Offseason",
  "Schedule",
  "Roster",
  "Coaching",
  "Recruiting",
  "Program",
  "League",
  "Standings",
  "Leaders",
  "Postseason",
  "Settings",
] as const;
type Tab = (typeof PRO_TABS)[number] | (typeof SCHOOL_TABS)[number];

/** The sections a league has: schools recruit and answer to a program, pros trade and run a club. */
export function tabsFor(m: LeagueModule): readonly Tab[] {
  if (m.systems.cap) return PRO_TABS;
  return SCHOOL_TABS.filter((t) => t !== "Recruiting" || m.systems.recruiting);
}

export function FranchiseHub() {
  const id = useSearchParams().get("id");
  const { franchise, team, status, error, open } = useFranchise();
  const move = useRosterMove();

  // the sim takes the whole league; screens show the teams with real players
  const all = useLeagueTeams(franchise);
  const teams = useMemo(() => (all && franchise ? worldTeams(all, franchise.world) : null), [all, franchise]);
  const sim = useFranchiseSim();
  const [tab, setTab] = useState<Tab>("Home");
  const prepared = useRef<string | null>(null);

  useEffect(() => {
    if (id) open(id);
  }, [id, open]);

  // record a game you just played, once the save and league are loaded
  useEffect(() => {
    if (status !== "ready" || !franchise || !all || franchise.id !== id || prepared.current === id) return;
    prepared.current = id;
    applyFranchiseResult(franchise, all!).then((outcome) => {
      if (outcome === "unused") toast("That game was already decided, so this result wasn't used.", "bad");
    });
  }, [status, franchise, all, id]);

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
  if (!franchise || !team || !teams || !all)
    return (
      <PageShell title="Franchise">
        <p className="text-steel" role="status">
          Loading your franchise…
        </p>
      </PageShell>
    );

  const record = franchise.season.games.reduce(
    (r, g) => {
      if (!g.result || !inRecord(franchise, g) || (g.homeId !== franchise.teamId && g.awayId !== franchise.teamId)) return r;
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
      {franchise.undo && (
        <div className="mb-4 flex items-center gap-3 rounded-[var(--radius-chip)] bg-deck p-3 ring-1 ring-line" role="status">
          <span className="flex-1">{franchise.undo.label}</span>
          <Button variant="secondary" disabled={sim.running} onClick={() => move(null, undoMove)}>
            Undo
          </Button>
        </div>
      )}
      <nav aria-label="Franchise sections" role="tablist" className="mb-5 flex flex-wrap gap-1">
        {tabsFor(leagueModule(franchise.league))
          .filter((t) => t !== "Offseason" || franchise.offseason)
          .map((t) => (
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
      {(tab === "Home" || (tab === "Offseason" && !franchise.offseason)) && <HomeTab f={franchise} teams={all} onOffseason={() => setTab("Offseason")} />}
      {tab === "Offseason" && <OffseasonTab f={franchise} teams={all} />}
      {tab === "Schedule" && <ScheduleTab f={franchise} teams={teams} team={team} />}
      {tab === "Roster" && <RosterTab f={franchise} />}
      {tab === "Coaching" && <CoachingTab f={franchise} />}
      {tab === "Trades" && <TradesTab f={franchise} teams={teams} />}
      {tab === "Free agents" && <FreeAgentsTab f={franchise} />}
      {tab === "Settings" && <SettingsTab f={franchise} />}
      {tab === "League" && <LeagueTab f={franchise} teams={teams} />}
      {tab === "Club" && <ClubTab f={franchise} team={team} />}
      {tab === "Draft" && <DraftTab f={franchise} teams={teams} />}
      {tab === "Standings" && <StandingsTab f={franchise} teams={teams} all={all} />}
      {tab === "Leaders" && <LeadersTab f={franchise} teams={teams} />}
      {(tab === "Playoffs" || tab === "Postseason") && <PlayoffsTab f={franchise} teams={teams} />}
      {tab === "Recruiting" && <RecruitingTab f={franchise} teams={teams} />}
      {tab === "Program" && <ProgramTab f={franchise} teams={all} team={team} />}
    </PageShell>
  );
}
