"use client";
import { DEFAULT_AUTO, defaultLeagueSettings } from "@/franchise/settings";
import type { LeagueSettings } from "@/franchise/types";
import { LeagueFields } from "../hub/SettingsTab";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { LEAGUES, loadLeague, teamLabel, type LeagueData } from "@/data/leagues";
import type { CollegeDivision, LeagueId, Team } from "@/engine/types";
import { createFranchise } from "@/franchise/create";
import { useFranchise } from "@/state/franchiseStore";
import { Button, PageShell, Panel, Segmented, Select } from "@/ui/kit";
import { TeamLogo } from "@/ui/TeamLogo";
import { toast } from "@/ui/Toaster";

/** Leagues Franchise runs so far. */
const READY: LeagueId[] = ["pro", "college"];
const DIVISIONS: { value: CollegeDivision; label: string }[] = [
  { value: "D1", label: "Division I" },
  { value: "D2", label: "Division II" },
  { value: "D3", label: "Division III" },
];
const ALL = "all";

export function FranchiseCreator() {
  const router = useRouter();
  const set = useFranchise((s) => s.set);
  const [leagueId, setLeagueId] = useState<LeagueId>("pro");
  const [division, setDivision] = useState<CollegeDivision>("D1");
  const [conference, setConference] = useState(ALL);
  const [data, setData] = useState<LeagueData | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [league, setLeague] = useState<LeagueSettings>(defaultLeagueSettings("pro"));

  useEffect(() => {
    let live = true;
    loadLeague(leagueId).then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [leagueId]);

  const pickLeague = (id: LeagueId) => {
    if (id === leagueId) return;
    setData(null);
    setTeam(null);
    setConference(ALL);
    setLeagueId(id);
    setLeague(defaultLeagueSettings(id));
  };

  const conferences = useMemo(
    () => (data?.conferences ?? []).filter((c) => leagueId !== "college" || c.tier === division).sort((a, b) => a.name.localeCompare(b.name)),
    [data, leagueId, division],
  );
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.teams ?? [])
      .filter((t) => t.league === leagueId)
      .filter((t) => leagueId !== "college" || t.tier === division)
      .filter((t) => conference === ALL || t.conferenceId === conference)
      .filter((t) => !needle || `${t.name} ${t.nickname} ${t.city} ${t.abbrev}`.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data, q, leagueId, division, conference]);

  const start = async () => {
    if (!team || !data) return;
    setBusy(true);
    // a college world takes a moment to build, so the button shows it's working first
    await new Promise((r) => setTimeout(r, 0));
    const f = createFranchise({
      league: leagueId,
      team,
      teams: data.teams,
      conferences: data.conferences,
      seed: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      // until the Recruiting tab is built, a college staff recruits for the user
      settings: { league, ...(leagueId === "college" ? { auto: { ...DEFAULT_AUTO, recruiting: true } } : {}) },
    });
    try {
      await set(f);
      router.push(`/franchise/hub/?id=${encodeURIComponent(f.id)}`);
    } catch {
      setBusy(false);
      toast("Couldn't save your franchise. This browser may be blocking saved data or be out of space.", "bad");
    }
  };

  return (
    <PageShell title="New franchise">
      <Panel>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Segmented
            label="League"
            value={leagueId}
            options={LEAGUES.filter((l) => READY.includes(l.id)).map((l) => ({ value: l.id, label: l.short }))}
            onChange={pickLeague}
          />
          {LEAGUES.filter((l) => !READY.includes(l.id)).map((l) => (
            <span key={l.id} className="text-sm text-steel">
              {l.short} · Coming soon
            </span>
          ))}
        </div>
        {leagueId === "college" && (
          <div className="mb-3 flex flex-wrap items-center gap-4">
            <Segmented
              label="Division"
              value={division}
              options={DIVISIONS}
              onChange={(d) => {
                setDivision(d);
                setConference(ALL);
                setTeam(null);
              }}
            />
            <div className="min-w-64 flex-1">
              <Select
                label="Conference"
                value={conference}
                options={[{ value: ALL, label: "All conferences" }, ...conferences.map((c) => ({ value: c.id, label: c.name }))]}
                onChange={setConference}
              />
            </div>
          </div>
        )}
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${list.length} teams`}
          aria-label="Search teams"
          className="w-full rounded-[var(--radius-chip)] bg-navy px-3 py-2 ring-1 ring-line placeholder:text-steel"
        />
        <ul className="scrollbar-thin mt-3 max-h-96 overflow-y-auto rounded-[var(--radius-chip)] ring-1 ring-line" aria-label="Team list">
          {list.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => setTeam(t)}
                aria-pressed={team?.id === t.id}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-deck-2 ${team?.id === t.id ? "bg-deck-2" : ""}`}
              >
                <TeamLogo team={t} size={28} />
                <span className="flex-1 truncate">{teamLabel(t)}</span>
                {leagueId !== "pro" && <span className="text-xs text-steel">{Math.round(t.prestige * 100)} prestige</span>}
              </button>
            </li>
          ))}
          {data && list.length === 0 && <li className="px-3 py-4 text-sm text-steel">No teams match. Try a shorter search.</li>}
          {!data && <li className="px-3 py-4 text-sm text-steel">Loading teams…</li>}
        </ul>
        <details className="mt-4">
          <summary className="cursor-pointer font-semibold">League settings</summary>
          <div className="mt-2">
            <LeagueFields league={leagueId} value={league} onChange={(patch) => setLeague((l) => ({ ...l, ...patch }))} />
          </div>
        </details>
        <div className="mt-4 flex justify-end">
          <Button onClick={start} disabled={!team || busy}>
            {busy ? "Building the league…" : "Start franchise"}
          </Button>
        </div>
      </Panel>
    </PageShell>
  );
}
