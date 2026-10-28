"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CareerSummary } from "@/career/types";
import { deleteCareer, exportCareer, importCareer, listCareers, loadCareer } from "@/career/storage";
import { careerTeam } from "@/state/careerStore";
import { Button, PageShell, Panel } from "@/ui/kit";
import { toast } from "@/ui/Toaster";
import { downloadText, fileSlug } from "@/ui/download";
import { formatDate, stageLabel } from "@/career/format";

export function CareerSelect() {
  const router = useRouter();
  const [careers, setCareers] = useState<CareerSummary[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    listCareers()
      .then(setCareers)
      .catch(() => setCareers([]));
  }, []);
  useEffect(refresh, [refresh]);

  const onExport = async (id: string) => {
    const c = await loadCareer(id);
    if (!c) return;
    downloadText(`${fileSlug(`${c.player.firstName} ${c.player.lastName}`)}.blcareer`, exportCareer(c));
    toast("Career exported");
  };

  const onImport = async (file: File) => {
    try {
      const text = await file.text();
      const team = await careerTeamFromText(text);
      const c = await importCareer(text, () => team);
      toast(`Imported ${c.player.firstName} ${c.player.lastName}`, "good");
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't import that file", "bad");
    }
  };

  const onDelete = async (id: string) => {
    await deleteCareer(id);
    setConfirmDelete(null);
    toast("Career deleted");
    refresh();
  };

  return (
    <PageShell
      title="Career"
      actions={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            Import
          </Button>
          <Button onClick={() => router.push("/career/new/")}>New career</Button>
        </div>
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept=".blcareer,application/json"
        className="hidden"
        aria-label="Import a career file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImport(f);
          e.target.value = "";
        }}
      />
      {careers === null ? (
        <p className="text-steel" role="status">
          Loading your careers…
        </p>
      ) : careers.length === 0 ? (
        <Panel>
          <div className="flex flex-col items-start gap-4 py-6">
            <p className="font-display text-3xl font-black">Your story starts in high school</p>
            <p className="max-w-xl text-steel">
              Build a player, pick an Arizona hometown and school, and earn your way from tryouts to varsity, through recruiting and college, to draft night and
              the pros.
            </p>
            <Button onClick={() => router.push("/career/new/")}>Create a player</Button>
          </div>
        </Panel>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {careers.map((c) => (
            <li key={c.id}>
              <Panel className="flex h-full flex-col gap-3">
                <div className="flex items-center gap-4">
                  <span
                    className="grid h-14 w-14 flex-none place-items-center rounded-[var(--radius-chip)] font-display text-2xl font-black text-white ring-1 ring-line"
                    style={{ background: c.primary }}
                    aria-hidden
                  >
                    {c.jersey}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-2xl font-black">{c.name}</p>
                    <p className="truncate text-sm text-steel">
                      {c.pos} · {c.archetype} · {c.teamName}
                    </p>
                  </div>
                  <span className="text-right">
                    <span className="block font-display text-3xl font-black text-amber">{c.ovr}</span>
                    <span className="text-xs text-steel">OVR</span>
                  </span>
                </div>
                <p className="text-sm text-steel">
                  {stageLabel(c.stage)} · {formatDate(c.date)} · saved {new Date(c.updatedAt).toLocaleDateString()}
                </p>
                <div className="mt-auto flex flex-wrap items-center gap-2">
                  <Link
                    href={`/career/hub/?id=${encodeURIComponent(c.id)}`}
                    className="rounded-[var(--radius-chip)] bg-amber px-4 py-2 font-display text-lg font-bold text-navy"
                  >
                    Continue
                  </Link>
                  <Button variant="ghost" onClick={() => onExport(c.id)}>
                    Export
                  </Button>
                  {confirmDelete === c.id ? (
                    <span className="flex items-center gap-2 text-sm">
                      Delete for good?
                      <Button variant="secondary" className="!px-3 !py-1 !text-base" onClick={() => onDelete(c.id)}>
                        Delete
                      </Button>
                      <Button variant="ghost" className="!px-2 !py-1 !text-base" onClick={() => setConfirmDelete(null)}>
                        Keep
                      </Button>
                    </span>
                  ) : (
                    <Button variant="ghost" onClick={() => setConfirmDelete(c.id)}>
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
        Careers are saved in this browser and autosave after everything you do. Export a career to back it up or move it to another device.
      </p>
    </PageShell>
  );
}

async function careerTeamFromText(text: string) {
  try {
    const c = JSON.parse(text)?.career;
    return c ? await careerTeam(c) : undefined;
  } catch {
    return undefined;
  }
}
