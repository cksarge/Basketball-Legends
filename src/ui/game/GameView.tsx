"use client";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Match, type MatchSetup } from "@/game/sim/match";
import { clearSuspended, loadSuspended, saveSuspended } from "@/state/suspended";
import type { TeamIdx } from "@/game/sim/state";
import { InputManager, type DeviceId } from "@/game/input";
import { SIM_DT, simulateToEnd } from "@/game/simulate";
import { useCareer } from "@/state/careerStore";
import { gameScore } from "@/game/sim/stats";
import { audio } from "@/audio/engine";
import { overall } from "@/engine/player";
import { useSettings, type CameraMode } from "@/state/settings";
import { type PendingMatch, useHud, useMatchStore } from "@/state/matchStore";
import { CommentaryFeed, ControlsStrip, PlayBannerView, PlayerTag, ScoreBug, ShotMeter, StatOverlayView } from "../hud/Hud";
import { TeamLogo } from "../TeamLogo";
import { BoxScoreTable } from "../BoxScore";
import { BACK_EVENT } from "../MenuNavigator";
import { toast } from "../Toaster";
import { ReplayDirector } from "@/game3d/replay";
import { ReplayOverlay, useReplay } from "./ReplayOverlay";
import { BreakScreen, type BreakKind } from "./BreakScreen";
import { TacticsPanel } from "../TacticsPanel";
import { LoadingScreen } from "./LoadingScreen";
import { TutorialOverlay } from "./TutorialOverlay";
import { ParkFinal, ParkHud, parkOutcome } from "./ParkHud";
import { HorseDrill, ThreePointDrill, simulateContestRound } from "@/game/sim/drill";
import { parkById } from "@/game/park/parks";

const GameScene = dynamic(() => import("@/game3d/GameScene").then((m) => m.GameScene), { ssr: false });

const CAMERAS: { id: CameraMode; label: string }[] = [
  { id: "broadcast", label: "Broadcast" },
  { id: "2k", label: "2K" },
  { id: "low", label: "Low broadcast" },
  { id: "baseline", label: "Baseline" },
  { id: "player", label: "Player lock" },
  { id: "skycam", label: "Skycam" },
];

type Screen = "intro" | "playing" | "paused" | "final" | "simming" | "break" | "bench" | "ffwd";

function buildMatch(p: PendingMatch, quarterMinutes: number, g: ReturnType<typeof useSettings.getState>["gameplay"], tapShots: boolean) {
  const home = p.home,
    away = p.away;
  let h = 0;
  const humansHome = home.controllers.map(() => h++);
  const humansAway = away.controllers.map(() => h++);
  const setup: MatchSetup = {
    league: p.league,
    home: { team: home.team, roster: home.roster, tactics: home.tactics, human: humansHome.length > 0, humans: humansHome, starters: home.starters },
    away: { team: away.team, roster: away.roster, tactics: away.tactics, human: humansAway.length > 0, humans: humansAway, starters: away.starters },
    quarterMinutes,
    difficulty: p.difficulty ?? g.difficulty,
    shotMeter: g.shotMeter && !tapShots,
    fatigue: g.fatigue,
    injuries: g.injuries,
    fouls: g.fouls,
    seed: p.seed,
    boundaryAssist: g.boundaryAssist,
    lockPlayerId: p.lockPlayerId,
    practice: p.practice,
    sliders: g.sliders,
    park: p.park?.rules && !p.practice ? p.park.rules : undefined,
  };
  // pick up a suspended game where it left off (falls back to a fresh game if the save is unreadable)
  let match: Match | null = null;
  if (p.resume) {
    const saved = loadSuspended();
    try {
      if (saved) match = Match.restore(setup, saved.match);
    } catch {
      match = null;
    }
  }
  match ??= new Match(setup);
  // park shooting games run on top of practice mode
  if (p.park?.mode === "horse") match.drill = new HorseDrill(match, p.park.word ?? "HORSE", p.seed);
  if (p.park?.mode === "three") match.drill = new ThreePointDrill(match);
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
  // a restart (runId) builds a fresh game with a new seed
  const { match, devices } = useMemo(
    () =>
      buildMatch(
        { ...pending, seed: pending.seed + runId * 7919 },
        pending.quarterMinutes,
        useSettings.getState().gameplay,
        useSettings.getState().accessibility.holdToTap,
      ),
    [pending, runId],
  );
  // park games skip the TV intro (there are no team introductions at the park)
  const [screen, setScreen] = useState<Screen>(
    pending.resume ? "paused" : settings.presentation.skipIntros || pending.practice || pending.park ? "playing" : "intro",
  );
  const [camera, setCamera] = useState<CameraMode>(settings.camera.mode);
  const [simProgress, setSimProgress] = useState(0);
  const input = useMemo(
    () => new InputManager({ keys: settings.controls.keys, pad: settings.controls.pad, deadzone: settings.controls.stickDeadzone }),
    [settings.controls],
  );
  const hudPhase = useHud((s) => s.hud?.phase);
  const replay = useMemo(() => new ReplayDirector(match), [match]);
  const replaying = useReplay(replay) !== null;
  const [breakKind, setBreakKind] = useState<BreakKind>("periodEnd");
  const [pauseTab, setPauseTab] = useState<"menu" | "subs">("menu");
  const [ready, setReady] = useState(false);
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
      if (useSettings.getState().audio.muteOnBlur) {
        if (document.hidden) audio.suspend();
        else audio.resume();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [screen]);

  // keep a suspended copy of the game so a closed tab can be resumed from the main menu
  useEffect(() => {
    if (!ready || pending.practice || screen === "final" || screen === "simming") return;
    const save = () => {
      if (!finished.current) saveSuspended(match, pending);
    };
    const h = setInterval(save, 4000);
    window.addEventListener("pagehide", save);
    return () => {
      clearInterval(h);
      window.removeEventListener("pagehide", save);
    };
  }, [ready, screen, match, pending]);

  // intro auto-advances (once the arena is on screen)
  useEffect(() => {
    if (screen !== "intro" || !ready) return;
    const h = setTimeout(() => setScreen("playing"), 4200);
    const skip = (e: KeyboardEvent) => {
      if (["Space", "Enter", "Escape"].includes(e.code)) setScreen("playing");
    };
    window.addEventListener("keydown", skip);
    return () => {
      clearTimeout(h);
      window.removeEventListener("keydown", skip);
    };
  }, [screen, ready]);

  const finish = useCallback(
    (simulated: boolean) => {
      if (finished.current) return;
      finished.current = true;
      clearSuspended();
      const s = match.state;
      const all = [...s.teams[0].roster, ...s.teams[1].roster];
      const potg = all.reduce<{ id: string; gs: number } | null>((best, p) => {
        const line = s.box[p.id];
        if (!line) return best;
        const gs = gameScore(line);
        return !best || gs > best.gs ? { id: p.id, gs } : best;
      }, null);
      setResult({
        mode: pending.mode,
        homeId: s.teams[0].team.id,
        awayId: s.teams[1].team.id,
        homeScore: s.teams[0].score,
        awayScore: s.teams[1].score,
        box: s.box,
        periods: s.period,
        playByPlay: s.playByPlay,
        playerOfGame: potg?.id ?? null,
        quarterMinutes: s.cfg.quarterMinutes,
        simulated,
        injuries: s.injuries,
        career: pending.career,
        park: pending.park ? parkOutcome(match, pending.park, contestRivals(pending)) : undefined,
      });
      setScreen("final");
    },
    [match, pending, setResult],
  );

  // park shooting games end when the drill says so (there's no final buzzer in practice mode)
  useEffect(() => {
    if (!match.drill || screen !== "playing") return;
    const h = setInterval(() => {
      if (match.drill?.done) {
        clearInterval(h);
        setTimeout(() => finish(false), 1800);
      }
    }, 200);
    return () => clearInterval(h);
  }, [match, screen, finish]);

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
  useEffect(() => {
    if (screen === "playing") match.holdBreak = false;
  }, [screen, match]);

  useEffect(() => {
    if (hudPhase === "final" && screen === "playing") {
      const h = setTimeout(() => finish(false), 2500);
      return () => clearTimeout(h);
    }
  }, [hudPhase, screen, finish]);

  // Escape / gamepad B in menus resumes play
  useEffect(() => {
    const onBack = () => {
      if (screen === "paused") setScreen("playing");
    };
    window.addEventListener(BACK_EVENT, onBack);
    return () => window.removeEventListener(BACK_EVENT, onBack);
  }, [screen]);

  // state updaters must stay pure, so the toast reads the current camera from a ref
  const cameraRef = useRef(camera);
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);
  const cycleCamera = useCallback(() => {
    const i = CAMERAS.findIndex((x) => x.id === cameraRef.current);
    const next = CAMERAS[(i + 1) % CAMERAS.length];
    cameraRef.current = next.id;
    setCamera(next.id);
    toast(`Camera: ${next.label}`);
  }, []);

  const requestTimeout = useCallback(
    (team: 0 | 1) => {
      if (match.state.cfg.park) toast("No timeouts at the park", "bad");
      else if (match.callTimeout(team as TeamIdx)) toast(`Timeout, ${match.state.teams[team].team.name}`);
      else toast("You can only call a timeout when your team has the ball", "bad");
    },
    [match],
  );

  const simToEnd = async () => {
    setScreen("simming");
    await simulateToEnd(match, setSimProgress);
    finish(true);
  };

  // ---- career: your player on the bench (ask, watch, fast-forward until you check back in, or sim)
  const lockId = pending.lockPlayerId;
  const [benchMode, setBenchMode] = useState<"ask" | "watch" | "skip" | "sim">(pending.bench ?? "ask");
  const [benched, setBenched] = useState(false);
  const wasOnCourt = useRef<boolean | null>(null);
  const fastForward = useCallback(async () => {
    setScreen("ffwd");
    const s = match.state;
    const fast = s.cfg.fast;
    s.cfg.fast = true;
    await new Promise<void>((resolve) => {
      const tick = () => {
        const t0 = performance.now();
        while (performance.now() - t0 < 12) {
          match.step(SIM_DT);
          if (s.phase === "final" || s.agents.some((a) => a.player.id === lockId)) {
            resolve();
            return;
          }
        }
        setTimeout(tick, 0);
      };
      tick();
    });
    s.cfg.fast = fast;
    wasOnCourt.current = true;
    setBenched(false);
    if (s.phase === "final") finish(false);
    else setScreen("playing");
  }, [match, lockId, finish]);
  useEffect(() => {
    if (!lockId || screen !== "playing" || pending.practice) return;
    const h = setInterval(() => {
      const on = match.state.agents.some((a) => a.player.id === lockId);
      if (on === wasOnCourt.current) return;
      wasOnCourt.current = on;
      setBenched(!on);
      if (on || match.state.phase === "final") return;
      if (benchMode === "ask") setScreen("bench");
      else if (benchMode === "skip") fastForward();
      else if (benchMode === "sim") simToEnd();
    }, 400);
    return () => clearInterval(h);
    // simToEnd is recreated each render; the latest one is fine to call
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockId, screen, benchMode, match, fastForward, pending.practice]);
  const chooseBench = (choice: "watch" | "skip" | "sim", remember: boolean) => {
    if (remember) {
      setBenchMode(choice);
      const careerId = pending.career?.careerId;
      const cs = useCareer.getState();
      if (careerId && cs.career?.id === careerId) cs.update((c) => ({ ...c, settings: { ...c.settings, bench: choice } }));
    }
    if (choice === "watch") setScreen("playing");
    else if (choice === "skip") fastForward();
    else simToEnd();
  };

  const restart = () => {
    clearSuspended();
    finished.current = false;
    useHud.setState({ hud: null, feed: [] });
    setRunId((r) => r + 1);
    setScreen(settings.presentation.skipIntros || pending.park ? "playing" : "intro");
  };

  const home = match.state.teams[0].team,
    away = match.state.teams[1].team;
  const park = pending.park ? parkById(pending.park.parkId) : undefined;
  const street = useMemo(() => {
    const sess = pending.park;
    if (!sess) return undefined;
    return (p: { id: string }, team: 0 | 1) => {
      const o = sess.outfits[p.id] ?? { shirt: "#f4f4f2", shorts: "#1d1f23" };
      // in team games a side matches; in 21 and the shooting games everyone wears their own
      return sess.sideShirts && sess.rules?.game !== "21" ? { shirt: sess.sideShirts[team], shorts: o.shorts } : o;
    };
  }, [pending.park]);
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
        park={park}
        street={street}
        paused={!ready || (screen !== "playing" && screen !== "break")}
        cameraMode={camera}
        onPauseRequest={() => setScreen((s) => (s === "playing" ? "paused" : s === "paused" ? "playing" : s))}
        onCameraCycle={cycleCamera}
        onTimeoutRequest={requestTimeout}
        replay={replay}
        onReady={() => setReady(true)}
        overlaysVisible={ready && (screen === "playing" || screen === "break")}
      />
      <LoadingScreen
        key={`loading-${runId}`}
        home={home}
        away={away}
        ready={ready}
        place={park ? { name: park.name, where: `${park.city}, ${park.state}` } : undefined}
      />
      {screen !== "intro" && screen !== "final" && (
        <>
          {pending.park ? (
            !replaying && <ParkHud match={match} session={pending.park} />
          ) : pending.practice ? (
            !replaying && <PracticeStats match={match} />
          ) : (
            <ScoreBug home={home} away={away} />
          )}
          {!replaying && <ShotMeter />}
          {!replaying && <PlayerTag />}
          <CommentaryFeed />
          {screen === "playing" && !replaying && humanTeams.size > 0 && <ControlsStrip onOffense={humanOffense} />}
        </>
      )}
      <ReplayOverlay director={replay} />
      {pending.tutorial && ready && (
        <TutorialOverlay
          key={`tutorial-${runId}`}
          match={match}
          replaying={replaying}
          visible={screen === "playing" || replaying}
          onFinish={() => router.push("/play/")}
        />
      )}
      {(screen === "playing" || screen === "break") && !pending.practice && <PlayBannerView />}
      {screen === "playing" && !replaying && !pending.practice && <StatOverlayView />}
      {screen === "break" && !replaying && (
        <BreakScreen
          match={match}
          kind={breakKind}
          humanTeam={humanTeams.size ? ([...humanTeams][0] as TeamIdx) : null}
          autoContinue={humanTeams.size === 0}
          highlightCount={replay.highlights.length}
          onContinue={() => {
            match.holdBreak = false;
            match.skipBreak();
            setScreen("playing");
          }}
          onSubs={() => {
            setPauseTab("subs");
            setScreen("paused");
          }}
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
          onResume={() => {
            setPauseTab("menu");
            setScreen("playing");
          }}
          onTimeout={requestTimeout}
          onRestart={restart}
          onSim={simToEnd}
          onQuit={() => {
            clearSuspended();
            router.push(pending.returnTo);
          }}
          onSaveQuit={
            pending.practice
              ? undefined
              : () => {
                  saveSuspended(match, pending);
                  toast(pending.career ? "Game saved. Resume it from your career hub." : "Game saved. Resume it from the main menu.", "good");
                  router.push(pending.career ? pending.returnTo : "/");
                }
          }
          onReplay={() => {
            const c = replay.recentClip();
            setScreen("playing");
            if (c) replay.play(c);
            else toast("Nothing to replay yet");
          }}
          onHighlights={() => {
            setScreen("playing");
            replay.playReel();
          }}
          highlightCount={replay.highlights.length}
        />
      )}
      {screen === "bench" && <BenchPrompt onChoose={chooseBench} />}
      {screen === "ffwd" && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-navy/80 backdrop-blur" role="status">
          <p className="font-display text-3xl font-black">Fast-forwarding until you check back in…</p>
        </div>
      )}
      {screen === "playing" && benched && lockId && (
        <div className="pointer-events-auto fixed left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full bg-navy/85 px-4 py-2 text-sm ring-1 ring-line backdrop-blur">
          <span>You&apos;re on the bench</span>
          <button className="font-semibold text-amber underline" onClick={fastForward}>
            Fast-forward
          </button>
          <button className="text-steel underline" onClick={simToEnd}>
            Sim to the end
          </button>
        </div>
      )}
      {screen === "simming" && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-navy/85 backdrop-blur" role="status">
          <div className="w-80 text-center">
            <p className="font-display text-3xl font-black">Simulating</p>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-deck">
              <div className="h-full bg-amber transition-[width]" style={{ width: `${simProgress * 100}%` }} />
            </div>
          </div>
        </div>
      )}
      {screen === "final" && !replaying && pending.park && (
        <ParkFinal
          outcome={parkOutcome(match, pending.park, contestRivals(pending))}
          onAgain={restart}
          onBack={() => router.push(pending.returnTo)}
          nextLabel="See the line"
          onNext={pending.park.mode === "line" ? () => router.push(pending.returnTo) : undefined}
        />
      )}
      {screen === "final" && !replaying && !pending.park && (
        <FinalScreen
          match={match}
          onContinue={() => router.push(pending.returnTo)}
          onRestart={restart}
          onHighlights={replay.highlights.length ? () => replay.playReel() : undefined}
        />
      )}
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
  const line = s.teams[0].roster.reduce(
    (acc, p) => {
      const b = s.box[p.id];
      if (b) {
        acc.fgm += b.fgm;
        acc.fga += b.fga;
        acc.tpm += b.tpm;
        acc.tpa += b.tpa;
      }
      return acc;
    },
    { fgm: 0, fga: 0, tpm: 0, tpa: 0 },
  );
  const pct = (m: number, a: number) => (a ? `${Math.round((m / a) * 100)}%` : "-");
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-20 flex -translate-x-1/2 gap-6 rounded-[var(--radius-chip)] bg-navy/90 px-6 py-3 ring-1 ring-line backdrop-blur">
      <div className="text-center">
        <p className="text-xs text-steel">Shooting</p>
        <p className="led text-3xl">
          {line.fgm}/{line.fga}
        </p>
        <p className="text-xs text-steel">{pct(line.fgm, line.fga)}</p>
      </div>
      <div className="text-center">
        <p className="text-xs text-steel">Threes</p>
        <p className="led text-3xl">
          {line.tpm}/{line.tpa}
        </p>
        <p className="text-xs text-steel">{pct(line.tpm, line.tpa)}</p>
      </div>
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
    <div
      className={`flex flex-1 flex-col gap-4 p-8 ${right ? "items-end text-right" : ""}`}
      style={{ background: `linear-gradient(${right ? "270deg" : "90deg"}, ${t.team.colors.primary}ee, transparent)` }}
    >
      <TeamLogo team={t.team} size={120} />
      <div>
        <p className="font-display text-2xl font-bold text-steel">{t.team.name}</p>
        <p className="font-display text-6xl font-black leading-none" style={{ color: t.team.colors.accent }}>
          {t.team.nickname}
        </p>
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {starters(t).map((p) => (
          <li key={p.id} className="flex gap-2">
            <span className="w-7 text-steel">{p.pos}</span>
            <span className="w-6 text-right text-amber">{p.jersey}</span>
            <span>
              {p.firstName} {p.lastName}
            </span>
            <span className="text-steel">{overall(p.ratings, p.pos)}</span>
          </li>
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
function PauseMenu({
  initialTab,
  match,
  camera,
  setCamera,
  onResume,
  onTimeout,
  onRestart,
  onSim,
  onQuit,
  onSaveQuit,
  onReplay,
  onHighlights,
  highlightCount,
}: {
  initialTab: "menu" | "subs";
  match: Match;
  camera: CameraMode;
  setCamera: (c: CameraMode) => void;
  onResume: () => void;
  onTimeout: (t: 0 | 1) => void;
  onRestart: () => void;
  onSim: () => void;
  onQuit: () => void;
  onSaveQuit?: () => void;
  onReplay: () => void;
  onHighlights: () => void;
  highlightCount: number;
}) {
  const [tab, setTab] = useState<"menu" | "box" | "subs" | "tactics" | "controls">(initialTab);
  const [, refresh] = useState(0);
  const [confirm, setConfirm] = useState<null | "quit" | "restart" | "sim">(null);
  const s = match.state;
  const humanTeam = s.agents.find((a) => a.human !== null)?.team ?? 0;
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, [tab]);
  const item = (label: string, onClick: () => void, ref?: React.Ref<HTMLButtonElement>) => (
    <button
      ref={ref}
      onClick={onClick}
      className="w-full rounded-[var(--radius-chip)] px-4 py-2.5 text-left font-display text-2xl font-bold text-net hover:bg-deck-2 focus-visible:bg-deck-2"
    >
      {label}
    </button>
  );
  return (
    <div className="fixed inset-0 z-40 flex bg-navy/80 backdrop-blur" data-nav-scope="modal" role="dialog" aria-label="Paused">
      <aside className="scrollbar-thin flex w-80 flex-none flex-col gap-1 overflow-y-auto border-r border-line bg-navy/90 p-6">
        <p className="mb-4 font-display text-5xl font-black">Paused</p>
        {item("Resume", onResume, tab === "menu" ? first : undefined)}
        {/* practice and the tutorial have no opponent, clock or rotation */}
        {!s.cfg.practice && item("Box score", () => setTab("box"))}
        {!s.cfg.practice && !s.cfg.park && item("Substitutions", () => setTab("subs"))}
        {!s.cfg.practice && !s.cfg.park && item("Tactics", () => setTab("tactics"))}
        {!s.cfg.practice &&
          !s.cfg.park &&
          item(`Timeout (${s.teams[humanTeam].timeouts} left)`, () => {
            onTimeout(humanTeam as 0 | 1);
            onResume();
          })}
        {item(`Camera: ${CAMERAS.find((c) => c.id === camera)?.label}`, () =>
          setCamera(CAMERAS[(CAMERAS.findIndex((c) => c.id === camera) + 1) % CAMERAS.length].id),
        )}
        {item("Instant replay", onReplay)}
        {highlightCount > 0 && item(`Highlights (${highlightCount})`, onHighlights)}
        {item("Controls", () => setTab("controls"))}
        {!s.cfg.practice && item("Sim to end", () => setConfirm("sim"))}
        {item(s.cfg.practice ? "Start over" : "Restart game", () => setConfirm("restart"))}
        {onSaveQuit && item("Save and quit", onSaveQuit)}
        {item("Quit game", () => setConfirm("quit"))}
      </aside>
      <section className="scrollbar-thin flex-1 overflow-y-auto p-8">
        {tab === "box" && <BoxScoreTable teams={[s.teams[1], s.teams[0]]} box={s.box} onCourt={[...s.teams[0].onCourt, ...s.teams[1].onCourt]} />}
        {tab === "subs" && <SubsPanel match={match} team={humanTeam as TeamIdx} />}
        {tab === "controls" && <ControlsReference />}
        {tab === "tactics" && (
          <div className="max-w-2xl">
            <h2 className="mb-1 font-display text-3xl font-black">Tactics</h2>
            <p className="mb-3 text-sm text-steel">
              {s.teams[humanTeam].team.name} {s.teams[humanTeam].team.nickname}. Changes take effect on the next possession.
            </p>
            <TacticsPanel
              value={s.teams[humanTeam].tactics}
              onChange={(t) => {
                s.teams[humanTeam].tactics = t;
                refresh((x) => x + 1);
              }}
            />
          </div>
        )}
        {tab === "menu" && <PlayByPlay match={match} />}
      </section>
      {confirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" data-nav-scope="modal" role="alertdialog" aria-label="Confirm">
          <div className="w-96 rounded-[var(--radius-panel)] bg-deck p-6 ring-1 ring-line">
            <p className="font-display text-2xl font-bold">
              {confirm === "quit" ? "Quit this game?" : confirm === "restart" ? "Restart from the opening tip?" : "Simulate the rest of the game?"}
            </p>
            <p className="mt-2 text-sm text-steel">
              {confirm === "quit"
                ? onSaveQuit
                  ? "This game will be lost. Choose Save and quit to finish it later."
                  : "Progress in this game will be lost."
                : confirm === "restart"
                  ? "The score and stats reset to zero."
                  : "The CPU plays out the remaining time for both teams."}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button autoFocus onClick={() => setConfirm(null)} className="rounded-[var(--radius-chip)] px-4 py-2 text-steel hover:text-net">
                Cancel
              </button>
              <button
                onClick={() => {
                  const c = confirm;
                  setConfirm(null);
                  if (c === "quit") onQuit();
                  else if (c === "restart") onRestart();
                  else onSim();
                }}
                className="rounded-[var(--radius-chip)] bg-amber px-4 py-2 font-semibold text-navy"
              >
                {confirm === "quit" ? "Quit game" : confirm === "restart" ? "Restart game" : "Sim to end"}
              </button>
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
            <span className="w-16 text-steel tabular-nums">
              P{r.period} {Math.floor(r.clock / 60)}:{String(Math.floor(r.clock % 60)).padStart(2, "0")}
            </span>
            <span className="w-16 tabular-nums text-steel">
              {r.score[1]}-{r.score[0]}
            </span>
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
      <button
        key={id}
        onClick={onClick}
        className={`flex w-full items-center gap-3 rounded-[var(--radius-chip)] px-3 py-2 text-left ${selected ? "bg-deck-2 ring-1 ring-amber" : "bg-deck hover:bg-deck-2"}`}
      >
        <span className="w-7 text-steel">{p.pos}</span>
        <span className="flex-1">
          {p.firstName[0]}. {p.lastName}
        </span>
        {match.isInjured(id) && <span className="rounded bg-bad/20 px-1.5 text-xs font-semibold text-bad">Injured</span>}
        <span className="text-xs text-steel">
          {line.pts} pts · {line.pf} PF
        </span>
        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-navy">
          <span className="block h-full bg-good" style={{ width: `${stam(id) * 100}%` }} />
        </span>
      </button>
    );
  };
  return (
    <div className="grid max-w-3xl grid-cols-2 gap-6">
      <div className="col-span-2 flex items-center justify-between">
        <h2 className="font-display text-3xl font-black">Substitutions</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => {
              (t as typeof t & { autoSubs?: boolean }).autoSubs = e.target.checked;
              force((x) => x + 1);
            }}
          />
          Coach makes substitutions automatically
        </label>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-sm text-steel">On the floor: pick who comes out</p>
        {t.onCourt.map((id) => row(id, () => setOut(id), out === id))}
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-sm text-steel">Bench: pick who goes in</p>
        {t.roster
          .filter((p) => !t.onCourt.includes(p.id))
          .map((p) =>
            row(
              p.id,
              () => {
                if (!out) {
                  toast("Pick a player to take out first");
                  return;
                }
                if (match.state.box[p.id].pf >= match.state.cfg.rules.foulOutLimit) {
                  toast(`${p.lastName} has fouled out`, "bad");
                  return;
                }
                if (match.isInjured(p.id)) {
                  toast(`${p.lastName} is injured`, "bad");
                  return;
                }
                match.substitute(team, out, p.id);
                toast(`${p.firstName[0]}. ${p.lastName} checks in`, "good");
                setOut(null);
                force((x) => x + 1);
              },
              false,
            ),
          )}
      </div>
    </div>
  );
}

function ControlsReference() {
  const keys = useSettings((s) => s.controls.keys);
  const rows: [string, string[]][] = [
    ["Move", ["up", "left", "down", "right"]],
    ["Sprint", ["sprint"]],
    ["Shoot (hold, release at the top)", ["shoot"]],
    ["Pass / call for ball", ["pass"]],
    ["Lob / alley-oop", ["lob"]],
    ["Bounce pass", ["bounce"]],
    ["Icon pass (hold, then 1-5)", ["iconPass"]],
    ["Crossover", ["dribbleLeft", "dribbleRight"]],
    ["Stepback", ["dribbleBack"]],
    ["Spin", ["dribbleSpin"]],
    ["Pump fake", ["pumpFake"]],
    ["Post up", ["post"]],
    ["Call pick and roll", ["callScreen"]],
    ["Steal (defense)", ["steal"]],
    ["Block / rebound (defense)", ["block"]],
    ["Intense defense", ["intenseD"]],
    ["Switch player", ["switchPlayer"]],
    ["Take charge", ["takeCharge"]],
    ["Timeout", ["timeout"]],
    ["Camera", ["camera"]],
    ["Instant replay", ["replay"]],
    ["Pause", ["pause"]],
  ];
  const lab = (c: string) =>
    c
      .replace(/^Key/, "")
      .replace(/^Digit/, "")
      .replace("ShiftLeft", "Shift")
      .replace("Arrow", "")
      .replace("Escape", "Esc");
  return (
    <div className="max-w-2xl">
      <h2 className="mb-3 font-display text-3xl font-black">Controls</h2>
      <p className="mb-4 text-sm text-steel">
        Change any binding in Settings. Gamepads work automatically; on a controller the right stick does dribble moves.
      </p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-8 gap-y-2 text-sm">
        {rows.map(([label, actions]) => (
          <div key={label} className="contents">
            <dt>{label}</dt>
            <dd className="flex gap-1">
              {actions
                .flatMap((a) => keys[a as keyof typeof keys]?.slice(0, 1) ?? [])
                .map((k, i) => (
                  <kbd key={i} className="rounded border border-line bg-deck px-1.5 py-0.5 text-xs">
                    {lab(k)}
                  </kbd>
                ))}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ------------------------------------------------------------------- final
function FinalScreen({
  match,
  onContinue,
  onRestart,
  onHighlights,
}: {
  match: Match;
  onContinue: () => void;
  onRestart: () => void;
  onHighlights?: () => void;
}) {
  const s = match.state;
  const result = useMatchStore((x) => x.lastResult);
  const all = [...s.teams[0].roster, ...s.teams[1].roster];
  const potg = all.find((p) => p.id === result?.playerOfGame);
  const potgTeam = potg ? s.teams.find((t) => t.roster.includes(potg))!.team : null;
  const line = potg ? s.box[potg.id] : null;
  const winner = s.teams[0].score > s.teams[1].score ? 0 : 1;
  const cont = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cont.current?.focus();
  }, []);
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
        <p className="text-center font-display text-2xl font-bold text-steel">
          Final{s.period > s.cfg.rules.periods ? ` / ${s.period - s.cfg.rules.periods > 1 ? `${s.period - s.cfg.rules.periods}OT` : "OT"}` : ""}
          {result?.simulated ? " (simulated)" : ""}
        </p>
        {potg && line && potgTeam && (
          <div className="flex items-center gap-4 rounded-[var(--radius-panel)] bg-deck p-5 ring-1 ring-line">
            <TeamLogo team={potgTeam} size={56} />
            <div className="flex-1">
              <p className="text-sm text-steel">Player of the game</p>
              <p className="font-display text-3xl font-black">
                {potg.firstName} {potg.lastName}
              </p>
            </div>
            <p className="font-display text-2xl font-bold tabular-nums">
              {line.pts} PTS · {line.oreb + line.dreb} REB · {line.ast} AST
            </p>
          </div>
        )}
        <BoxScoreTable teams={[s.teams[1], s.teams[0]]} box={s.box} />
        <div className="flex justify-end gap-3">
          {onHighlights && (
            <button onClick={onHighlights} className="rounded-[var(--radius-chip)] px-5 py-3 font-display text-xl font-bold text-steel hover:text-net">
              Watch highlights
            </button>
          )}
          <button onClick={onRestart} className="rounded-[var(--radius-chip)] px-5 py-3 font-display text-xl font-bold text-steel hover:text-net">
            Play again
          </button>
          <button ref={cont} onClick={onContinue} className="rounded-[var(--radius-chip)] bg-amber px-6 py-3 font-display text-xl font-bold text-navy">
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

function BenchPrompt({ onChoose }: { onChoose: (choice: "watch" | "skip" | "sim", remember: boolean) => void }) {
  const [remember, setRemember] = useState(false);
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-navy/75 backdrop-blur" role="dialog" aria-modal="true" aria-labelledby="bench-title">
      <div className="w-[min(28rem,92vw)] rounded-[var(--radius-panel)] bg-deck p-6 ring-1 ring-line">
        <h2 id="bench-title" className="font-display text-3xl font-black">
          You&apos;re on the bench
        </h2>
        <p className="mt-1 text-steel">The coach sat you down. What do you want to do until you check back in?</p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            autoFocus
            onClick={() => onChoose("watch", remember)}
            className="rounded-[var(--radius-chip)] bg-amber px-4 py-2.5 text-left font-display text-xl font-bold text-navy"
          >
            Watch from the bench
          </button>
          <button
            onClick={() => onChoose("skip", remember)}
            className="rounded-[var(--radius-chip)] bg-deck-2 px-4 py-2.5 text-left font-display text-xl font-bold ring-1 ring-line"
          >
            Fast-forward until I&apos;m back
          </button>
          <button
            onClick={() => onChoose("sim", remember)}
            className="rounded-[var(--radius-chip)] bg-deck-2 px-4 py-2.5 text-left font-display text-xl font-bold ring-1 ring-line"
          >
            Sim to the end of the game
          </button>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm text-steel">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-amber" />
          Remember my choice (change it any time in career settings)
        </label>
      </div>
    </div>
  );
}

/** 3-point contest rivals' rounds (simulated, the same every time for this game). */
function contestRivals(p: PendingMatch) {
  return (p.park?.rivals ?? []).map((r) => ({ name: `${r.firstName[0]}. ${r.lastName}`, shots: simulateContestRound(r, `${p.seed}:${r.id}`) }));
}
