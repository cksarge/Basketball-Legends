"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { formatDate } from "@/career/format";
import { teamLabel } from "@/data/leagues";
import { useFranchise } from "@/state/franchiseStore";
import { Button, PageShell, Panel } from "@/ui/kit";

export function FranchiseHub() {
  const id = useSearchParams().get("id");
  const { franchise, team, status, error, open } = useFranchise();

  useEffect(() => {
    if (id) open(id);
  }, [id, open]);

  if (status === "stale")
    return (
      <PageShell title="Franchise">
        <Panel>
          <p className="mb-4">This franchise was changed in another tab. Reload to continue.</p>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </Panel>
      </PageShell>
    );
  if (status === "missing" || !id)
    return (
      <PageShell title="Franchise">
        <Panel>
          <p className="mb-4">That franchise isn&apos;t saved in this browser.</p>
          <Link href="/franchise/" className="text-amber underline">
            Back to your franchises
          </Link>
        </Panel>
      </PageShell>
    );
  if (status === "error" && !franchise)
    return (
      <PageShell title="Franchise">
        <Panel>
          <p role="alert">{error ?? "Couldn't open this franchise."}</p>
        </Panel>
      </PageShell>
    );
  if (!franchise || !team)
    return (
      <PageShell title="Franchise">
        <p className="text-steel" role="status">
          Loading your franchise…
        </p>
      </PageShell>
    );

  return (
    <PageShell title={teamLabel(team)}>
      {error && (
        <p className="mb-4 text-sm text-amber" role="alert">
          {error}
        </p>
      )}
      <Panel title={`${franchise.season.year}-${String(franchise.season.year + 1).slice(2)} season`}>
        <p className="text-steel">{formatDate(franchise.date)}</p>
        <p className="mt-3">Games, standings and your roster arrive in the next beta. Coming soon.</p>
      </Panel>
    </PageShell>
  );
}
