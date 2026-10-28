"use client";
// Tryout day: three short drills whose results nudge the coach's evaluation (-4..+4).
// Works with mouse/touch, keyboard (Space/Enter, arrow keys) and a gamepad (A, d-pad).
import { useCallback, useEffect, useRef, useState } from "react";
import type { Ratings } from "@/engine/types";
import { Button, Panel } from "@/ui/kit";

type Drill = "shoot" | "slides" | "sprint" | "done";

/** Combines drill scores (each 0..1) into the evaluation bonus. */
export function drillBonus(scores: number[]) {
  const avg = scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length);
  return Math.round((avg - 0.5) * 8);
}

function usePadButtons(onPress: (b: "a" | "left" | "right") => void) {
  const prev = useRef({ a: false, left: false, right: false });
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const pad = [...(navigator.getGamepads?.() ?? [])].find((p): p is Gamepad => !!p && p.connected);
      if (pad) {
        const now = {
          a: !!pad.buttons[0]?.pressed,
          left: !!pad.buttons[14]?.pressed || (pad.axes[0] ?? 0) < -0.6,
          right: !!pad.buttons[15]?.pressed || (pad.axes[0] ?? 0) > 0.6,
        };
        for (const k of ["a", "left", "right"] as const) if (now[k] && !prev.current[k]) onPress(k);
        prev.current = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onPress]);
}

export function TryoutDrills({ ratings, onDone, onSkip }: { ratings: Ratings; onDone: (bonus: number, scores: number[]) => void; onSkip: () => void }) {
  const [drill, setDrill] = useState<Drill>("shoot");
  const [scores, setScores] = useState<number[]>([]);
  const finish = (score: number, next: Drill) => {
    const all = [...scores, score];
    setScores(all);
    setDrill(next);
    if (next === "done") onDone(drillBonus(all), all);
  };
  return (
    <Panel title="Tryouts">
      <p className="mb-4 text-sm text-steel">
        Three drills in front of the coaching staff. Your ratings set how forgiving each one is, and how you do nudges where you land. Space, Enter, a click or
        a tap works for every drill; arrow keys or the d-pad for slides.
      </p>
      <ol className="mb-4 flex gap-2 text-sm">
        {(["shoot", "slides", "sprint"] as const).map((d, i) => (
          <li key={d} className={`rounded-full px-3 py-1 ${drill === d ? "bg-amber text-navy" : i < scores.length ? "bg-good/30" : "bg-deck-2 text-steel"}`}>
            {i + 1}. {d === "shoot" ? "Spot shooting" : d === "slides" ? "Defensive slides" : "Conditioning"}
            {i < scores.length && ` · ${Math.round(scores[i] * 100)}`}
          </li>
        ))}
      </ol>
      {drill === "shoot" && <ShootDrill skill={(ratings.three + ratings.midRange + ratings.freeThrow) / 3} onDone={(s) => finish(s, "slides")} />}
      {drill === "slides" && <SlideDrill skill={(ratings.perimeterD + ratings.speed + ratings.accel) / 3} onDone={(s) => finish(s, "sprint")} />}
      {drill === "sprint" && <SprintDrill skill={(ratings.stamina + ratings.speed) / 2} onDone={(s) => finish(s, "done")} />}
      {drill !== "done" && (
        <Button variant="ghost" className="mt-4" onClick={onSkip}>
          Skip the drills (the coach goes by your ratings)
        </Button>
      )}
    </Panel>
  );
}

/** Stop the marker in the green zone, five shots. Zone width grows with shooting skill. */
function ShootDrill({ skill, onDone }: { skill: number; onDone: (score: number) => void }) {
  const [shots, setShots] = useState<boolean[]>([]);
  const [pos, setPos] = useState(0);
  const t = useRef(0);
  const zone = 0.08 + (skill / 99) * 0.14;
  const center = 0.72;
  useEffect(() => {
    let raf = 0,
      last = performance.now();
    const tick = (now: number) => {
      t.current += (now - last) / 1000;
      last = now;
      setPos((Math.sin(t.current * (2.2 + shots.length * 0.25)) + 1) / 2);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [shots.length]);
  const shoot = useCallback(() => {
    const make = Math.abs(pos - center) <= zone / 2;
    const next = [...shots, make];
    setShots(next);
    if (next.length >= 5) setTimeout(() => onDone(next.filter(Boolean).length / 5), 400);
  }, [pos, shots, zone, onDone]);
  useKeys((k) => (k === "a" ? shoot() : undefined));
  usePadButtons(useCallback((b) => (b === "a" ? shoot() : undefined), [shoot]));
  return (
    <div>
      <p className="mb-2 font-semibold">Spot shooting: release in the green ({shots.length}/5)</p>
      <button onClick={shoot} className="relative block h-12 w-full overflow-hidden rounded-[var(--radius-chip)] bg-navy ring-1 ring-line" aria-label="Shoot">
        <span className="absolute inset-y-0 bg-good/50" style={{ left: `${(center - zone / 2) * 100}%`, width: `${zone * 100}%` }} />
        <span className="absolute inset-y-1 w-1.5 rounded bg-amber" style={{ left: `calc(${pos * 100}% - 3px)` }} />
      </button>
      <p className="mt-2 text-2xl" aria-live="polite">
        {shots.map((m, i) => (
          <span key={i} className={m ? "text-good" : "text-bad"}>
            {m ? "●" : "○"}{" "}
          </span>
        ))}
      </p>
    </div>
  );
}

/** React to the coach's point: left or right, six reps, scored on speed and accuracy. */
function SlideDrill({ skill, onDone }: { skill: number; onDone: (score: number) => void }) {
  const [rep, setRep] = useState(0);
  const [dir, setDir] = useState<"left" | "right" | null>(null);
  const [results, setResults] = useState<number[]>([]);
  const shownAt = useRef(0);
  const window_ = 0.55 + (skill / 99) * 0.6; // seconds for full credit
  useEffect(() => {
    if (rep >= 6) return;
    const id = setTimeout(
      () => {
        setDir(Math.random() < 0.5 ? "left" : "right");
        shownAt.current = performance.now();
      },
      700 + Math.random() * 900,
    );
    return () => clearTimeout(id);
  }, [rep]);
  const press = useCallback(
    (d: "left" | "right") => {
      if (!dir) return;
      const secs = (performance.now() - shownAt.current) / 1000;
      const score = d !== dir ? 0 : Math.max(0, Math.min(1, 1 - (secs - window_) / window_));
      const next = [...results, score];
      setResults(next);
      setDir(null);
      setRep((r) => r + 1);
      if (next.length >= 6) setTimeout(() => onDone(next.reduce((a, b) => a + b, 0) / 6), 300);
    },
    [dir, results, window_, onDone],
  );
  useKeys((k) => (k === "left" || k === "right" ? press(k) : undefined));
  usePadButtons(useCallback((b) => (b === "left" || b === "right" ? press(b) : undefined), [press]));
  return (
    <div>
      <p className="mb-2 font-semibold">Defensive slides: slide the way the coach points ({results.length}/6)</p>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <Button variant="secondary" onClick={() => press("left")} aria-label="Slide left">
          ← Left
        </Button>
        <span className="w-24 text-center font-display text-5xl font-black text-amber" aria-live="assertive">
          {dir === "left" ? "←" : dir === "right" ? "→" : "·"}
        </span>
        <Button variant="secondary" onClick={() => press("right")} aria-label="Slide right">
          Right →
        </Button>
      </div>
    </div>
  );
}

/** Tap as fast as you can for five seconds; the target depends on stamina and speed. */
function SprintDrill({ skill, onDone }: { skill: number; onDone: (score: number) => void }) {
  const [taps, setTaps] = useState(0);
  const [start, setStart] = useState<number | null>(null);
  const [left, setLeft] = useState(5);
  const target = 34 - (skill / 99) * 12;
  const done = useRef(false);
  useEffect(() => {
    if (start === null) return;
    const id = setInterval(() => {
      const l = Math.max(0, 5 - (performance.now() - start) / 1000);
      setLeft(l);
      if (l <= 0 && !done.current) {
        done.current = true;
        clearInterval(id);
        setTaps((n) => {
          setTimeout(() => onDone(Math.min(1, n / target)), 300);
          return n;
        });
      }
    }, 100);
    return () => clearInterval(id);
  }, [start, target, onDone]);
  const tap = useCallback(() => {
    if (done.current) return;
    if (start === null) setStart(performance.now());
    setTaps((n) => n + 1);
  }, [start]);
  useKeys((k) => (k === "a" ? tap() : undefined));
  usePadButtons(useCallback((b) => (b === "a" ? tap() : undefined), [tap]));
  return (
    <div>
      <p className="mb-2 font-semibold">Conditioning: tap to run the line drill. The clock starts on your first tap.</p>
      <button onClick={tap} className="relative block h-12 w-full overflow-hidden rounded-[var(--radius-chip)] bg-navy ring-1 ring-line" aria-label="Run">
        <span className="absolute inset-y-0 left-0 bg-amber/70" style={{ width: `${Math.min(100, (taps / target) * 100)}%` }} />
        <span className="relative font-display text-xl font-black">{start === null ? "Tap to start" : `${left.toFixed(1)}s`}</span>
      </button>
    </div>
  );
}

function useKeys(onKey: (k: "a" | "left" | "right") => void) {
  const ref = useRef(onKey);
  useEffect(() => {
    ref.current = onKey;
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const k =
        e.key === " " || e.key === "Enter" ? "a" : e.key === "ArrowLeft" || e.key === "a" ? "left" : e.key === "ArrowRight" || e.key === "d" ? "right" : null;
      if (!k) return;
      e.preventDefault();
      ref.current(k);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
}
