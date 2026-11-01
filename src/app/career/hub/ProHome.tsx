"use client";
import { useEffect, useState } from "react";
import type { Career, DraftPick } from "@/career/types";
import { AGENTS, INTERVIEWS, WORKOUTS_ALLOWED, currentStock, draftStep, ordinal, workoutTeams } from "@/career/pro/draft";
import { formatDate } from "@/career/format";
import { draftCalendar } from "@/career/calendar";
import type { HsContext } from "@/career/hs/season";
import { TeamLogo } from "@/ui/TeamLogo";
import { Button, Panel } from "@/ui/kit";
import { toast } from "@/ui/Toaster";
import { agentAction, combineAction, devLeagueAction, draftAction, finishDraftAction, interviewAction, twoWayAction, workoutAction } from "./actions";
import { TryoutDrills } from "./TryoutDrills";
import { ProSeasonUp } from "./ProSeason";

export function ProNextUp({ career, ctx }: { career: Career; ctx: HsContext }) {
  const [busy, setBusy] = useState(false);
  const [drills, setDrills] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const pro = career.pro;
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
  if (!pro || !ctx.pros) return <Panel title="Next up">Getting things ready…</Panel>;
  const step = draftStep(career);
  const pre = pro.preDraft;
  const stock = currentStock(career);
  const projection = (
    <p className="mb-3 font-semibold text-amber">
      Draft projection: {stock.label}
      {stock.pick <= 60 ? ` (around pick ${stock.pick})` : ""}
    </p>
  );

  if (step === "agent")
    return (
      <Panel title="Choose your agent">
        {projection}
        <p className="mb-3 text-steel">Your agent negotiates every deal you sign from here on and takes a share of what you earn.</p>
        <ul className="flex flex-col gap-2">
          {AGENTS.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-[var(--radius-chip)] bg-deck-2 p-3 ring-1 ring-line">
              <span className="min-w-48 flex-1">
                <span className="block font-semibold">{a.name}</span>
                <span className="block text-sm text-steel">
                  {a.pitch} {Math.round(a.fee * 100)}% fee.
                </span>
              </span>
              <Button variant="secondary" disabled={busy} onClick={() => run(() => agentAction(a.id))}>
                Sign with {a.name.split(" ")[0]}
              </Button>
            </li>
          ))}
        </ul>
      </Panel>
    );

  if (step === "combine") {
    if (drills)
      return (
        <TryoutDrills
          ratings={career.player.ratings}
          title="The combine"
          intro="Every team in the league is watching. Your ratings set how forgiving each drill is, and your results move your draft stock."
          labels={["Shooting", "Agility", "Vertical"]}
          skip="Sit out the drills (teams go by your film)"
          onDone={(bonus, scores) =>
            run(async () => {
              setDrills(false);
              await combineAction(scores, bonus);
            })
          }
          onSkip={() =>
            run(async () => {
              setDrills(false);
              await combineAction([0.5, 0.5, 0.5], 0);
            })
          }
        />
      );
    return (
      <Panel title="Next up: the combine">
        <p className="mb-1 text-sm text-steel">{formatDate(draftCalendar(pre.year).combine)}</p>
        {projection}
        <p className="mb-4 text-steel">Shooting, agility and vertical in front of every front office in the league.</p>
        <Button disabled={busy} onClick={() => setDrills(true)}>
          Go to the combine
        </Button>
      </Panel>
    );
  }

  if (step === "workouts") {
    const options = workoutTeams(career, ctx.pros).slice(0, 6);
    return (
      <Panel title={`Team workouts (${pre.workouts.length} of ${WORKOUTS_ALLOWED})`}>
        {pre.combine && (
          <p className="mb-2 text-sm text-steel">
            Combine: {pre.combine.verticalIn}&quot; vertical · {pre.combine.laneSec}s lane agility · {pre.combine.threesMade}/25 threes
          </p>
        )}
        {projection}
        {pre.workouts.length > 0 && (
          <ul className="mb-3 flex flex-col gap-1 text-sm">
            {pre.workouts.map((w) => (
              <li key={w.teamId}>
                <span className="font-semibold">{ctx.proById!.get(w.teamId)?.name}:</span> {w.note}
              </li>
            ))}
          </ul>
        )}
        <p className="mb-3 text-steel">Teams picking near your spot want a closer look. A good workout can move you up their board.</p>
        <ul aria-label="Teams asking for a workout" className="flex flex-wrap gap-2">
          {options.map((t) => (
            <li key={t.id}>
              <Button variant="secondary" disabled={busy} onClick={() => run(() => workoutAction(t.id, ctx))}>
                {t.name}
              </Button>
            </li>
          ))}
        </ul>
      </Panel>
    );
  }

  if (step === "interview") {
    const q = INTERVIEWS[pre.interviews.length];
    return (
      <Panel title={`GM interviews (${pre.interviews.length + 1} of ${INTERVIEWS.length})`}>
        {reply && <p className="mb-3 text-sm text-amber">{reply}</p>}
        <p className="mb-3 font-semibold">&ldquo;{q.q}&rdquo;</p>
        <ul className="flex flex-col gap-2">
          {q.a.map((a, i) => (
            <li key={a.text}>
              <Button
                variant="secondary"
                className="w-full text-left"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    setReply(a.reply);
                    await interviewAction(i);
                  })
                }
              >
                {a.text}
              </Button>
            </li>
          ))}
        </ul>
      </Panel>
    );
  }

  if (step === "draft") {
    if (pro.draft) return <DraftTicker career={career} ctx={ctx} />;
    return (
      <Panel title="Draft night">
        <p className="mb-1 text-sm text-steel">{formatDate(draftCalendar(pre.year).draft)}</p>
        {projection}
        <p className="mb-4 text-steel">Family, friends and a phone that could ring at any moment. Two rounds, 60 picks.</p>
        <Button disabled={busy} onClick={() => run(() => draftAction(ctx))}>
          Head to the draft
        </Button>
      </Panel>
    );
  }

  if (step === "undrafted") {
    const offers = pro.undraftedOffers ?? [];
    return (
      <Panel title="Nobody called your name">
        <p className="mb-3 text-steel">Plenty of careers started here. Pick your path.</p>
        {offers.map((id) => {
          const t = ctx.proById!.get(id)!;
          return (
            <div key={id} className="mb-2 flex flex-wrap items-center gap-3 rounded-[var(--radius-chip)] bg-deck-2 p-3 ring-1 ring-line">
              <TeamLogo team={t} size={36} />
              <span className="flex-1 font-semibold">Two-way deal with {t.name}</span>
              <Button disabled={busy} onClick={() => run(() => twoWayAction(id, ctx))}>
                Sign
              </Button>
            </div>
          );
        })}
        <p className="mb-2 mt-4 font-semibold">Or join a development team:</p>
        <ul className="flex flex-wrap gap-2">
          {ctx.pros.slice(0, 30).map((t) => (
            <li key={t.id}>
              <Button variant="ghost" disabled={busy} onClick={() => run(() => devLeagueAction(t.id, ctx))}>
                {t.name}
              </Button>
            </li>
          ))}
        </ul>
      </Panel>
    );
  }

  return <ProSeasonUp career={career} ctx={ctx} />;
}

/** The draft, one pick at a time: the clock runs on its own, or skip ahead to your pick. */
function DraftTicker({ career, ctx }: { career: Career; ctx: HsContext }) {
  const d = career.pro!.draft!;
  const [shown, setShown] = useState(0);
  const mineAt = d.picks.findIndex((p) => p.isUser);
  const stopAt = mineAt >= 0 ? mineAt + 1 : d.picks.length;
  const reachedYou = shown >= stopAt;
  const done = shown >= d.picks.length;
  useEffect(() => {
    if (reachedYou) return;
    const h = setInterval(() => setShown((n) => Math.min(n + 1, stopAt)), 650);
    return () => clearInterval(h);
  }, [reachedYou, stopAt]);
  const name = (id: string) => ctx.proById!.get(id)?.name ?? "";
  const latest = d.picks.slice(0, shown).reverse();
  const you = mineAt >= 0 && reachedYou ? d.picks[mineAt] : null;
  const onClock: DraftPick | undefined = d.picks[shown];
  // draft-night trades show up as the picks they affect go by
  const tradeCount = Math.min(d.trades.length, Math.floor((shown / d.picks.length) * (d.trades.length + 1)));
  return (
    <Panel title="Draft night">
      {you ? (
        <div className="mb-4 rounded-[var(--radius-chip)] bg-amber/10 p-4 ring-1 ring-amber">
          <p className="font-display text-3xl font-black text-amber">
            {ordinal(you.pick)} overall: {name(you.teamId)}
          </p>
          <p className="text-steel">
            With the {ordinal(you.pick)} pick, {name(you.teamId)} select {you.name}.
            {d.tradedTo ? ` Minutes later, your rights are traded to ${name(d.tradedTo)}!` : ""}
          </p>
        </div>
      ) : (
        onClock && (
          <p className="mb-3 font-semibold">
            On the clock: {name(onClock.teamId)} (pick {onClock.pick}){onClock.via ? ` via ${name(onClock.via)}` : ""}
          </p>
        )
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        {!done && !reachedYou && (
          <Button variant="secondary" onClick={() => setShown(stopAt)}>
            {mineAt >= 0 ? "Skip to my pick" : "Skip to the end"}
          </Button>
        )}
        {!done && reachedYou && (
          <Button variant="secondary" onClick={() => setShown(d.picks.length)}>
            See the rest of the draft
          </Button>
        )}
        {(reachedYou || done) && <Button onClick={() => finishDraftAction(ctx)}>{mineAt >= 0 ? "Continue" : "Leave the draft"}</Button>}
      </div>
      {tradeCount > 0 && (
        <ul className="mb-3 flex flex-col gap-1 text-sm text-amber">
          {d.trades.slice(0, tradeCount).map((t) => (
            <li key={t}>Trade: {t}</li>
          ))}
        </ul>
      )}
      <ol className="flex max-h-80 flex-col gap-1 overflow-y-auto pr-1 text-sm" aria-label="Picks so far">
        {latest.map((p) => (
          <li key={p.pick} className={`flex flex-wrap justify-between gap-x-3 border-t border-line/60 py-1 ${p.isUser ? "font-semibold text-amber" : ""}`}>
            <span>
              {p.pick}. {name(p.teamId)}
              {p.via ? ` (via ${name(p.via)})` : ""}
            </span>
            <span className={p.isUser ? "" : "text-steel"}>
              {p.name}, {p.pos}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
