"use client";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Match } from "@/game/sim/match";
import type { TeamIdx } from "@/game/sim/state";
import { InputManager, type DeviceId } from "@/game/input";
import { simulateToEnd } from "@/game/simulate";
import { gameScore } from "@/game/sim/stats";
import { audio } from "@/audio/engine";
import { overall } from "@/engine/player";
import { useSettings, type CameraMode } from "@/state/settings";
import { type PendingMatch, useHud, useMatchStore } from "@/state/matchStore";
import { CommentaryFeed, ControlsStrip, PlayBannerView, PlayerTag, ScoreBug, ShotMeter } from "../hud/Hud";
import { TeamLogo } from "../TeamLogo";
import { BoxScoreTable } from "../BoxScore";
import { BACK_EVENT } from "../MenuNavigator";
import { toast } from "../Toaster";
import { ReplayDirector } from "@/game3d/replay";
import { ReplayOverlay, useReplay } from "./ReplayOverlay";
import { BreakScreen, type BreakKind } from "./BreakScreen";

const GameScene = dynamic(() => import("@/game3d/GameScene").then((m) => m.GameScene), { ssr: false });

const CAMERAS: { id: CameraMode; label: string }[] = [
  { id: "broadcast", label: "Broadcast" }, { id: "2k", label: "2K" }, { id: "low", label: "Low broadcast" },
  { id: "baseline", label: "Baseline" }, { id: "player", label: "Player lock" }, { id: "skycam", label: "Skycam" },
];

type Screen = "intro" | "playing" | "paused" | "final" | "simming" | "break";

function buildMatch(p: PendingMatch, quarterMinutes: number, g: ReturnType<typeof useSettings.getState>["gameplay"], tapShots: boolean) {
  const home = p.home, away = p.away;
  let h = 0;
  const humansHome = home.controllers.map(() => h++);
  const humansAway = away.controllers.map(() => h++);
  const match = new Match({
    league: p.league,
    home: { team: home.team, roster: home.roster, tactics: home.tactics, human: humansHome.length > 0, humans: humansHome, starters: home.starters },
    away: { team: away.team, roster: away.roster, tactics: away.tactics, human: humansAway.length > 0, humans: humansAway, starters: away.starters },
    quarterMinutes, difficulty: g.difficulty, shotMeter: g.shotMeter && !tapShots, fatigue: g.fatigue, injuries: g.injuries, fouls: g.fouls,
    seed: p.seed, boundaryAssist: g.boundaryAssist, lockPlayerId: p.lockPlayerId, practice: p.practice,
  });
  const devices = [...home.controllers, ...away.controllers] as DeviceId[];
  // the coach's auto-subs setting applies to human-controlled teams
  for (const t of match.state.teams) if (t.humanControlled) (t as typeof t & { autoSubs?: boolean }).autoSubs = g.autoSubs;
  return { match, devices };
}

export function GameView({ pending }: { pending: PendingMatch }) {
  const router = useRouter();
  const settings = useSettings();
  const setResult = useMatchStore((s) => s.setResult);
  const [runId, setRunId] = useState(0);
  const { match, devices } = useMemo(() => buildMatch(pending, pending.quarterMinutes, useSettings.getState().gameplay, useSettings.getState().accessibility.holdToTap), [pending, runId]);
  const [screen, setScreen] = useState<Screen>(settings.presentation.skipIntros || pending.practice ? "playing" : "intro");
  const [camera, setCamera] = useState<CameraMode>(settings.camera.mode);
  const [simProgress, setSimProgress] = useState(0);
  const input = useMemo(() => new InputManager({ keys: settings.controls.keys, pad: settings.controls.pad, deadzone: settings.controls.stickDeadzone }), [settings.controls]);
  const hudPhase = useHud((s) => s.hud?.phase);
  const replay = useMemo(() => new ReplayDirector(match), [match]);
  const replaying = useReplay(replay) !== null;
  const [breakKind, setBreakKind] = useState<BreakKind>("periodEnd");
  const [pauseTab, setPauseTab] = useState<"menu" | "subs">("menu");
  const finished = useRef(false);

  // input + "in game" flag (menus ignore keys while playing)
  useEffect(() => {
    input.attach();
    document.body.dataset.ingame = "true";
    const unlock = () => audio.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      input.detach();
      delete document.body.dataset.ingame;
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [input]);

  useEffect(() => {
    audio.setMix(settings.audio);
  }, [settings.audio]);

  // menus get keyboard navigation back while paused
  useEffect(() => {
    if (screen === "playing") document.body.dataset.ingame = "true";
    else delete document.body.dataset.ingame;
  }, [screen]);

  // pause (and optionally mute) when the tab is hidden
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && screen === "playing") setScreen("paused");
      if (useSettings.getState().audio.muteOnBlur) { if (document.hidden) audio.suspend(); else audio.resume(); }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [screen]);

  // intro auto-advances
  useEffect(() => {
    if (screen !== "intro") return;
    const h = setTimeout(() => setScreen("playing"), 4200);
    const skip = (e: KeyboardEvent) => { if (["Space", "Enter", "Escape"].includes(e.code)) setScreen("playing"); };
    window.addEventListener("keydown", skip);
    return () => { clearTimeout(h); window.removeEventListener("keydown", skip); };
  }, [screen]);

  const finish = useCallback((simulated: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const s = match.state;
    const all = [...s.teams[0].roster, ...s.teams[1].roster];
    const potg = all.reduce<{ id: string; gs: number } | null>((best, p) => {
      const line = s.box[p.id];
      if (!line) return best;
      const gs = gameScore(line);
      return !best || gs > best.gs ? { id: p.id, gs } : best;
    }, null);
    setResult({
      mode: pending.mode, homeId: s.teams[0].team.id, awayId: s.teams[1].team.id, homeScore: s.teams[0].score, awayScore: s.teams[1].score,
      box: s.box, periods: s.period, playByPlay: s.playByPlay, playerOfGame: potg?.id ?? null, quarterMinutes: s.cfg.quarterMinutes, simulated, injuries: s.injuries,
    });
    setScreen("final");
  }, [match, pending.mode, setResult]);

  // quarter breaks, halftime and timeouts open the break panel (the sim holds the break meanwhile)
  useEffect(() => {
    if (screen !== "playing" || replaying || pending.practice || !useSettings.getState().presentation.breakScreens) return;
    if (hudPhase !== "periodEnd" && hudPhase !== "halftime" && hudPhase !== "timeout") return;
    const h = setTimeout(() => {
      const ph = match.state.phase;
      if (ph !== "periodEnd" && ph !== "halftime" && ph !== "timeout") return;
      match.holdBreak = true;
      setBreakKind(ph);
      setScreen("break");
    }, 1300);
    return () => clearTimeout(h);
  }, [hudPhase, screen, replaying, match, pending.practice]);
  useEffect(() => { if (screen === "playing") match.holdBreak = false; }, [screen, match]);

  useEffect(() => {
    if (hudPhase === "final" && screen === "playing") {
      const h = setTimeout(() => finish(false), 2500);
      return () => clearTimeout(h);
    }
  }, [hudPhase, screen, finish]);

  // Escape / gamepad B in menus resumes play
  useEffect(() => {
    const onBack = () => { if (screen === "paused") setScreen("playing"); };
    window.addEventListener(BACK_EVENT, onBack);
    return () => window.removeEventListener(BACK_EVENT, onBack);
  }, [screen]);

  const cycleCamera = useCallback(() => {
    setCamera((c) => {
      const i = CAMERAS.findIndex((x) => x.id === c);
      const next = CAMERAS[(i + 1) % CAMERAS.length];
      toast(`Camera: ${next.label}`);
      return next.id;
    });
  }, []);

  const requestTimeout = useCallback((team: 0 | 1) => {
    if (match.callTimeout(team as TeamIdx)) toast(`Timeout, ${match.state.teams[team].team.name}`);
    else toast("You can only call a timeout when your team has the ball", "bad");
  }, [match]);

  const simToEnd = async () => {
    setScreen("simming");
    await simulateToEnd(match, setSimProgress);
    finish(true);
  };

  const restart = () => {
    finished.current = false;
    useHud.setState({ hud: null, feed: [] });
    setRunId((r) => r + 1);
    setScreen(settings.presentation.skipIntros ? "playing" : "intro");
  };

  const home = match.state.teams[0].team, away = match.state.teams[1].team;
  const humanTeams = new Set(match.state.agents.filter((a) => a.human !== null).map((a) => a.team));
  const humanOffense = humanTeams.has(match.state.offense);

  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      <GameScene
        key={runId}
        match={match}
        input={input}
        devices={devices}
        uniforms={[pending.home.uniform, pending.away.uniform]}
        arena={pending.arena}
        paused={screen !== "playing" && screen !== "break"}
        cameraMode={camera}
        onPauseRequest={() => setScreen((s) => (s === "playing" ? "paused" : s === "paused" ? "playing" : s))}
        onCameraCycle={cycleCamera}
        onTimeoutRequest={requestTimeout}
        replay={replay}
      />
      {screen !== "intro" && screen !== "final" && (
        <>
          {pending.practice ? <PracticeStats match={match} /> : <ScoreBug home={home} away={away} />}
          {!replaying && <ShotMeter />}
          {!replaying && <PlayerTag />}
          <CommentaryFeed />
          {screen === "playing" && !replaying && humanTeams.size > 0 && <ControlsStrip onOffense={humanOffense} />}
        </>
      )}
      <ReplayOverlay director={replay} />
      {(screen === "playing" || screen === "break") && !pending.practice && <PlayBannerView />}
      {screen === "break" && !replaying && (
        <BreakScreen
          match={match}
          kind={breakKind}
          humanTeam={humanTeams.size ? ([...humanTeams][0] as TeamIdx) : null}
          autoContinue={humanTeams.size === 0}
          highlightCount={replay.highlights.length}
          onContinue={() => { match.holdBreak = false; match.skipBreak(); setScreen("playing"); }}
          onSubs={() => { setPauseTab("subs"); setScreen("paused"); }}
          onHighlights={() => replay.playReel()}
        />
      )}
      {screen === "intro" && <IntroSplash match={match} occasion={pending.occasion} onSkip={() => setScreen("playing")} />}
      {screen === "paused" && (
        <PauseMenu
          initialTab={pauseTab}
          match={match}
          camera={camera}
          setCamera={setCamera}
          onResume={() => { setPauseTab("menu"); setScreen("playing"); }}
          onTimeout={requestTimeout}
          onRestart={restart}
          onSim={simToEnd}
          onQuit={() => router.push(pending.returnTo)}
          onReplay={() => { const c = replay.recentClip(); setScreen("playing"); if (c) replay.play(c); else toast("Nothing to replay yet"); }}
          onHighlights={() => { setScreen("playing"); replay.playReel(); }}
          highlightCount={replay.highlights.length}
        />
      )}
      {screen === "simming" && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-navy/85 backdrop-blur" role="status">
          <div className="w-80 text-center">
            <p className="font-display text-3xl font-black">Simulating</p>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-deck"><div className="h-full bg-amber transition-[width]" style={{ width: `${simProgress * 100}%` }} /></div>
          </div>
        </div>
      )}
      {screen === "final" && !replaying && <FinalScreen match={match} onContinue={() => router.push(pending.returnTo)} onRestart={restart} onHighlights={replay.highlights.length ? () => replay.playReel() : undefined} />}
    </div>
  );
}

// ---------------------------------------------------------------- practice
function PracticeStats({ match }: { match: Match }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const h = setInterval(() => tick((x) => x + 1), 250);
    return () => clearInterval(h);
  }, []);
  const s = match.state;
  const line = s.teams[0].roster.reduce((acc, p) => {
    const b = s.box[p.id];
    if (b) { acc.fgm += b.fgm; acc.fga += b.fga; acc.tpm += b.tpm; acc.tpa += b.tpa; }
    return acc;
  }, { fgm: 0, fga: 0, tpm: 0, tpa: 0 });
  const pct = (m: number, a: number) => (a ? `${Math.round((m / a) * 100)}%` : "-");
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-20 flex -translate-x-1/2 gap-6 rounded-[var(--radius-chip)] bg-navy/90 px-6 py-3 ring-1 ring-line backdrop-blur">
      <div className="text-center"><p className="text-xs text-steel">Shooting</p><p className="led text-3xl">{line.fgm}/{line.fga}</p><p className="text-xs text-steel">{pct(line.fgm, line.fga)}</p></div>
      <div className="text-center"><p className="text-xs text-steel">Threes</p><p className="led text-3xl">{line.tpm}/{line.tpa}</p><p className="text-xs text-steel">{pct(line.tpm, line.tpa)}</p></div>
      <div className="max-w-56 self-center text-xs text-steel">Practice: no clock and no defense. The ball comes back after every shot.</div>
    </div>
  );
}

// ------------------------------------------------------------------- intro
function IntroSplash({ match, occasion, onSkip }: { match: Match; occasion?: string; onSkip: () => void }) {
  const s = match.state;
  const [a, h] = [s.teams[1], s.teams[0]];
  const starters = (t: typeof a) => t.onCourt.map((id) => t.roster.find((p) => p.id === id)!).filter(Boolean);
  const side = (t: typeof a, right: boolean) => (
    <div className={`flex flex-1 flex-col gap-4 p-8 ${right ? "items-end text-right" : ""}`} style={{ background: `linear-gradient(${right ? "270deg" : "90deg"}, ${t.team.colors.primary}ee, transparent)` }}>
      <TeamLogo team={t.team} size={120} />
      <div>
        <p className="font-display text-2xl font-bold text-steel">{t.team.name}</p>
        <p className="font-display text-6xl font-black leading-none" style={{ color: t.team.colors.accent }}>{t.team.nickname}</p>
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {starters(t).map((p) => (
          <li key={p.id} className="flex gap-2"><span className="w-7 text-steel">{p.pos}</span><span className="w-6 text-right text-amber">{p.jersey}</span><span>{p.firstName} {p.lastName}</span><span className="text-steel">{overall(p.ratings, p.pos)}</span></li>
        ))}
      </ul>
    </div>
  );
  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-navy/70 backdrop-blur-sm" onClick={onSkip}>
      <div className="flex flex-1 items-center">
        {side(a, false)}
        <div className="flex flex-col items-center px-6">
          {occasion && <p className="mb-2 font-display text-xl font-bold text-amber">{occasion}</p>}
          <p className="font-display text-5xl font-black">at</p>
          <p className="mt-2 text-sm text-steel">{h.team.arena.name}</p>
        </div>
        {side(h, true)}
      </div>
      <p className="pb-8 text-center text-sm text-steel">Press Space or click to skip</p>
    </div>
  );
}

// ------------------------------------------------------------------- pause
function PauseMenu({ initialTab, match, camera, setCamera, onResume, onTimeout, onRestart, onSim, onQuit, onReplay, onHighlights, highlightCount }: {
  initialTab: "menu" | "subs"; match: Match; camera: CameraMode; setCamera: (c: CameraMode) => void; onResume: () => void; onTimeout: (t: 0 | 1) => void;
  onRestart: () => void; onSim: () => void; onQuit: () => void; onReplay: () => void; onHighlights: () => void; highlightCount: number;
}) {
  const [tab, setTab] = useState<"menu" | "box" | "subs" | "controls">(initialTab);
  const [confirm, setConfirm] = useState<null | "quit" | "restart" | "sim">(null);
  const s = match.state;
  const humanTeam = s.agents.find((a) => a.human !== null)?.team ?? 0;
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus(); }, [tab]);
  const item = (label: string, onClick: () => void, ref?: React.Ref<HTMLButtonElement>) => (
    <button ref={ref} onClick={onClick} className="w-full rounded-[var(--radius-chip)] px-4 py-2.5 text-left font-display text-2xl font-bold text-net hover:bg-deck-2 focus-visible:bg-deck-2">{label}</button>
  );
  return (
    <div className="fixed inset-0 z-40 flex bg-navy/80 backdrop-blur" data-nav-scope="modal" role="dialog" aria-label="Paused">
      <aside className="flex w-80 flex-col gap-1 border-r border-line bg-navy/90 p-6">
        <p className="mb-4 font-display text-5xl font-black">Paused</p>
        {item("Resume", onResume, tab === "menu" ? first : undefined)}
        {item("Box score", () => setTab("box"))}
        {item("Substitutions", () => setTab("subs"))}
        {item(`Timeout (${s.teams[humanTeam].timeouts} left)`, () => { onTimeout(humanTeam as 0 | 1); onResume(); })}
        {item(`Camera: ${CAMERAS.find((c) => c.id === camera)?.label}`, () => setCamera(CAMERAS[(CAMERAS.findIndex((c) => c.id === camera) + 1) % CAMERAS.length].id))}
        {item("Instant replay", onReplay)}
        {highlightCount > 0 && item(`Highlights (${highlightCount})`, onHighlights)}
        {item("Controls", () => setTab("controls"))}
        {item("Sim to end", () => setConfirm("sim"))}
        {item("Restart game", () => setConfirm("restart"))}
        {item("Quit game", () => setConfirm("quit"))}
      </aside>
      <section className="scrollbar-thin flex-1 overflow-y-auto p-8">
        {tab === "box" && <BoxScoreTable teams={[s.teams[1], s.teams[0]]} box={s.box} onCourt={[...s.teams[0].onCourt, ...s.teams[1].onCourt]} />}
        {tab === "subs" && <SubsPanel match={match} team={humanTeam as TeamIdx} />}
        {tab === "controls" && <ControlsReference />}
        {tab === "menu" && <PlayByPlay match={match} />}
      </section>
      {confirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" data-nav-scope="modal" role="alertdialog" aria-label="Confirm">
          <div className="w-96 rounded-[var(--radius-panel)] bg-deck p-6 ring-1 ring-line">
            <p className="font-display text-2xl font-bold">{confirm === "quit" ? "Quit this game?" : confirm === "restart" ? "Restart from the opening tip?" : "Simulate the rest of the game?"}</p>
            <p className="mt-2 text-sm text-steel">{confirm === "quit" ? "Progress in this game will be lost." : confirm === "restart" ? "The score and stats reset to zero." : "The CPU plays out the remaining time for both teams."}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button autoFocus onClick={() => setConfirm(null)} className="rounded-[var(--radius-chip)] px-4 py-2 text-steel hover:text-net">Cancel</button>
              <button onClick={() => { const c = confirm; setConfirm(null); if (c === "quit") onQuit(); else if (c === "restart") onRestart(); else onSim(); }}
                className="rounded-[var(--radius-chip)] bg-amber px-4 py-2 font-semibold text-navy">{confirm === "quit" ? "Quit game" : confirm === "restart" ? "Restart game" : "Sim to end"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PlayByPlay({ match }: { match: Match }) {
  const rows = [...match.state.playByPlay].reverse().slice(0, 40);
  return (
    <div>
      <h2 className="mb-3 font-display text-3xl font-black">Play by play</h2>
      {rows.length === 0 && <p className="text-steel">No plays yet. Resume to tip off.</p>}
      <ol className="flex flex-col gap-1 text-sm">
        {rows.map((r, i) => (
          <li key={i} className="flex gap-3 border-b border-line/50 py-1.5">
            <span className="w-16 text-steel tabular-nums">P{r.period} {Math.floor(r.clock / 60)}:{String(Math.floor(r.clock % 60)).padStart(2, "0")}</span>
            <span className="w-16 tabular-nums text-steel">{r.score[1]}-{r.score[0]}</span>
            <span>{r.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SubsPanel({ match, team }: { match: Match; team: TeamIdx }) {
  const [, force] = useState(0);
  const [out, setOut] = useState<string | null>(null);
  const t = match.state.teams[team];
  const stam = (id: string) => {
    const ag = match.state.agents.find((a) => a.player.id === id);
    return ag ? ag.stamina : ((t.roster.find((p) => p.id === id) as { _stamina?: number } | undefined)?._stamina ?? 1);
  };
  const auto = (t as typeof t & { autoSubs?: boolean }).autoSubs !== false;
  const row = (id: string, onClick: () => void, selected: boolean) => {
    const p = t.roster.find((x) => x.id === id)!;
    const line = match.state.box[id];
    return (
      <button key={id} onClick={onClick} className={`flex w-full items-center gap-3 rounded-[var(--radius-chip)] px-3 py-2 text-left ${selected ? "bg-deck-2 ring-1 ring-amber" : "bg-deck hover:bg-deck-2"}`}>
        <span className="w-7 text-steel">{p.pos}</span>
        <span className="flex-1">{p.firstName[0]}. {p.lastName}</span>
        {match.isInjured(id) && <span className="rounded bg-bad/20 px-1.5 text-xs font-semibold text-bad">Injured</span>}
        <span className="text-xs text-steel">{line.pts} pts · {line.pf} PF</span>
        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-navy"><span className="block h-full bg-good" style={{ width: `${stam(id) * 100}%` }} /></span>
      </button>
    );
  };
  return (
    <div className="grid max-w-3xl grid-cols-2 gap-6">
      <div className="col-span-2 flex items-center justify-between">
        <h2 className="font-display text-3xl font-black">Substitutions</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={auto} onChange={(e) => { (t as typeof t & { autoSubs?: boolean }).autoSubs = e.target.checked; force((x) => x + 1); }} />
          Coach makes substitutions automatically
        </label>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-sm text-steel">On the floor: pick who comes out</p>
        {t.onCourt.map((id) => row(id, () => setOut(id), out === id))}
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-sm text-steel">Bench: pick who goes in</p>
        {t.roster.filter((p) => !t.onCourt.includes(p.id)).map((p) => row(p.id, () => {
          if (!out) { toast("Pick a player to take out first"); return; }
          if (match.state.box[p.id].pf >= match.state.cfg.rules.foulOutLimit) { toast(`${p.lastName} has fouled out`, "bad"); return; }
          if (match.isInjured(p.id)) { toast(`${p.lastName} is injured`, "bad"); return; }
          match.substitute(team, out, p.id);
          toast(`${p.firstName[0]}. ${p.lastName} checks in`, "good");
          setOut(null);
          force((x) => x + 1);
        }, false))}
      </div>
    </div>
  );
}

function ControlsReference() {
  const keys = useSettings((s) => s.controls.keys);
  const rows: [string, string[]][] = [
    ["Move", ["up", "left", "down", "right"]], ["Sprint", ["sprint"]], ["Shoot (hold, release at the top)", ["shoot"]],
    ["Pass / call for ball", ["pass"]], ["Lob / alley-oop", ["lob"]], ["Bounce pass", ["bounce"]], ["Icon pass (hold, then 1-5)", ["iconPass"]],
    ["Crossover", ["dribbleLeft", "dribbleRight"]], ["Stepback", ["dribbleBack"]], ["Spin", ["dribbleSpin"]], ["Pump fake", ["pumpFake"]],
    ["Post up", ["post"]], ["Call pick and roll", ["callScreen"]], ["Steal (defense)", ["steal"]], ["Block / rebound (defense)", ["block"]],
    ["Intense defense", ["intenseD"]], ["Switch player", ["switchPlayer"]], ["Take charge", ["takeCharge"]], ["Timeout", ["timeout"]], ["Camera", ["camera"]], ["Pause", ["pause"]],
  ];
  const lab = (c: string) => c.replace(/^Key/, "").replace(/^Digit/, "").replace("ShiftLeft", "Shift").replace("Arrow", "").replace("Escape", "Esc");
  return (
    <div className="max-w-2xl">
      <h2 className="mb-3 font-display text-3xl font-black">Controls</h2>
      <p className="mb-4 text-sm text-steel">Change any binding in Settings. Gamepads work automatically; on a controller the right stick does dribble moves.</p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-8 gap-y-2 text-sm">
        {rows.map(([label, actions]) => (
          <div key={label} className="contents">
            <dt>{label}</dt>
            <dd className="flex gap-1">{actions.flatMap((a) => keys[a as keyof typeof keys]?.slice(0, 1) ?? []).map((k, i) => <kbd key={i} className="rounded border border-line bg-deck px-1.5 py-0.5 text-xs">{lab(k)}</kbd>)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ------------------------------------------------------------------- final
function FinalScreen({ match, onContinue, onRestart, onHighlights }: { match: Match; onContinue: () => void; onRestart: () => void; onHighlights?: () => void }) {
  const s = match.state;
  const result = useMatchStore((x) => x.lastResult);
  const all = [...s.teams[0].roster, ...s.teams[1].roster];
  const potg = all.find((p) => p.id === result?.playerOfGame);
  const potgTeam = potg ? s.teams.find((t) => t.roster.includes(potg))!.team : null;
  const line = potg ? s.box[potg.id] : null;
  const winner = s.teams[0].score > s.teams[1].score ? 0 : 1;
  const cont = useRef<HTMLButtonElement>(null);
  useEffect(() => { cont.current?.focus(); }, []);
  return (
    <div className="scrollbar-thin fixed inset-0 z-40 overflow-y-auto bg-navy/90 backdrop-blur" data-nav-scope="modal">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
        <div className="flex items-center justify-center gap-8">
          {[1, 0].map((i) => (
            <div key={i} className={`flex flex-col items-center gap-2 ${winner === i ? "" : "opacity-60"}`}>
              <TeamLogo team={s.teams[i].team} size={88} />
              <span className="font-display text-xl font-bold">{s.teams[i].team.name}</span>
              <span className="led text-6xl">{s.teams[i].score}</span>
            </div>
          ))}
        </div>
        <p className="text-center font-display text-2xl font-bold text-steel">Final{s.period > s.cfg.rules.periods ? ` / ${s.period - s.cfg.rules.periods > 1 ? `${s.period - s.cfg.rules.periods}OT` : "OT"}` : ""}{result?.simulated ? " (simulated)" : ""}</p>
        {potg && line && potgTeam && (
          <div className="flex items-center gap-4 rounded-[var(--radius-panel)] bg-deck p-5 ring-1 ring-line">
            <TeamLogo team={potgTeam} size={56} />
            <div className="flex-1">
              <p className="text-sm text-steel">Player of the game</p>
              <p className="font-display text-3xl font-black">{potg.firstName} {potg.lastName}</p>
            </div>
            <p className="font-display text-2xl font-bold tabular-nums">{line.pts} PTS · {line.oreb + line.dreb} REB · {line.ast} AST</p>
          </div>
        )}
        <BoxScoreTable teams={[s.teams[1], s.teams[0]]} box={s.box} />
        <div className="flex justify-end gap-3">
          {onHighlights && <button onClick={onHighlights} className="rounded-[var(--radius-chip)] px-5 py-3 font-display text-xl font-bold text-steel hover:text-net">Watch highlights</button>}
          <button onClick={onRestart} className="rounded-[var(--radius-chip)] px-5 py-3 font-display text-xl font-bold text-steel hover:text-net">Play again</button>
          <button ref={cont} onClick={onContinue} className="rounded-[var(--radius-chip)] bg-amber px-6 py-3 font-display text-xl font-bold text-navy">Continue</button>
        </div>
      </div>
    </div>
  );
}
