"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatDate } from "@/career/format";
import { deleteFranchise, exportFranchise, importFranchise, pastSeasons, listFranchises, loadFranchise } from "@/franchise/storage";
import type { Franchise, FranchiseSummary } from "@/franchise/types";
import { franchiseTeam } from "@/state/franchiseStore";
import { pruneFranchiseSaves } from "@/state/suspended";
import { Button, PageShell, Panel } from "@/ui/kit";
import { toast } from "@/ui/Toaster";
import { downloadText, fileSlug } from "@/ui/download";

export function FranchiseSelect() {
  const router = useRouter();
  const [saves, setSaves] = useState<FranchiseSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    listFranchises()
      .then(setSaves)
      .catch(() => {
        setSaves([]);
        setFailed(true);
      });
  }, []);
  useEffect(refresh, [refresh]);

  const onExport = async (s: FranchiseSummary) => {
    const f = await loadFranchise(s.id);
    if (!f) return;
    downloadText(`${fileSlug(s.teamName)}.blfranchise`, exportFranchise(f, await pastSeasons(s.id)));
    toast("Franchise exported");
  };

  const onImport = async (file: File) => {
    try {
      const text = await file.text();
      const team = await teamFromText(text);
      const f = await importFranchise(text, () => team);
      toast(`Imported ${team ? team.name : f.teamId}`, "good");
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't import that file", "bad");
    }
  };

  const onDelete = async (id: string) => {
    await deleteFranchise(id);
    pruneFranchiseSaves(id, () => false);
    setConfirmDelete(null);
    toast("Franchise deleted");
    refresh();
  };

  return (
    <PageShell
      title="Franchise"
      actions={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            Import
          </Button>
          <Button onClick={() => router.push("/franchise/new/")}>New franchise</Button>
        </div>
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept=".blfranchise,application/json"
        className="hidden"
        aria-label="Import a franchise file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImport(f);
          e.target.value = "";
        }}
      />
      {failed && (
        <p className="mb-4 text-sm text-amber" role="alert">
          This browser is blocking saved data, so franchises can&apos;t be stored here.
        </p>
      )}
      {saves === null ? (
        <p className="text-steel" role="status">
          Loading your franchises…
        </p>
      ) : saves.length === 0 ? (
        <Panel>
          <div className="flex flex-col items-start gap-4 py-6">
            <p className="font-display text-3xl font-black">Your team, your rules</p>
            <p className="max-w-xl text-steel">Pick a team and coach it for as many seasons as you like. Play any game yourself or sim it.</p>
            <Button onClick={() => router.push("/franchise/new/")}>Pick a team</Button>
          </div>
        </Panel>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {saves.map((s) => (
            <li key={s.id}>
              <Panel className="flex h-full flex-col gap-3">
                <div className="flex items-center gap-4">
                  <span className="h-14 w-3 flex-none rounded-[var(--radius-chip)] ring-1 ring-line" style={{ background: s.primary }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-2xl font-black">{s.teamName}</p>
                    <p className="truncate text-sm text-steel">
                      {s.year}-{String(s.year + 1).slice(2)} · {s.wins}-{s.losses}
                    </p>
                  </div>
                </div>
                <p className="text-sm text-steel">
                  {formatDate(s.date)} · saved {new Date(s.updatedAt).toLocaleDateString()}
                </p>
                <div className="mt-auto flex flex-wrap items-center gap-2">
                  <Link
                    href={`/franchise/hub/?id=${encodeURIComponent(s.id)}`}
                    className="rounded-[var(--radius-chip)] bg-amber px-4 py-2 font-display text-lg font-bold text-navy"
                  >
                    Continue
                  </Link>
                  <Button variant="ghost" onClick={() => onExport(s)}>
                    Export
                  </Button>
                  {confirmDelete === s.id ? (
                    <span className="flex items-center gap-2 text-sm">
                      Delete for good?
                      <Button variant="secondary" className="!px-3 !py-1 !text-base" onClick={() => onDelete(s.id)}>
                        Delete
                      </Button>
                      <Button variant="ghost" className="!px-2 !py-1 !text-base" onClick={() => setConfirmDelete(null)}>
                        Keep
                      </Button>
                    </span>
                  ) : (
                    <Button variant="ghost" onClick={() => setConfirmDelete(s.id)}>
                      Delete
                    </Button>
                  )}
                </div>
              </Panel>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 text-sm text-steel">
        Franchises are saved in this browser after everything you do. Export a franchise to back it up or move it to another device.
      </p>
    </PageShell>
  );
}

async function teamFromText(text: string) {
  try {
    const f = JSON.parse(text)?.franchise as Franchise | undefined;
    return f ? await franchiseTeam(f) : undefined;
  } catch {
    return undefined;
  }
}
