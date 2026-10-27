"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { REPLAY_CAMS, type ReplayDirector } from "@/game3d/replay";
import { useSettings } from "@/state/settings";
import { keyLabel } from "../KeyHint";

/** Re-render whenever the director changes (play/stop/speed/camera). */
export function useReplay(director: ReplayDirector) {
  useSyncExternalStore(
    (fn) => director.subscribe(fn),
    () => director.version,
    () => 0,
  );
  return director.playback;
}

const SPEEDS = [0.125, 0.25, 0.5, 1];

export function ReplayOverlay({ director }: { director: ReplayDirector }) {
  const pb = useReplay(director);
  const keys = useSettings((s) => s.controls.keys);
  const [progress, setProgress] = useState(0);
  // progress bar follows playback smoothly
  useEffect(() => {
    if (!pb) return;
    let raf = 0;
    const loop = () => {
      setProgress(director.progress());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [pb, director]);
  if (!pb) return null;
  const k = (a: keyof typeof keys) => keyLabel(keys[a]?.[0] ?? "");
  const base = "rounded-[var(--radius-chip)] px-3 py-1.5 text-sm font-semibold ring-1";
  const btn = `${base} bg-deck/90 text-net ring-line hover:bg-deck-2`;
  const hot = `${base} bg-amber text-navy ring-amber`;
  return (
    <>
      {/* letterbox bars + replay bug */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[12] h-[7vh] bg-black/80" />
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[12] h-[7vh] bg-black/80" />
      <div className="pointer-events-none fixed left-6 top-[9vh] z-30 flex items-center gap-3">
        <span className="animate-pulse rounded bg-bad px-2.5 py-1 font-display text-xl font-black tracking-wider text-white">REPLAY</span>
        <span className="font-display text-2xl font-bold text-net drop-shadow">{pb.clip.label}</span>
        {pb.queue.length > 0 && <span className="text-sm text-steel">{pb.queue.length} more</span>}
      </div>
      {pb.auto ? (
        <p className="pointer-events-none fixed bottom-[110px] right-6 z-30 text-sm text-steel">Press {k("shoot")} to skip</p>
      ) : (
        <div className="fixed inset-x-0 bottom-[104px] z-30 mx-auto flex w-[min(720px,92vw)] flex-col gap-2" data-nav-scope="replay">
          <div className="h-1.5 overflow-hidden rounded-full bg-deck/80">
            <div className="h-full bg-amber" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button className={btn} onClick={() => director.scrub(-2)} aria-label="Back two seconds">
              -2s
            </button>
            <button className={btn} onClick={() => director.setPlaying(!pb.playing)}>
              {pb.playing ? "Pause" : "Play"} <kbd className="ml-1 text-xs text-steel">{k("shoot")}</kbd>
            </button>
            <button className={btn} onClick={() => director.scrub(2)} aria-label="Forward two seconds">
              +2s
            </button>
            <span className="mx-1 text-sm text-steel">Speed</span>
            {SPEEDS.map((sp) => (
              <button key={sp} className={pb.speed === sp ? hot : btn} onClick={() => director.setSpeed(sp)}>
                {sp === 1 ? "1x" : sp === 0.5 ? "½x" : sp === 0.25 ? "¼x" : "⅛x"}
              </button>
            ))}
            <button className={btn} onClick={() => director.cycleCam(1)}>
              Camera: {REPLAY_CAMS[pb.cam].label} <kbd className="ml-1 text-xs text-steel">{k("camera")}</kbd>
            </button>
            <button className={hot} onClick={() => director.stop()}>
              Exit <kbd className="ml-1 text-xs">{k("replay")}</kbd>
            </button>
          </div>
          <p className="text-center text-xs text-steel">
            {k("dribbleLeft")} / {k("dribbleRight")} scrub · {k("dribbleBack")} / {k("dribbleSpin")} slower / faster
          </p>
        </div>
      )}
    </>
  );
}
