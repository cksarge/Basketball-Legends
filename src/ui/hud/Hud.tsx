"use client";
import { useEffect, useRef, useState } from "react";
import type { Team } from "@/engine/types";
import { useHud } from "@/state/matchStore";
import { useSettings } from "@/state/settings";
import { TeamLogo } from "../TeamLogo";
import { useInputDevice } from "../MenuNavigator";
import { KeyHint } from "../KeyHint";

function fmtClock(sec: number) {
  if (sec < 60) return Math.max(0, sec).toFixed(1);
  const m = Math.floor(sec / 60),
    s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function periodLabel(p: number, periods: number) {
  if (p > periods) return p - periods > 1 ? `OT${p - periods}` : "OT";
  return periods === 2 ? (p === 1 ? "1st half" : "2nd half") : (["1st", "2nd", "3rd", "4th"][p - 1] ?? `${p}th`);
}

export function ScoreBug({ home, away }: { home: Team; away: Team }) {
  const hud = useHud((s) => s.hud);
  const contrast = useSettings((s) => s.accessibility.highContrastHud);
  if (!hud) return null;
  const side = (t: Team, score: number, fouls: number, tos: number, bonus: boolean, poss: boolean, right: boolean) => (
    <div className={`flex items-center gap-2 ${right ? "flex-row-reverse" : ""}`}>
      <div className="flex h-12 items-center gap-2 px-3" style={{ background: t.colors.primary }}>
        <TeamLogo team={t} size={30} />
        <span className="font-display text-2xl font-extrabold tracking-wide" style={{ color: t.colors.accent }}>
          {t.abbrev}
        </span>
      </div>
      <span className="led w-14 text-center text-4xl font-black text-net" style={{ color: contrast ? "#fff" : undefined }}>
        {score}
      </span>
      <div className={`flex flex-col gap-1 text-[11px] text-steel ${right ? "items-end" : ""}`}>
        <div className="flex gap-0.5" aria-label={`${tos} timeouts left`}>
          {Array.from({ length: Math.min(7, tos) }, (_, i) => (
            <span key={i} className="h-1 w-2.5 rounded-sm bg-amber/80" />
          ))}
        </div>
        <span>{bonus ? <b className="text-amber">Bonus</b> : `Fouls ${fouls}`}</span>
      </div>
      <span className={`h-2 w-2 rounded-full ${poss ? "bg-amber" : "bg-transparent"}`} aria-label={poss ? "Possession" : undefined} />
    </div>
  );
  const sc = hud.shotClock;
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-20 -translate-x-1/2 select-none" aria-live="off">
      <div className="flex items-stretch overflow-hidden rounded-[var(--radius-chip)] bg-navy/90 shadow-2xl ring-1 ring-line backdrop-blur">
        {side(away, hud.awayScore, hud.awayFouls, hud.awayTimeouts, hud.bonus[1], hud.possession === 1, false)}
        <div className="flex min-w-36 flex-col items-center justify-center border-x border-line bg-deck px-4">
          <span className="font-display text-sm font-bold text-steel">{periodLabel(hud.period, hud.periods)}</span>
          <span className="led text-2xl leading-none">{fmtClock(hud.clock)}</span>
        </div>
        {side(home, hud.homeScore, hud.homeFouls, hud.homeTimeouts, hud.bonus[0], hud.possession === 0, true)}
        {sc !== null && (
          <div className={`flex w-14 items-center justify-center bg-black ${sc <= 5 ? "text-bad" : "text-amber"}`}>
            <span className="led text-3xl" style={{ color: "inherit" }}>
              {sc < 10 && sc > 0 ? sc.toFixed(0) : Math.ceil(Math.max(0, sc))}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Shot timing: the bar fills while the shot button is held; let go when it reaches the green
 * band. After the release the bar keeps the result colour and names it for a moment.
 */
export function ShotMeter() {
  const meter = useHud((s) => s.hud?.meter ?? null);
  const [flash, setFlash] = useState<string | null>(null);
  const shown = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const result = meter?.result ?? null;
  useEffect(() => {
    // one flash per shot: the HUD snapshot is rebuilt every frame, so key off the result itself
    if (result && result !== shown.current) {
      shown.current = result;
      setFlash(result);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setFlash(null), 900);
    }
    if (!meter) shown.current = null;
  }, [result, meter]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const show = meter || flash;
  if (!show) return null;
  const fill = meter?.fill ?? 1;
  const ideal = meter?.ideal ?? 0.74;
  const green = meter?.green ?? 0.03;
  const label =
    flash === "green"
      ? "Perfect release"
      : flash === "good"
        ? "Good release"
        : flash === "early"
          ? "Slightly early"
          : flash === "late"
            ? "Slightly late"
            : null;
  const color = flash === "green" ? "var(--color-good)" : flash === "good" ? "var(--color-amber)" : flash ? "var(--color-bad)" : "var(--color-net)";
  return (
    // the bar is pinned in place; the result text hangs below it without moving the bar
    <div className="pointer-events-none fixed right-[18%] top-1/2 z-20 -translate-y-1/2" aria-hidden>
      <div className="relative h-44 w-4 overflow-hidden rounded-full bg-navy/80 ring-1 ring-line">
        <div className="absolute inset-x-0 min-h-1 bg-good/80" style={{ bottom: `${(ideal - green) * 100}%`, height: `${green * 200}%` }} />
        <div className="absolute inset-x-0 bottom-0 rounded-full" style={{ height: `${fill * 100}%`, background: color, transition: "background 120ms" }} />
      </div>
      {label && (
        <span
          className="absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded bg-navy/80 px-2 py-0.5 font-display text-lg font-bold"
          style={{ color }}
        >
          {label}
        </span>
      )}
    </div>
  );
}

export function PlayerTag() {
  const c = useHud((s) => s.hud?.controlled ?? null);
  if (!c) return null;
  return (
    <div className="pointer-events-none fixed bottom-5 left-5 z-20 flex items-center gap-3 rounded-[var(--radius-chip)] bg-navy/85 px-3 py-2 ring-1 ring-line backdrop-blur">
      <span className="led text-2xl">{c.number}</span>
      <div className="flex flex-col">
        <span className="font-display text-lg font-bold leading-tight">{c.name}</span>
        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-deck" aria-label={`Stamina ${Math.round(c.stamina * 100)} percent`}>
          <div
            className="h-full rounded-full"
            style={{
              width: `${c.stamina * 100}%`,
              background: c.stamina > 0.6 ? "var(--color-good)" : c.stamina > 0.4 ? "var(--color-amber)" : "var(--color-bad)",
            }}
          />
        </div>
      </div>
    </div>
  );
}

export function CommentaryFeed() {
  const feed = useHud((s) => s.feed);
  const subtitles = useSettings((s) => s.accessibility.subtitles);
  // the last three lines show; after a quiet spell only the newest stays
  const [quietAt, setQuietAt] = useState<number | null>(null);
  const lastId = feed[feed.length - 1]?.id ?? null;
  useEffect(() => {
    if (lastId === null) return;
    const h = setTimeout(() => setQuietAt(lastId), 4500);
    return () => clearTimeout(h);
  }, [lastId]);
  const visible = quietAt !== null && quietAt === lastId ? feed.slice(-1) : feed.slice(-3);
  if (!subtitles || !visible.length) return null;
  return (
    <div className="pointer-events-none fixed left-1/2 top-6 z-20 flex w-[min(720px,90vw)] -translate-x-1/2 flex-col items-center gap-1" aria-live="polite">
      {visible.map((f, i) => (
        <p
          key={f.id}
          className="rounded-md bg-navy/75 px-3 py-1 text-center text-[15px] text-net backdrop-blur"
          style={{ opacity: i === visible.length - 1 ? 1 : 0.55 }}
        >
          {f.text}
        </p>
      ))}
    </div>
  );
}

export function ControlsStrip({ onOffense }: { onOffense: boolean }) {
  const device = useInputDevice((s) => s.device);
  const prompts = useSettings((s) => s.controls.prompts);
  const show = useSettings((s) => s.presentation.showTips);
  if (!show) return null;
  const items: [string, string][] = onOffense
    ? [
        ["shoot", "Shoot"],
        ["pass", "Pass"],
        ["lob", "Lob"],
        ["sprint", "Sprint"],
        ["dribbleLeft", "Moves"],
        ["pause", "Pause"],
      ]
    : [
        ["block", "Block"],
        ["steal", "Steal"],
        ["intenseD", "Intense D"],
        ["switchPlayer", "Switch"],
        ["sprint", "Sprint"],
        ["pause", "Pause"],
      ];
  return (
    <div className="pointer-events-none fixed right-5 top-5 z-20 flex max-w-md flex-wrap justify-end gap-x-3 gap-y-1 rounded-[var(--radius-chip)] bg-navy/70 px-3 py-2 text-xs text-steel backdrop-blur">
      {items.map(([a, label]) => (
        <span key={a} className="flex items-center gap-1.5">
          <KeyHint action={a as never} device={prompts === "auto" ? device : prompts === "keyboard" ? "keyboard" : prompts} />
          {label}
        </span>
      ))}
    </div>
  );
}

/** Big-play banner across the top of the screen. */
export function PlayBannerView() {
  const banner = useHud((s) => s.banner);
  const [doneId, setDoneId] = useState<number | null>(null);
  useEffect(() => {
    if (!banner) return;
    const h = setTimeout(() => setDoneId(banner.id), 2300);
    return () => clearTimeout(h);
  }, [banner]);
  const shown = banner && banner.id !== doneId ? banner : null;
  if (!shown) return null;
  return (
    <div key={shown.id} className="bl-banner pointer-events-none fixed left-1/2 top-[14vh] z-20 select-none text-center" role="status">
      <div className="px-10 py-2 shadow-2xl" style={{ background: `linear-gradient(90deg, transparent, ${shown.color} 12%, ${shown.color} 88%, transparent)` }}>
        <p className="font-display text-6xl font-black italic tracking-wide" style={{ color: shown.accent, textShadow: "0 3px 0 rgb(0 0 0 / 0.35)" }}>
          {shown.title}
        </p>
      </div>
      {shown.sub && <p className="mt-1 font-display text-xl font-bold text-net drop-shadow">{shown.sub}</p>}
    </div>
  );
}

/** Lower-third stat card for a player (scoring milestones, free-throw shooters). */
export function StatOverlayView() {
  const overlay = useHud((s) => s.overlay);
  const [doneId, setDoneId] = useState<number | null>(null);
  useEffect(() => {
    if (!overlay) return;
    const h = setTimeout(() => setDoneId(overlay.id), 4200);
    return () => clearTimeout(h);
  }, [overlay]);
  const o = overlay && overlay.id !== doneId ? overlay : null;
  if (!o) return null;
  return (
    <div
      key={o.id}
      className="bl-lower-third pointer-events-none fixed bottom-24 left-6 z-20 flex select-none overflow-hidden rounded-[var(--radius-chip)] shadow-2xl ring-1 ring-line"
      role="status"
    >
      <div className="flex w-14 items-center justify-center font-display text-3xl font-black" style={{ background: o.color, color: o.accent }}>
        {o.jersey}
      </div>
      <div className="bg-navy/95 px-4 py-2 backdrop-blur">
        <p className="font-display text-xl font-black uppercase leading-tight tracking-wide">
          {o.name} <span className="ml-1 text-sm font-bold text-steel">{o.team}</span>
        </p>
        {o.lines.map((l) => (
          <p key={l} className="text-sm tabular-nums text-net">
            {l}
          </p>
        ))}
      </div>
    </div>
  );
}
