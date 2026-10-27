import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

export default function NotFound() {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-navy px-6">
      {/* a three-point arc and lane, drawn like a court diagram */}
      <svg aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-[28vh] mx-auto w-[min(1100px,140vw)] text-deck-2" viewBox="0 0 1000 520" fill="none" stroke="currentColor" strokeWidth="4">
        <path d="M60 520 V380 A440 440 0 0 1 940 380 V520" />
        <rect x="380" y="300" width="240" height="220" />
        <circle cx="500" cy="300" r="120" strokeDasharray="14 12" />
        <circle cx="500" cy="470" r="18" />
      </svg>
      <div className="relative flex max-w-xl flex-col items-center gap-5 text-center">
        <p className="led text-[9rem] font-black leading-none">404</p>
        <h1 className="font-display text-5xl font-black">Airball.</h1>
        <p className="text-lg text-steel">That page doesn&apos;t exist. The link may be old, or the address may have a typo.</p>
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          <Link href="/" className="rounded-[var(--radius-chip)] bg-amber px-6 py-3 font-display text-xl font-bold text-navy">Main menu</Link>
          <Link href="/play/" className="rounded-[var(--radius-chip)] bg-deck-2 px-6 py-3 font-display text-xl font-bold text-net ring-1 ring-line">Quick Play</Link>
        </div>
      </div>
    </main>
  );
}
