"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { LEAGUES, loadLeague, teamLabel, type LeagueData } from "@/data/leagues";
import type { Team } from "@/engine/types";
import { createFranchise } from "@/franchise/create";
import { useFranchise } from "@/state/franchiseStore";
import { Button, PageShell, Panel } from "@/ui/kit";
import { TeamLogo } from "@/ui/TeamLogo";
import { toast } from "@/ui/Toaster";

export function FranchiseCreator() {
  const router = useRouter();
  const set = useFranchise((s) => s.set);
  const [data, setData] = useState<LeagueData | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadLeague("pro").then(setData);
  }, []);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.teams ?? [])
      .filter((t) => !needle || `${t.name} ${t.nickname} ${t.city} ${t.abbrev}`.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data, q]);

  const start = async () => {
    if (!team || !data) return;
    setBusy(true);
    const f = createFranchise({ league: "pro", team, teams: data.teams, seed: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
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
        <ul className="mb-4 flex flex-wrap gap-2" aria-label="Leagues">
          {LEAGUES.map((l) => (
            <li
              key={l.id}
              className={`rounded-[var(--radius-chip)] px-3 py-1 text-sm ring-1 ring-line ${l.id === "pro" ? "bg-deck-2 font-semibold" : "text-steel"}`}
            >
              {l.short}
              {l.id !== "pro" && " · Coming soon"}
            </li>
          ))}
        </ul>
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
              </button>
            </li>
          ))}
          {data && list.length === 0 && <li className="px-3 py-4 text-sm text-steel">No teams match. Try a shorter search.</li>}
        </ul>
        <div className="mt-4 flex justify-end">
          <Button onClick={start} disabled={!team || busy}>
            Start franchise
          </Button>
        </div>
      </Panel>
    </PageShell>
  );
}
