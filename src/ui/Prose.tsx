import Link from "next/link";

/** Static reading layout for info and legal pages (server component). */
export function ProsePage({ title, updated, children }: { title: string; updated?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-navy">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-5 py-4">
          <Link href="/" className="text-steel hover:text-net">← Main menu</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-10">
        <h1 className="font-display text-5xl font-black">{title}</h1>
        {updated && <p className="mt-2 text-sm text-steel">Last updated {updated}</p>}
        <div className="prose-bl mt-8 flex flex-col gap-5 leading-relaxed text-net/90">{children}</div>
      </main>
    </div>
  );
}

export function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-4 font-display text-3xl font-black text-net">{children}</h2>;
}
