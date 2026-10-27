"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId } from "react";
import { BACK_EVENT } from "./MenuNavigator";

/** Standard page frame: back link, title, optional actions; Escape / B goes back. */
export function PageShell({ title, back = "/", backLabel = "Back", children, actions, wide }: {
  title: string; back?: string | null; backLabel?: string; children: React.ReactNode; actions?: React.ReactNode; wide?: boolean;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!back) return;
    const go = () => router.push(back);
    window.addEventListener(BACK_EVENT, go);
    return () => window.removeEventListener(BACK_EVENT, go);
  }, [back, router]);
  return (
    <div className="min-h-dvh bg-navy">
      <header className="sticky top-0 z-30 border-b border-line bg-navy/90 backdrop-blur">
        <div className={`mx-auto flex items-center gap-4 px-4 py-3 sm:px-6 ${wide ? "max-w-7xl" : "max-w-5xl"}`}>
          {back && (
            <Link href={back} className="rounded-[var(--radius-chip)] px-2 py-1 text-steel hover:text-net" aria-label={backLabel}>
              ← {backLabel}
            </Link>
          )}
          <h1 className="flex-1 font-display text-3xl font-black sm:text-4xl">{title}</h1>
          {actions}
        </div>
      </header>
      <main className={`mx-auto px-4 py-6 sm:px-6 ${wide ? "max-w-7xl" : "max-w-5xl"}`}>{children}</main>
    </div>
  );
}

export function Button({ children, variant = "primary", className = "", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  const v = variant === "primary" ? "bg-amber text-navy hover:brightness-110" : variant === "secondary" ? "bg-deck-2 text-net ring-1 ring-line hover:bg-line" : "text-steel hover:text-net";
  return (
    <button {...rest} className={`rounded-[var(--radius-chip)] px-5 py-2.5 font-display text-xl font-bold transition disabled:opacity-40 ${v} ${className}`}>
      {children}
    </button>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <label htmlFor={id} className="flex flex-col">
        <span>{label}</span>
        {hint && <span className="text-xs text-steel">{hint}</span>}
      </label>
      <button id={id} role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 flex-none rounded-full transition ${checked ? "bg-amber" : "bg-line"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-net transition-all ${checked ? "left-5.5" : "left-0.5"}`} />
      </button>
    </div>
  );
}

export function Slider({ label, value, min, max, step = 0.05, onChange, format }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <label htmlFor={id}>{label}</label>
      <div className="flex items-center gap-3">
        <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-44 accent-amber" />
        <span className="w-14 text-right text-sm tabular-nums text-steel">{format ? format(value) : value.toFixed(2)}</span>
      </div>
    </div>
  );
}

export function Select<T extends string | number>({ label, value, options, onChange, hint }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <label htmlFor={id} className="flex flex-col">
        <span>{label}</span>
        {hint && <span className="text-xs text-steel">{hint}</span>}
      </label>
      <select id={id} value={String(value)} onChange={(e) => {
        const o = options.find((x) => String(x.value) === e.target.value);
        if (o) onChange(o.value);
      }} className="rounded-[var(--radius-chip)] bg-deck-2 px-3 py-1.5 text-net ring-1 ring-line">
        {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
    </div>
  );
}

/** Segmented control for small option sets. */
export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-[var(--radius-chip)] bg-deck p-1 ring-1 ring-line">
      {options.map((o) => (
        <button key={String(o.value)} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={`rounded-[4px] px-3 py-1.5 text-sm font-semibold ${value === o.value ? "bg-amber text-navy" : "text-steel hover:text-net"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Panel({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-[var(--radius-panel)] bg-deck p-5 ring-1 ring-line ${className}`}>
      {title && <h2 className="mb-2 font-display text-2xl font-black">{title}</h2>}
      {children}
    </section>
  );
}
