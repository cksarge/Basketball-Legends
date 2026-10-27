"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { LeagueId, Player, Team, TeamTactics } from "@/engine/types";
import { overall } from "@/engine/player";
import { LEAGUES, loadAllLeagues, type LeagueData, rosterFor, tierLabel } from "@/data/leagues";
import { useMatchStore, type PendingMatch } from "@/state/matchStore";
import { useSettings } from "@/state/settings";
import { DIFFICULTY_LEVELS, type Difficulty } from "@/game/sim/state";
import { DEFAULT_TACTICS, Match } from "@/game/sim/match";
import { simulateToEnd } from "@/game/simulate";
import { audio } from "@/audio/engine";
import type { UniformStyle } from "@/game3d/character/uniformTexture";
import { uniformColors } from "@/game3d/character/uniformTexture";
import type { ArenaKind } from "@/game3d/Arena";
import { TeamLogo } from "@/ui/TeamLogo";
import { BoxScoreTable } from "@/ui/BoxScore";
import { Button, PageShell, Panel, Segmented, Select, Toggle } from "@/ui/kit";
import { toast } from "@/ui/Toaster";
import { TacticsPanel } from "@/ui/TacticsPanel";

type Side = "away" | "home";

function teamRating(roster: Player[]) {
  const top = roster.map((p) => overall(p.ratings, p.pos)).sort((a, b) => b - a).slice(0, 8);
  return Math.round(top.reduce((a, b) => a + b, 0) / Math.max(1, top.length));
}

function stars(prestige: number) {
  const n = Math.max(1, Math.min(5, Math.round(prestige * 5 + 0.3)));
  return "★".repeat(n) + "☆".repeat(5 - n);
}

const QUARTER_OPTIONS: Record<LeagueId, number[]> = {
  pro: [2, 3, 4, 5, 6, 8, 10, 12],
  college: [4, 6, 8, 10, 12, 16, 20],
  hs: [2, 3, 4, 5, 6, 8],
};

export function QuickPlay() {
  const router = useRouter();
  const params = useSearchParams();
  const practice = params.get("practice") === "1";
  const settings = useSettings();
  const setSettings = useSettings((s) => s.set);
  const setPending = useMatchStore((s) => s.setPending);
  const [data, setData] = useState<Record<LeagueId, LeagueData> | null>(null);
  const [teams, setTeams] = useState<Record<Side, Team | null>>({ away: null, home: null });
  const [uniforms, setUniforms] = useState<Record<Side, UniformStyle>>({ away: "away", home: "home" });
  const [assign, setAssign] = useState<Record<string, Side | "cpu">>({ keyboard: "home" });
  const [pads, setPads] = useState<number[]>([]);
  const [arenaChoice, setArenaChoice] = useState<ArenaKind | "auto">("auto");
  const [tactics, setTactics] = useState<Record<Side, TeamTactics>>({ away: { ...DEFAULT_TACTICS }, home: { ...DEFAULT_TACTICS } });
  const [simResult, setSimResult] = useState<Match | null>(null);
  const [simming, setSimming] = useState<number | null>(null);

  useEffect(() => {
    loadAllLeagues().then((d) => {
      setData(d);
      const phx = d.pro.teams.find((t) => t.id === "pro-phx")!;
      const away = d.pro.teams.find((t) => t.id === "pro-bos")!;
      setTeams({ home: phx, away });
    });
  }, []);

  // gamepads come and go
  useEffect(() => {
    const scan = () => setPads([...(navigator.getGamepads?.() ?? [])].filter((p): p is Gamepad => !!p && p.connected).map((p) => p.index));
    scan();
    window.addEventListener("gamepadconnected", scan);
    window.addEventListener("gamepaddisconnected", scan);
    const h = setInterval(scan, 1500);
    return () => { window.removeEventListener("gamepadconnected", scan); window.removeEventListener("gamepaddisconnected", scan); clearInterval(h); };
  }, []);

  const league: LeagueId = teams.home?.league ?? "pro";
  const quarterOpts = QUARTER_OPTIONS[league];
  const quarter = quarterOpts.includes(settings.gameplay.quarterMinutes) ? settings.gameplay.quarterMinutes : quarterOpts[Math.min(4, quarterOpts.length - 1)];
  const arena: ArenaKind = arenaChoice !== "auto" ? arenaChoice : teams.home?.league === "hs" ? "gym" : teams.home?.league === "college" ? "college" : "pro";

  const devices = useMemo(() => ["keyboard", ...pads.map((i) => `pad${i}`)], [pads]);

  const buildPending = (): PendingMatch | null => {
    const { home, away } = teams;
    if (!home || !away) return null;
    const ctrl = (side: Side) => devices.filter((d) => (assign[d] ?? (d === "keyboard" ? "home" : "cpu")) === side);
    // homegrown jerseys clash? swap the away team to its alternate automatically
    let awayUniform = uniforms.away;
    const hc = uniformColors(home, uniforms.home).base, ac = uniformColors(away, awayUniform).base;
    if (hc.toLowerCase() === ac.toLowerCase()) awayUniform = awayUniform === "away" ? "alt" : "away";
    return {
      mode: practice ? "practice" : "quick", league: home.league, arena,
      home: { team: home, roster: rosterFor(home), uniform: uniforms.home, tactics: tactics.home, controllers: practice ? ["keyboard", ...pads.map((i) => `pad${i}`)].slice(0, 1) : ctrl("home") },
      away: { team: away, roster: rosterFor(away), uniform: awayUniform, tactics: tactics.away, controllers: practice ? [] : ctrl("away") },
      quarterMinutes: quarter, returnTo: practice ? "/" : "/play/", seed: Math.floor(Math.random() * 1e6), practice,
    };
  };

  const play = () => {
    const p = buildPending();
    if (!p) return;
    audio.unlock();
    setPending(p);
    router.push("/game/");
  };

  const simulate = async () => {
    const p = buildPending();
    if (!p) return;
    setSimming(0);
    const match = new Match({
      league: p.league, home: { team: p.home.team, roster: p.home.roster, tactics: p.home.tactics }, away: { team: p.away.team, roster: p.away.roster, tactics: p.away.tactics },
      quarterMinutes: quarter, difficulty: settings.gameplay.difficulty, fatigue: settings.gameplay.fatigue, fouls: settings.gameplay.fouls,
      injuries: settings.gameplay.injuries, sliders: settings.gameplay.sliders, seed: p.seed, fast: true,
    });
    await simulateToEnd(match, (x) => setSimming(x));
    setSimming(null);
    setSimResult(match);
  };

  const randomize = () => {
    if (!data) return;
    const lg = teams.home?.league ?? "pro";
    const pool = data[lg].teams.filter((t) => lg !== "college" || t.tier === teams.home?.tier);
    const a = pool[Math.floor(Math.random() * pool.length)];
    let b = pool[Math.floor(Math.random() * pool.length)];
    while (b.id === a.id) b = pool[Math.floor(Math.random() * pool.length)];
    setTeams({ home: a, away: b });
  };

  const swap = () => {
    setTeams({ home: teams.away, away: teams.home });
    setTactics({ home: tactics.away, away: tactics.home });
    setAssign((cur) => Object.fromEntries(Object.entries(cur).map(([d, s]) => [d, s === "home" ? "away" : s === "away" ? "home" : s])));
  };

  // placeholders at the panels' real size, so nothing jumps when the teams arrive
  if (!data) return (
    <PageShell title={practice ? "Practice" : "Quick Play"} wide>
      <p className="sr-only" role="status">Loading teams…</p>
      <div className={`grid gap-5 ${practice ? "lg:grid-cols-1" : "lg:grid-cols-2"}`} aria-hidden>
        {(practice ? [0] : [0, 1]).map((i) => <div key={i} className="h-[560px] animate-pulse rounded-[var(--radius-panel)] bg-deck/60 ring-1 ring-line" />)}
      </div>
      <div className="mt-5 h-64 animate-pulse rounded-[var(--radius-panel)] bg-deck/60 ring-1 ring-line" aria-hidden />
    </PageShell>
  );

  return (
    <PageShell title={practice ? "Practice" : "Quick Play"} wide actions={
      <div className="flex gap-2">
        {!practice && <Button variant="ghost" onClick={randomize}>Random</Button>}
        {!practice && <Button variant="ghost" onClick={swap}>Swap sides</Button>}
      </div>
    }>
      <div className={`grid gap-5 ${practice ? "lg:grid-cols-1" : "lg:grid-cols-2"}`}>
        {!practice && <TeamPicker label="Away" data={data} team={teams.away} onPick={(t) => setTeams((s) => ({ ...s, away: t }))} uniform={uniforms.away} onUniform={(u) => setUniforms((s) => ({ ...s, away: u }))} />}
        <TeamPicker label={practice ? "Your team" : "Home"} data={data} team={teams.home} onPick={(t) => setTeams((s) => ({ ...s, home: t }))} uniform={uniforms.home} onUniform={(u) => setUniforms((s) => ({ ...s, home: u }))} />
      </div>

      {!practice && (
        <Panel title="Controllers" className="mt-5">
          <p className="mb-3 text-sm text-steel">Move each controller to the team it plays for. Leave one in the middle to let the CPU play. {pads.length === 0 && "Connect a gamepad and press any button to add it."}</p>
          <div className="flex flex-col gap-2">
            {devices.map((d) => {
              const side = assign[d] ?? (d === "keyboard" ? "home" : "cpu");
              const label = d === "keyboard" ? "Keyboard" : `Controller ${Number(d.slice(3)) + 1}`;
              return (
                <div key={d} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <div className="flex justify-end">{side === "away" && <Chip label={label} />}</div>
                  <Segmented label={`${label} side`} value={side} onChange={(v) => setAssign((s) => ({ ...s, [d]: v }))} options={[{ value: "away", label: `◀ ${teams.away?.abbrev ?? "Away"}` }, { value: "cpu", label: side === "cpu" ? `${label}: CPU` : "CPU" }, { value: "home", label: `${teams.home?.abbrev ?? "Home"} ▶` }]} />
                  <div>{side === "home" && <Chip label={label} />}</div>
                </div>
              );
            })}
          </div>
          {devices.every((d) => (assign[d] ?? (d === "keyboard" ? "home" : "cpu")) === "cpu") && <p className="mt-3 text-sm text-amber">No one is assigned, so you&apos;ll watch the CPU play both teams.</p>}
        </Panel>
      )}

      {!practice && (
        <Panel title="Coaching" className="mt-5">
          <div className="grid gap-x-10 lg:grid-cols-2">
            {(["away", "home"] as const).map((side) => (
              <div key={side}>
                <p className="mb-1 font-display text-xl font-bold">{teams[side]?.name ?? (side === "home" ? "Home" : "Away")} {teams[side]?.nickname ?? ""}</p>
                <TacticsPanel value={tactics[side]} onChange={(t) => setTactics((s) => ({ ...s, [side]: t }))} />
              </div>
            ))}
          </div>
          <p className="mt-2 text-sm text-steel">You can change your team&apos;s tactics during the game from the pause menu. Gameplay sliders are in Settings.</p>
        </Panel>
      )}

      <Panel title="Game options" className="mt-5">
        <div className="grid gap-x-10 md:grid-cols-2">
          {!practice && (
            <Select label={league === "college" ? "Half length" : "Quarter length"} value={quarter} onChange={(v) => setSettings("gameplay", { quarterMinutes: v })}
              options={quarterOpts.map((q) => ({ value: q, label: `${q} minutes` }))} />
          )}
          <Select<Difficulty> label="Difficulty" value={settings.gameplay.difficulty} onChange={(v) => setSettings("gameplay", { difficulty: v })}
            options={DIFFICULTY_LEVELS.map((d) => ({ value: d.id, label: d.label }))} />
          <Select<ArenaKind | "auto"> label="Venue" value={arenaChoice} onChange={setArenaChoice}
            options={[{ value: "auto", label: "Home team's venue" }, { value: "pro", label: "Pro arena" }, { value: "college", label: "College arena" }, { value: "gym", label: "High school gym" }]} />
          <Toggle label="Shot meter" hint="Time your release for better accuracy" checked={settings.gameplay.shotMeter} onChange={(v) => setSettings("gameplay", { shotMeter: v })} />
          {!practice && <Toggle label="Fatigue" checked={settings.gameplay.fatigue} onChange={(v) => setSettings("gameplay", { fatigue: v })} />}
          {!practice && <Toggle label="Fouls" checked={settings.gameplay.fouls} onChange={(v) => setSettings("gameplay", { fouls: v })} />}
          {!practice && <Toggle label="Injuries" hint="Players can get hurt on hard falls and collisions" checked={settings.gameplay.injuries} onChange={(v) => setSettings("gameplay", { injuries: v })} />}
          {!practice && <Toggle label="Coach makes substitutions" checked={settings.gameplay.autoSubs} onChange={(v) => setSettings("gameplay", { autoSubs: v })} />}
          <Toggle label="Sideline assist" hint="Stops you from stepping out of bounds by accident" checked={settings.gameplay.boundaryAssist} onChange={(v) => setSettings("gameplay", { boundaryAssist: v })} />
        </div>
      </Panel>

      <div className="sticky bottom-0 mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-navy/90 py-4 backdrop-blur">
        {teams.home && teams.away && !practice && <p className="mr-auto text-steel">{teams.away.name} at {teams.home.name}{teams.away.league !== teams.home.league && " (cross-league exhibition)"}</p>}
        {!practice && <Button variant="secondary" onClick={simulate} disabled={simming !== null}>{simming !== null ? `Simulating ${Math.round(simming * 100)}%` : "Simulate"}</Button>}
        <Button onClick={play}>{practice ? "Start practice" : "Play game"}</Button>
      </div>

      {simResult && <SimResult match={simResult} onClose={() => setSimResult(null)} onPlay={play} />}
    </PageShell>
  );
}

function Chip({ label }: { label: string }) {
  return <span className="rounded-full bg-amber/15 px-3 py-1 text-sm font-semibold text-amber ring-1 ring-amber/40">{label}</span>;
}

function TeamPicker({ label, data, team, onPick, uniform, onUniform }: {
  label: string; data: Record<LeagueId, LeagueData>; team: Team | null; onPick: (t: Team) => void; uniform: UniformStyle; onUniform: (u: UniformStyle) => void;
}) {
  const [league, setLeague] = useState<LeagueId>(team?.league ?? "pro");
  const [tier, setTier] = useState<string>("all");
  const [conf, setConf] = useState<string>("all");
  const [q, setQ] = useState("");
  // follow the league of a team picked elsewhere (e.g. "random")
  const [prevTeam, setPrevTeam] = useState(team);
  if (team !== prevTeam) {
    setPrevTeam(team);
    if (team) setLeague(team.league);
  }
  const confs = data[league].conferences.filter((c) => tier === "all" || c.tier === tier);
  const tiers = league === "college" ? ["D1", "D2", "D3"] : league === "hs" ? ["6A", "5A", "4A", "3A", "2A", "1A"] : [];
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data[league].teams.filter((t) =>
      (tier === "all" || t.tier === tier) && (conf === "all" || t.conferenceId === conf) &&
      (!needle || `${t.name} ${t.nickname} ${t.city} ${t.abbrev}`.toLowerCase().includes(needle)),
    ).sort((a, b) => b.prestige - a.prestige || a.name.localeCompare(b.name));
  }, [data, league, tier, conf, q]);
  const roster = team ? rosterFor(team) : [];
  const top = [...roster].sort((a, b) => overall(b.ratings, b.pos) - overall(a.ratings, a.pos)).slice(0, 5);
  const confName = team ? data[team.league].conferences.find((c) => c.id === team.conferenceId)?.name : "";
  return (
    <Panel>
      <div className="flex items-center justify-between">
        <p className="font-display text-2xl font-black text-steel">{label}</p>
        <Segmented label={`${label} league`} value={league} onChange={(v) => { setLeague(v); setTier("all"); setConf("all"); }} options={LEAGUES.map((l) => ({ value: l.id, label: l.short }))} />
      </div>
      {team && (
        <div className="mt-4 flex items-center gap-4 rounded-[var(--radius-chip)] p-3" style={{ background: `linear-gradient(90deg, ${team.colors.primary}cc, transparent)` }}>
          <TeamLogo team={team} size={72} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-net/80">{team.name}</p>
            <p className="truncate font-display text-4xl font-black leading-none">{team.nickname}</p>
            <p className="mt-1 truncate text-xs text-net/70">{tierLabel(team)} · {confName}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-net/70">Overall</p>
            <p className="led text-4xl">{teamRating(roster)}</p>
          </div>
        </div>
      )}
      {team && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {top.map((p) => <li key={p.id}><span className="text-steel">{p.pos}</span> {p.lastName} <span className="text-amber">{overall(p.ratings, p.pos)}</span></li>)}
          </ul>
          <Segmented label={`${label} uniform`} value={uniform} onChange={onUniform} options={[{ value: "home", label: "Home" }, { value: "away", label: "Away" }, { value: "alt", label: "Alternate" }]} />
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${list.length} teams`} aria-label={`Search ${label} teams`}
          className="min-w-40 flex-1 rounded-[var(--radius-chip)] bg-navy px-3 py-2 ring-1 ring-line placeholder:text-steel" />
        {tiers.length > 0 && (
          <select aria-label="Division" value={tier} onChange={(e) => { setTier(e.target.value); setConf("all"); }} className="rounded-[var(--radius-chip)] bg-navy px-3 py-2 ring-1 ring-line">
            <option value="all">{league === "hs" ? "All classes" : "All divisions"}</option>
            {tiers.map((t) => <option key={t} value={t}>{league === "college" ? `Division ${t.slice(1).replace("1", "I").replace("2", "II").replace("3", "III")}` : t}</option>)}
          </select>
        )}
        <select aria-label="Conference" value={conf} onChange={(e) => setConf(e.target.value)} className="max-w-56 rounded-[var(--radius-chip)] bg-navy px-3 py-2 ring-1 ring-line">
          <option value="all">{league === "hs" ? "All regions" : "All conferences"}</option>
          {confs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <ul className="scrollbar-thin mt-3 max-h-72 overflow-y-auto rounded-[var(--radius-chip)] ring-1 ring-line" aria-label={`${label} team list`}>
        {list.slice(0, 400).map((t) => (
          <li key={t.id}>
            <button onClick={() => onPick(t)} className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-deck-2 ${team?.id === t.id ? "bg-deck-2" : ""}`} aria-pressed={team?.id === t.id}>
              <TeamLogo team={t} size={28} />
              <span className="flex-1 truncate">{t.name} <span className="text-steel">{t.nickname}</span></span>
              <span className="text-xs text-steel">{t.tier ?? ""}</span>
              <span className="text-xs text-amber" aria-label={`Program strength ${Math.round(t.prestige * 5)} of 5`}>{stars(t.prestige)}</span>
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="px-3 py-4 text-sm text-steel">No teams match. Try a shorter search or clear the filters.</li>}
        {list.length > 400 && <li className="px-3 py-2 text-xs text-steel">Showing the top 400. Search or filter to narrow it down.</li>}
      </ul>
    </Panel>
  );
}

function SimResult({ match, onClose, onPlay }: { match: Match; onClose: () => void; onPlay: () => void }) {
  const s = match.state;
  useEffect(() => { toast(`Final: ${s.teams[1].team.name} ${s.teams[1].score}, ${s.teams[0].team.name} ${s.teams[0].score}`, "good"); }, [s]);
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-navy/90 backdrop-blur" data-nav-scope="modal" role="dialog" aria-label="Simulation result">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-10">
        <div className="flex items-center justify-center gap-10">
          {[1, 0].map((i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <TeamLogo team={s.teams[i].team} size={80} />
              <span className="font-display text-xl font-bold">{s.teams[i].team.name}</span>
              <span className="led text-6xl">{s.teams[i].score}</span>
            </div>
          ))}
        </div>
        <p className="text-center font-display text-xl text-steel">Final (simulated){s.period > s.cfg.rules.periods ? `, ${s.period - s.cfg.rules.periods}OT` : ""}</p>
        <BoxScoreTable teams={[s.teams[1], s.teams[0]]} box={s.box} />
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} autoFocus>Back to setup</Button>
          <Button onClick={onPlay}>Play this matchup</Button>
        </div>
      </div>
    </div>
  );
}
