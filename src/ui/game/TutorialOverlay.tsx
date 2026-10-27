"use client";
import { useEffect, useRef, useState } from "react";
import type { Match } from "@/game/sim/match";
import type { ActionName } from "@/state/settings";
import { useInputDevice } from "../MenuNavigator";
import { KeyHint } from "../KeyHint";

interface Step {
  id: string;
  title: string;
  /** Text with {action} placeholders rendered as the player's own key or button. */
  body: string;
  keys: ActionName[];
  /** Progress 0..1 given what happened since the step started. */
  check: (t: Tracker) => number;
}

/** What the player has done, accumulated by the overlay from the live match. */
interface Tracker {
  moved: number;
  sprintTime: number;
  moves: Set<string>;
  shots: number;
  makes: number;
  goodReleases: number;
  rimShots: number;
  passes: number;
  pumpFakes: number;
  threes: number;
  replays: number;
}

const STEPS: Step[] = [
  { id: "move", title: "Move", body: "Walk around the floor with {up}{left}{down}{right} (or the left stick).", keys: ["up", "left", "down", "right"], check: (t) => t.moved / 12 },
  { id: "sprint", title: "Sprint", body: "Hold {sprint} while you move to sprint. Sprinting drains stamina, so save it for when it matters.", keys: ["sprint"], check: (t) => t.sprintTime / 2 },
  { id: "dribble", title: "Dribble moves", body: "Shake a defender with a crossover ({dribbleLeft} or {dribbleRight}), a spin ({dribbleSpin}) and a stepback ({dribbleBack}). Try two different moves.", keys: ["dribbleLeft", "dribbleRight", "dribbleSpin", "dribbleBack"], check: (t) => t.moves.size / 2 },
  { id: "shoot", title: "Shoot", body: "Hold {shoot} to rise into a jump shot and let go at the top of your jump. The meter shows the timing.", keys: ["shoot"], check: (t) => t.shots / 2 },
  { id: "timing", title: "Perfect release", body: "Let go of {shoot} when the meter reaches the line. Get two good or green releases.", keys: ["shoot"], check: (t) => t.goodReleases / 2 },
  { id: "rim", title: "Attack the rim", body: "Run at the basket and press {shoot} close to the rim for a layup, or a dunk if you can get up there.", keys: ["sprint", "shoot"], check: (t) => t.rimShots / 1 },
  { id: "three", title: "From deep", body: "Step behind the three-point line and knock one down.", keys: ["shoot"], check: (t) => t.threes / 1 },
  { id: "pass", title: "Pass", body: "Press {pass} to pass to the teammate you're facing, {bounce} for a bounce pass or {lob} for a lob. Hold {iconPass} and press a number to pick a teammate.", keys: ["pass", "bounce", "lob"], check: (t) => t.passes / 2 },
  { id: "fake", title: "Pump fake", body: "Press {pumpFake} to fake a shot. In a game it gets defenders off their feet, but it ends your dribble: pivot, pass or shoot after it.", keys: ["pumpFake"], check: (t) => t.pumpFakes / 1 },
  { id: "replay", title: "Instant replay", body: "Press {replay} to watch the last few seconds again, then {replay} again to come back.", keys: ["replay"], check: (t) => t.replays / 1 },
];

function renderBody(body: string, device: ReturnType<typeof useInputDevice.getState>["device"]) {
  const parts = body.split(/(\{\w+\})/g);
  return parts.map((p, i) => {
    const m = p.match(/^\{(\w+)\}$/);
    return m ? <span key={i} className="mx-0.5 inline-block align-middle"><KeyHint action={m[1] as ActionName} device={device} /></span> : <span key={i}>{p}</span>;
  });
}

/** Step-by-step guided practice. Each step completes from what the player actually does. */
export function TutorialOverlay({ match, replaying, visible, onFinish }: { match: Match; replaying: boolean; visible: boolean; onFinish: () => void }) {
  const device = useInputDevice((s) => s.device);
  const [step, setStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const tracker = useRef<Tracker>({ moved: 0, sprintTime: 0, moves: new Set(), shots: 0, makes: 0, goodReleases: 0, rimShots: 0, passes: 0, pumpFakes: 0, threes: 0, replays: 0 });
  const seen = useRef({ events: 0, last: null as { x: number; z: number } | null, wasReplay: false, lastFake: -1 });

  // reset what the current step counts when it begins
  useEffect(() => {
    tracker.current = { moved: 0, sprintTime: 0, moves: new Set(), shots: 0, makes: 0, goodReleases: 0, rimShots: 0, passes: 0, pumpFakes: 0, threes: 0, replays: 0 };
  }, [step]);

  useEffect(() => {
    if (done) return;
    const h = setInterval(() => {
      const s = match.state;
      const t = tracker.current;
      const me = s.agents.find((a) => a.human === 0);
      const sv = seen.current;
      if (me) {
        if (sv.last) t.moved += Math.hypot(me.pos.x - sv.last.x, me.pos.z - sv.last.z);
        sv.last = { x: me.pos.x, z: me.pos.z };
        if (Math.hypot(me.vel.x, me.vel.z) > match.maxSpeed(me, false) * 1.08) t.sprintTime += 0.1;
        const fake = me.action.kind === "gather" && me.action.data.fake;
        if (fake && sv.lastFake !== s.time - me.action.t) { sv.lastFake = s.time - me.action.t; t.pumpFakes++; }
      }
      // new game events since the last check
      for (let i = sv.events; i < s.events.length; i++) {
        const e = s.events[i];
        const mine = (idx: number) => s.agents[idx]?.human === 0;
        if (e.t === "dribbleMove" && mine(e.player)) t.moves.add(e.move === "betweenLegs" || e.move === "behindBack" ? "crossover" : e.move);
        if (e.t === "shot" && mine(e.shooter)) {
          t.shots++;
          if (e.kind === "layup" || e.kind === "dunk") t.rimShots++;
        }
        if (e.t === "make" && mine(e.shooter)) { t.makes++; if (e.points === 3) t.threes++; }
        if (e.t === "pass" && mine(e.from)) t.passes++;
      }
      sv.events = s.events.length;
      // good timing: read the release quality the meter showed
      if (me && ["jumper", "fadeaway", "floater"].includes(me.action.kind)) {
        const q = Number(me.action.data.quality);
        if (!Number.isNaN(q) && Math.abs(q) < 0.22 && !me.action.data.tutorialCounted) { me.action.data.tutorialCounted = true; t.goodReleases++; }
      }
      if (replaying && !sv.wasReplay) t.replays++;
      sv.wasReplay = replaying;
      const p = Math.min(1, STEPS[step].check(t));
      setProgress(p);
      if (p >= 1) {
        if (step + 1 >= STEPS.length) setDone(true);
        else setStep((x) => x + 1);
      }
    }, 100);
    return () => clearInterval(h);
  }, [match, step, done, replaying]);

  const cur = STEPS[step];
  return (
    <div hidden={!visible} className="fixed left-5 top-32 z-30 w-[min(360px,calc(100vw-2.5rem))] rounded-[var(--radius-panel)] bg-navy/92 p-5 shadow-2xl ring-1 ring-line backdrop-blur" role="region" aria-label="Tutorial" aria-live="polite">
      {done ? (
        <>
          <p className="font-display text-sm font-bold uppercase tracking-widest text-amber">Tutorial complete</p>
          <p className="mt-1 font-display text-3xl font-black">You&apos;re ready</p>
          <p className="mt-2 text-sm text-steel">On defense: stay between your man and the basket, {renderBody("{steal} to steal, {block} to block or rebound, {intenseD} for a tight stance, and {switchPlayer} to switch to the defender nearest the ball.", device)}</p>
          <div className="mt-4 flex gap-2">
            <button onClick={onFinish} className="rounded-[var(--radius-chip)] bg-amber px-4 py-2 font-display text-lg font-bold text-navy">Play a game</button>
            <button onClick={() => { setDone(false); setStep(0); }} className="rounded-[var(--radius-chip)] px-4 py-2 font-display text-lg font-bold text-steel hover:text-net">Start over</button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="font-display text-sm font-bold uppercase tracking-widest text-amber">Step {step + 1} of {STEPS.length}</p>
            <button onClick={() => (step + 1 >= STEPS.length ? setDone(true) : setStep(step + 1))} className="text-xs font-semibold text-steel hover:text-net">Skip step</button>
          </div>
          <p className="mt-1 font-display text-3xl font-black">{cur.title}</p>
          <p className="mt-2 leading-relaxed text-net">{renderBody(cur.body, device)}</p>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-deck"><div className="h-full bg-amber transition-[width] duration-200" style={{ width: `${progress * 100}%` }} /></div>
          <ol className="mt-4 flex gap-1" aria-hidden>
            {STEPS.map((s2, i) => <li key={s2.id} className={`h-1 flex-1 rounded-full ${i < step ? "bg-good" : i === step ? "bg-amber" : "bg-deck"}`} />)}
          </ol>
        </>
      )}
    </div>
  );
}
