"use client";
// Pick anyone for a park game: one of this park's regulars, or any player from the three leagues.
import { useEffect, useMemo, useState } from "react";
import { generateRoster, heightStr, playerOvr } from "@/engine/player";
import type { LeagueId, Player, Team } from "@/engine/types";
import { LEAGUES, loadLeague } from "@/data/leagues";
import type { Regular } from "@/game/park/regulars";
import { Button, Segmented, Select } from "@/ui/kit";

export function PlayerPicker({
  title,
  regulars,
  taken,
  onPick,
  onClose,
}: {
  title: string;
  regulars: Regular[];
  /** Players already in the game (they can't be picked twice). */
  taken: Set<string>;
  onPick: (p: Player) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"regulars" | "league">("regulars");
  const [league, setLeague] = useState<LeagueId>("pro");
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let live = true;
    loadLeague(league).then((d) => {
      if (!live) return;
      const sorted = [...d.teams].sort((a, b) => a.name.localeCompare(b.name));
      setTeams(sorted);
      setTeamId(sorted[0]?.id ?? "");
    });
    return () => {
      live = false;
    };
  }, [league]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shownTeams = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? teams.filter((t) => `${t.name} ${t.nickname}`.toLowerCase().includes(q)) : teams;
  }, [teams, query]);
  const team = teams.find((t) => t.id === teamId) ?? shownTeams[0];
  const roster = useMemo(() => (team ? generateRoster(team).sort((a, b) => playerOvr(b) - playerOvr(a)) : []), [team]);

  const row = (p: Player, extra?: string) => (
    <li key={p.id}>
      <button
        disabled={taken.has(p.id)}
        onClick={() => onPick(p)}
        className="flex w-full items-center gap-3 rounded-[var(--radius-chip)] bg-deck-2 px-3 py-2 text-left ring-1 ring-line hover:ring-amber disabled:opacity-40"
      >
        <span className="w-10 font-display text-2xl font-black text-amber">{playerOvr(p)}</span>
        <span className="flex-1">
          <span className="block font-semibold">
            {p.firstName} {p.lastName}
          </span>
          <span className="block text-xs text-steel">
            {p.pos} · {heightStr(p.heightIn)} · {p.age} yrs{extra ? ` · ${extra}` : ""}
          </span>
        </span>
      </button>
    </li>
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-navy/80 p-4 backdrop-blur" data-nav-scope="modal" role="dialog" aria-label={title}>
      <div className="flex max-h-[min(44rem,92dvh)] w-full max-w-xl flex-col rounded-[var(--radius-panel)] bg-deck p-5 ring-1 ring-line">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-black">{title}</h2>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        <Segmented
          label="Choose from"
          value={tab}
          onChange={setTab}
          options={[
            { value: "regulars", label: "Park regulars" },
            { value: "league", label: "League players" },
          ]}
        />
        {tab === "league" && (
          <div className="mt-3 flex flex-col gap-2">
            <Select<LeagueId> label="League" value={league} onChange={setLeague} options={LEAGUES.map((l) => ({ value: l.id, label: l.name }))} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search teams"
              aria-label="Search teams"
              className="rounded-[var(--radius-chip)] bg-deck-2 px-3 py-2 ring-1 ring-line"
            />
            <Select<string>
              label="Team"
              value={team?.id ?? ""}
              onChange={setTeamId}
              options={shownTeams.slice(0, 400).map((t) => ({ value: t.id, label: `${t.name} ${t.nickname}` }))}
            />
          </div>
        )}
        <ul className="scrollbar-thin mt-3 flex flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
          {tab === "regulars" ? regulars.map((r) => row(r.player, `“${r.nickname}” · ${r.rep}`)) : roster.map((p) => row(p))}
        </ul>
      </div>
    </div>
  );
}
