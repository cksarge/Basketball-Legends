import Link from "next/link";

export default function Home() {
  return (
    <main className="grid min-h-dvh place-items-center">
      <div className="flex flex-col items-center gap-6">
        <h1 className="font-display text-7xl font-black">Basketball Legends</h1>
        <Link href="/game/" className="rounded-[var(--radius-chip)] bg-amber px-6 py-3 font-display text-2xl font-bold text-navy">Play now</Link>
      </div>
    </main>
  );
}
