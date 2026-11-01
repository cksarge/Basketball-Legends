"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { playerOvr } from "@/engine/player";
import type { Career } from "@/career/types";
import { formatDate } from "@/career/format";
import type { HsContext } from "@/career/hs/season";
import { ROLE_MINUTES, ROLE_NAME, TRAINING, canRequestTrade, currentPro, inDevLeague, money, nextProEvent, userProGames } from "@/career/pro/season";
import { useMatchStore } from "@/state/matchStore";
import { pruneCareerSaves } from "@/state/suspended";
import { useInputDevice } from "@/ui/MenuNavigator";
import { audio } from "@/audio/engine";
import { TeamLogo } from "@/ui/TeamLogo";
import { Button, Panel } from "@/ui/kit";
import { toast } from "@/ui/Toaster";
import {
  campAndStartAction,
  careerPending,
  clearSuspended,
  finishProYear,
  negotiateAction,
  primaryDevice,
  signBrandAction,
  signContractAction,
  simProGames,
  sitOutAction,
  suspendedFor,
  tradeRequestAction,
  type SimProgress,
} from "./actions";

/** What's next once you're a pro: training camp, your next game, an injury, the end of the year or free agency. */
export function ProSeasonUp({ career, ctx }: { career: Career; ctx: HsContext }) {
  const router = useRouter();
  const device = useInputDevice((s) => s.device);
  const setPending = useMatchStore((s) => s.setPending);
  const [progress, setProgress] = useState<SimProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const cancel = useRef(false);
  const ev = nextProEvent(career);
  const s = currentPro(career);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Something went wrong", "bad");
    } finally {
      setBusy(false);
    }
  };
  const sim = (n: number) =>
    run(async () => {
      cancel.current = false;
      await simProGames(ctx, n, setProgress, () => cancel.current);
    });

  if (progress)
    return (
      <Panel title="Simulating">
        <p className="mb-2 text-steel" role="status">
          Game {progress.index} of {progress.total}: {progress.label}
        </p>
        <div className="h-2 overflow-hidden rounded-full bg-navy">
          <div className="h-full bg-amber transition-[width]" style={{ width: `${((progress.index - 1 + progress.fraction) / progress.total) * 100}%` }} />
        </div>
        <Button variant="ghost" className="mt-3" onClick={() => (cancel.current = true)}>
          Stop after this game
        </Button>
      </Panel>
    );

  if (ev.kind === "training") {
    const offers = career.pro?.endorsementOffers ?? [];
    return (
      <>
        <Panel title="Training camp">
          <p className="mb-1 text-sm text-steel">{formatDate(ev.date)}</p>
          {s?.finish && <p className="mb-1">Last season: {s.finish}.</p>}
          <p className="mb-3 text-steel">Pick what you work on this summer. It starts the new season.</p>
          <ul aria-label="Summer focus" className="flex flex-wrap gap-2">
            {TRAINING.map((t) => (
              <li key={t.id}>
                <Button variant="secondary" disabled={busy} onClick={() => run(() => campAndStartAction(t.id, ctx))}>
                  {t.label}
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
        {offers.length > 0 && (
          <Panel title="Endorsement offers">
            <ul className="flex flex-col gap-2">
              {offers.map((e) => (
                <li key={e.brand} className="flex flex-wrap items-center gap-3 rounded-[var(--radius-chip)] bg-deck-2 p-3 ring-1 ring-line">
                  <span className="min-w-40 flex-1">
                    <span className="block font-semibold">{e.brand}</span>
                    <span className="block text-sm text-steel">
                      {money(e.perYear)} a year for {e.years} years
                    </span>
                  </span>
                  <Button variant="secondary" disabled={busy} onClick={() => run(() => signBrandAction(e.brand))}>
                    Sign
                  </Button>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </>
    );
  }

  if (ev.kind === "freeAgency") {
    const offers = career.pro?.offers ?? [];
    return (
      <Panel title="Free agency">
        <p className="mb-3 text-steel">Your contract is up. Ask for more and they might say yes, or they might walk away.</p>
        <ul aria-label="Contract offers" className="flex flex-col gap-2">
          {offers.map((o) => {
            const t = ctx.proById!.get(o.teamId)!;
            return (
              <li key={o.teamId} className="flex flex-wrap items-center gap-3 rounded-[var(--radius-chip)] bg-deck-2 p-3 ring-1 ring-line">
                <TeamLogo team={t} size={36} />
                <span className="min-w-48 flex-1">
                  <span className="block font-semibold">
                    {t.name}
                    {o.teamId === s?.teamId ? " (your team)" : ""}
                  </span>
                  <span className="block text-sm text-steel">
                    {o.pulled
                      ? "They walked away."
                      : `${o.years} year${o.years > 1 ? "s" : ""} at ${money(o.salary)} · ${ROLE_NAME[o.role]}${o.promise ? " (promised)" : ""}`}
                  </span>
                </span>
                {!o.pulled && (
                  <>
                    {!o.raised && (
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            toast((await negotiateAction(o.teamId, 0.08)) ? `${t.name} agreed to the raise` : `${t.name} walked away`);
                          })
                        }
                      >
                        Ask for 8% more
                      </Button>
                    )}
                    <Button disabled={busy} onClick={() => run(() => signContractAction(o.teamId, ctx))}>
                      Sign
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>
    );
  }

  if (!s) return <Panel title="Next up">Getting things ready…</Panel>;

  if (ev.kind === "injured")
    return (
      <Panel title={`Out: ${ev.name}`}>
        <p className="mb-4 text-steel">
          You&apos;ll miss about {ev.left} more game{ev.left === 1 ? "" : "s"}. Your team plays on without you.
        </p>
        <Button disabled={busy} onClick={() => run(() => sitOutAction(ctx))}>
          Rehab and get back
        </Button>
      </Panel>
    );

  if (ev.kind === "seasonEnd")
    return (
      <Panel title="The rest of the year">
        <p className="mb-4 text-steel">{inDevLeague(s) ? "Your development league season is over." : "Your games are done. The league plays on."}</p>
        <Button disabled={busy} onClick={() => run(() => finishProYear(ctx))}>
          Finish the season
        </Button>
      </Panel>
    );

  const g = ev.game;
  const allStar = g.kind === "allstar";
  const home = g.homeId === s.teamId;
  const us = ctx.proById!.get(s.teamId)!;
  const opp = allStar ? undefined : ctx.proById!.get(home ? g.awayId : g.homeId);
  const saved = suspendedFor(career.id, g.id);
  const left = userProGames(s).filter((x) => !x.result).length;
  const play = () =>
    run(async () => {
      audio.unlock();
      setPending(careerPending(career, g, ctx, primaryDevice(device)));
      clearSuspended();
      pruneCareerSaves(career.id, (id) => id !== g.id);
      router.push("/game/");
    });
  return (
    <Panel>
      <p className="text-sm text-steel">
        {formatDate(g.date)}
        {g.label ? ` · ${g.label}` : ""}
      </p>
      <div className="my-4 flex items-center justify-around gap-4 text-center">
        <div className="flex flex-col items-center gap-1">
          <TeamLogo team={us} size={64} />
          <p className="font-display text-xl font-black leading-tight">{allStar ? "All-Stars" : us.name}</p>
        </div>
        <span className="font-display text-2xl font-black text-steel">{allStar || home ? "vs" : "at"}</span>
        <div className="flex flex-col items-center gap-1">
          {opp && <TeamLogo team={opp} size={64} />}
          <p className="font-display text-xl font-black leading-tight">{opp?.name ?? "The other conference"}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {saved ? (
          <>
            <Button
              disabled={busy}
              onClick={() => {
                audio.unlock();
                setPending(saved.pending);
                router.push("/game/");
              }}
            >
              Resume game ({saved.summary.homeScore}-{saved.summary.awayScore}, {saved.summary.period})
            </Button>
            <Button variant="secondary" disabled={busy} onClick={play}>
              Restart
            </Button>
          </>
        ) : (
          <Button disabled={busy} onClick={play}>
            Play
          </Button>
        )}
        <Button variant="secondary" disabled={busy} onClick={() => sim(1)}>
          Sim game
        </Button>
        {left > 1 && (
          <Button variant="secondary" disabled={busy} onClick={() => sim(Math.min(left, 10))}>
            Sim {Math.min(left, 10)}
          </Button>
        )}
        {left > 10 && (
          <Button variant="ghost" disabled={busy} onClick={() => sim(Infinity)}>
            Sim the rest of the season
          </Button>
        )}
      </div>
    </Panel>
  );
}

/** Your role, the coach, the locker room and your money. */
export function ProPanels({ career, ctx }: { career: Career; ctx: HsContext }) {
  const s = currentPro(career);
  const pro = career.pro;
  if (!s || !pro) return null;
  const c = career.player.contract;
  return (
    <>
      <Panel title="Your role">
        <p className="mb-1 font-semibold text-amber">
          {ROLE_NAME[s.role]} · about {ROLE_MINUTES[s.role]} minutes
        </p>
        <p className="mb-3 text-sm text-steel">
          {inDevLeague(s) ? `${ctx.proById?.get(s.teamId)?.name} development team · ` : ""}overall {playerOvr(career.player)}
          {s.promise ? ` · promised: ${ROLE_NAME[s.promise.role].toLowerCase()}${s.promise.broken ? " (broken)" : ""}` : ""}
        </p>
        {[
          ["Coach trust", s.trust],
          ["Team chemistry", s.chemistry],
        ].map(([label, v]) => (
          <div key={label as string} className="mb-2">
            <div className="mb-1 flex justify-between text-sm">
              <span>{label}</span>
              <span className="tabular-nums">{Math.round(v as number)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-navy">
              <div className="h-full bg-amber" style={{ width: `${v}%` }} />
            </div>
          </div>
        ))}
        {canRequestTrade(career) && (
          <button className="mt-1 text-sm text-steel underline" onClick={() => tradeRequestAction()}>
            Request a trade
          </button>
        )}
        {s.tradeRequested && <p className="mt-1 text-sm text-steel">You&apos;ve asked for a trade. The front office is making calls.</p>}
      </Panel>
      <Panel title="Money">
        {c && (
          <p className="mb-1">
            {money(c.salary)} a season · {c.years} year{c.years === 1 ? "" : "s"} left
            {c.twoWay ? " · two-way" : ""}
          </p>
        )}
        <p className="mb-1 text-sm text-steel">Earned so far: {money(pro.earnings)}</p>
        {pro.endorsements.length > 0 && <p className="text-sm text-steel">Endorsements: {pro.endorsements.map((e) => e.brand).join(", ")}</p>}
        {career.player.badges.length > 0 && <p className="mt-2 text-sm text-amber">Badges: {career.player.badges.join(", ")}</p>}
      </Panel>
    </>
  );
}
