"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { playerOvr } from "@/engine/player";
import type { Career } from "@/career/types";
import type { HsContext } from "@/career/hs/season";
import { PARK_LADDER, RUNS_PER_WINDOW, calloutOpen, nextUnlock, repName, rivalPlayer, runWindow, runsLeft, streetOf, unlockedParks } from "@/career/park";
import { parkById } from "@/game/park/parks";
import { parkRegulars } from "@/game/park/regulars";
import { audio } from "@/audio/engine";
import { useInputDevice } from "@/ui/MenuNavigator";
import { Button, Panel, Segmented } from "@/ui/kit";
import { toast } from "@/ui/Toaster";
import { declineCalloutAction, primaryDevice, simRunAction, startRunAction } from "./actions";

/** A nudge on Home when the park is open. */
export function ParkNudge({ career }: { career: Career }) {
  const left = runsLeft(career);
  if (!left || left === Infinity) return null;
  return (
    <p className="rounded-[var(--radius-chip)] bg-deck p-3 text-sm text-steel ring-1 ring-line">
      {calloutOpen(career) ? `${career.story!.rival.name} is calling you out at the park. ` : ""}
      Off-season: you&apos;ve got {left} pickup run{left === 1 ? "" : "s"} waiting in the Park tab.
    </p>
  );
}

/** Pickup runs, your street reputation and the regulars you know. */
export function ParkTab({ career, ctx }: { career: Career; ctx: HsContext }) {
  const router = useRouter();
  const device = useInputDevice((s) => s.device);
  const [size, setSize] = useState(3);
  const [busy, setBusy] = useState(false);
  const st = streetOf(career);
  const open = unlockedParks(st.rep);
  const left = runsLeft(career);
  const next = nextUnlock(st.rep);
  const inWindow = runWindow(career) !== null;
  const go = async (parkId: string, kind: "pickup" | "callout") => {
    setBusy(true);
    audio.unlock();
    if (await startRunAction(parkId, size, kind, ctx, primaryDevice(device))) router.push("/game/");
    else {
      toast("That run isn't available", "bad");
      setBusy(false);
    }
  };
  const sim = async (parkId: string, kind: "pickup" | "callout") => {
    setBusy(true);
    await simRunAction(parkId, size, kind, ctx);
    setBusy(false);
  };
  const known = Object.entries(st.regulars)
    .map(([id, r]) => {
      const parkId = PARK_LADDER.find((p) => id.startsWith(`park-${p.parkId}-`))?.parkId;
      const reg = parkId ? parkRegulars(parkById(parkId)).find((x) => x.player.id === id) : undefined;
      return reg ? { reg, parkName: parkById(parkId!).name, ...r } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.w + b.l - (a.w + a.l))
    .slice(0, 8);
  const callout = calloutOpen(career);
  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <div className="flex flex-col gap-5">
        {callout && (
          <Panel title="You've been called out">
            <p className="mb-1 font-semibold">{career.story!.rival.name} wants you, one-on-one, game to 11.</p>
            <p className="mb-3 text-sm text-steel">They&apos;re about a {playerOvr(rivalPlayer(career))} right now. Ducking it costs you reputation.</p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => go("copper-flats", "callout")}>
                Accept
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => sim("copper-flats", "callout")}>
                Sim it
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => declineCalloutAction()}>
                Duck it
              </Button>
            </div>
          </Panel>
        )}
        <Panel title="Pick a park">
          {inWindow ? (
            <>
              <p className="mb-3 font-semibold text-amber">
                {left === Infinity
                  ? "Retired, and the courts are open any time."
                  : left === 0
                    ? "No runs left this off-season."
                    : `${left} run${left === 1 ? "" : "s"} left this off-season`}
              </p>
              <div className="mb-3">
                <Segmented<number> label="Team size" value={size} onChange={setSize} options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: `${n}v${n}` }))} />
              </div>
            </>
          ) : (
            <p className="mb-3 text-steel">You&apos;re in season. You get {RUNS_PER_WINDOW} pickup runs every off-season.</p>
          )}
          <ul className="flex flex-col gap-2">
            {PARK_LADDER.map(({ parkId, rep }) => {
              const p = parkById(parkId);
              const unlocked = open.includes(parkId);
              return (
                <li
                  key={parkId}
                  className={`flex flex-wrap items-center gap-3 rounded-[var(--radius-chip)] bg-deck-2 p-3 ring-1 ring-line ${unlocked ? "" : "opacity-60"}`}
                >
                  <span className="min-w-48 flex-1">
                    <span className="block font-semibold">{unlocked ? p.name : `Locked: ${p.city}`}</span>
                    <span className="block text-sm text-steel">{unlocked ? `${p.city}, ${p.state} · ${p.vibe}` : `Takes ${rep} reputation`}</span>
                  </span>
                  {unlocked && inWindow && left > 0 && (
                    <>
                      <Button disabled={busy} aria-label={`Run at ${p.name}`} onClick={() => go(parkId, "pickup")}>
                        Run
                      </Button>
                      <Button variant="secondary" disabled={busy} aria-label={`Sim a run at ${p.name}`} onClick={() => sim(parkId, "pickup")}>
                        Sim
                      </Button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
      <div className="flex flex-col gap-5">
        <Panel title="Your name at the parks">
          <p className="font-display text-3xl font-black text-amber">{repName(st.rep)}</p>
          <p className="mb-2 text-sm text-steel">
            {st.rep} street reputation · {st.wins}-{st.losses} in pickup
          </p>
          {next && (
            <p className="text-sm text-steel">
              {next.rep - st.rep} more to get a run in {parkById(next.parkId).city}.
            </p>
          )}
          <p className="mt-2 text-xs text-steel">Simmed runs earn half the reputation. Moments only count in games you play yourself.</p>
        </Panel>
        <Panel title="Regulars you know">
          {known.length === 0 ? (
            <p className="text-steel">Nobody knows you yet. Go get a run.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {known.map(({ reg, parkName, w, l }) => (
                <li key={reg.player.id} className="flex justify-between gap-3 border-t border-line/60 py-1">
                  <span>
                    {reg.player.firstName} &ldquo;{reg.nickname}&rdquo; {reg.player.lastName}
                    <span className="block text-xs text-steel">{parkName}</span>
                  </span>
                  <span className="tabular-nums">
                    {w}-{l}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
