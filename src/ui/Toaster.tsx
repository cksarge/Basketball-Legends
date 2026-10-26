"use client";
import { create } from "zustand";
import { useEffect } from "react";

export interface Toast { id: number; text: string; tone: "info" | "good" | "bad"; ms: number }
interface ToastStore { toasts: Toast[]; push: (text: string, tone?: Toast["tone"], ms?: number) => void; dismiss: (id: number) => void }

let nextId = 1;
export const useToasts = create<ToastStore>((set) => ({
  toasts: [],
  push: (text, tone = "info", ms = 3200) => set((s) => ({ toasts: [...s.toasts.slice(-3), { id: nextId++, text, tone, ms }] })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
export const toast = (text: string, tone?: Toast["tone"], ms?: number) => useToasts.getState().push(text, tone, ms);

function ToastItem({ t }: { t: Toast }) {
  const dismiss = useToasts((s) => s.dismiss);
  useEffect(() => {
    const h = setTimeout(() => dismiss(t.id), t.ms);
    return () => clearTimeout(h);
  }, [t, dismiss]);
  const bar = t.tone === "good" ? "bg-good" : t.tone === "bad" ? "bg-bad" : "bg-amber";
  return (
    <div role="status" className="pointer-events-auto flex items-stretch overflow-hidden rounded-[var(--radius-chip)] bg-deck/95 shadow-lg ring-1 ring-line backdrop-blur">
      <span className={`w-1 ${bar}`} aria-hidden />
      <p className="px-4 py-3 text-sm">{t.text}</p>
      <button className="px-3 text-steel hover:text-net" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">×</button>
    </div>
  );
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-6 right-6 z-[100] flex max-w-sm flex-col gap-2" data-nav-skip>
      {toasts.map((t) => <ToastItem key={t.id} t={t} />)}
    </div>
  );
}
