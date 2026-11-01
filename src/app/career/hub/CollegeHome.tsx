"use client";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { playerOvr } from "@/engine/player";
import type { Career } from "@/career/types";
import { classLabel, formatDate } from "@/career/format";
import {
  canRedshirt,
  canReturn,
  conferenceName,
  currentCollege,
  liveTeamRank,
  nextCollegeEvent,
  ROLE_MINUTES,
  userCollegeGames,
  yearsUsed,
  ELIGIBILITY_YEARS,
} from "@/career/college/season";
import { standings } from "@/career/hs/sim";
import type { HsContext } from "@/career/hs/season";
import { useMatchStore } from "@/state/matchStore";
import { pruneCareerSaves } from "@/state/suspended";
import { useInputDevice } from "@/ui/MenuNavigator";
import { audio } from "@/audio/engine";
import { TeamLogo } from "@/ui/TeamLogo";
import { Button, Panel } from "@/ui/kit";
import { toast } from "@/ui/Toaster";
import {
  careerPending,
  clearSuspended,
  declareAction,
  declineNilAction,
  finishCollegeYear,
  nextCollegeYearAction,
  portalAction,
  primaryDevice,
  redshirtAction,
  returnAction,
  signNilAction,
  simCollegeGames,
  suspendedFor,
  transferAction,
  undeclareAction,
  withdrawAction,
  type SimProgress,
} from "./actions";

const money = (n: number) => `$${n.toLocaleString("en-US")}`;
const ROLE_TEXT = { starter: "Starter", rotation: "Rotation player", bench: "End of the bench" };

export function CollegeNextUp({ career, ctx }: { career: Career; ctx: HsContext }) {
  const router = useRouter();
  const device = useInputDevice((s) => s.device);
  const setPending = useMatchStore((s) => s.setPending);
  const [progress, setProgress] = useState<SimProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const cancel = useRef(false);
  const s = currentCollege(career)!;
  const ev = nextCollegeEvent(career);
  const team = ctx.collegeById?.get(s.teamId);

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
      await simCollegeGames(ctx, n, setProgress, () => cancel.current);
    });

  if (!team) return <Panel title="Getting the season ready">Loading your team…</Panel>;

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

  if (ev.kind === "game") {
    const g = ev.game;
    const home = g.homeId === s.teamId;
    const opp = ctx.collegeById!.get(home ? g.awayId : g.homeId)!;
    const table = standings(
      s.games.filter((x) => x.kind !== "playoff"),
      [team.id, opp.id],
    );
    const rec = (id: string) => `${table.get(id)!.w}-${table.get(id)!.l}`;
    const saved = suspendedFor(career.id, g.id);
    const left = userCollegeGames(s).filter((x) => !x.result).length;
    const play = (resume: boolean) => {
      audio.unlock();
      setPending(resume && saved ? saved.pending : careerPending(career, g, ctx, primaryDevice(device)));
      if (!resume) {
        clearSuspended();
        pruneCareerSaves(career.id, (id) => id !== g.id);
      }
      router.push("/game/");
    };
    return (
      <Panel>
        <p className="text-sm text-steel">
          {formatDate(g.date)} · {g.label ?? (g.kind === "region" ? "Conference game" : "Non-conference")}
        </p>
        <div className="my-4 flex items-center justify-around gap-4 text-center">
          <div className="flex flex-col items-center gap-1">
            <TeamLogo team={team} size={64} />
            <p className="font-display text-xl font-black leading-tight">{team.name}</p>
            <p className="text-sm text-steel">{rec(team.id)}</p>
          </div>
          <span className="font-display text-2xl font-black text-steel">{g.neutral ? "vs" : home ? "vs" : "at"}</span>
          <div className="flex flex-col items-center gap-1">
            <TeamLogo team={opp} size={64} />
            <p className="font-display text-xl font-black leading-tight">{opp.name}</p>
            <p className="text-sm text-steel">{rec(opp.id)}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {saved ? (
            <>
              <Button disabled={busy} onClick={() => play(true)}>
                Resume game ({saved.summary.homeScore}-{saved.summary.awayScore}, {saved.summary.period})
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => play(false)}>
                Restart
              </Button>
            </>
          ) : (
            <Button disabled={busy} onClick={() => play(false)}>
              Play
            </Button>
          )}
          <Button variant="secondary" disabled={busy} onClick={() => sim(1)}>
            Sim game
          </Button>
          {left > 1 && (
            <Button variant="secondary" disabled={busy} onClick={() => sim(Math.min(left, 5))}>
              Sim {Math.min(left, 5)}
            </Button>
          )}
          {left > 5 && (
            <Button variant="ghost" disabled={busy} onClick={() => sim(Infinity)}>
              Sim to the postseason
            </Button>
          )}
        </div>
        {canRedshirt(career) && (
          <p className="mt-3 text-sm text-steel">
            Not ready for real minutes?{" "}
            <button className="text-amber underline" disabled={busy} onClick={() => run(() => redshirtAction(true))}>
              Redshirt this season
            </button>{" "}
            to keep developing without using a year of eligibility.
          </p>
        )}
      </Panel>
    );
  }

  if (ev.kind === "seasonEnd")
    return (
      <Panel title={s.redshirt ? "Your redshirt year" : "The season is winding down"}>
        <p className="mb-4 text-steel">
          {s.redshirt ? "You're practicing every day while the team plays." : "Your games are done. The rest of the country plays on."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => run(() => finishCollegeYear(ctx))}>
            Finish the season
          </Button>
          {s.redshirt && !s.stats.gp && career.date < `${s.year}-11-01` && (
            <Button variant="secondary" disabled={busy} onClick={() => run(() => redshirtAction(false))}>
              Play this season after all
            </Button>
          )}
        </div>
      </Panel>
    );

  const stock = s.stock;
  if (ev.kind === "decision") {
    const can = canReturn(career);
    return (
      <Panel title="What's next?">
        <p className="mb-1">{s.finish ?? "Your season is over."}</p>
        {stock && (
          <p className="mb-1 font-semibold text-amber">
            Draft projection: {stock.label}
            {stock.pick <= 60 ? ` (around pick ${stock.pick})` : ""}
          </p>
        )}
        <p className="mb-4 text-sm text-steel">
          {can
            ? `${ELIGIBILITY_YEARS - yearsUsed(career)} year${ELIGIBILITY_YEARS - yearsUsed(career) > 1 ? "s" : ""} of eligibility left.`
            : "You're out of eligibility."}
        </p>
        <div className="flex flex-wrap gap-2">
          {can && (
            <Button disabled={busy} onClick={() => run(() => returnAction())}>
              Come back next year
            </Button>
          )}
          {can && (
            <Button variant="secondary" disabled={busy} onClick={() => run(() => portalAction(ctx))}>
              Enter the transfer portal
            </Button>
          )}
          <Button variant={can ? "secondary" : "primary"} disabled={busy} onClick={() => run(() => declareAction())}>
            Declare for the draft
          </Button>
        </div>
      </Panel>
    );
  }

  if (ev.kind === "portal")
    return (
      <Panel title="Transfer portal">
        {(s.portalOffers ?? []).length === 0 && <p className="mb-3 text-steel">No programs have reached out yet.</p>}
        <ul className="mb-4 flex flex-col gap-2">
          {(s.portalOffers ?? []).map((o) => {
            const t = ctx.collegeById!.get(o.teamId)!;
            return (
              <li key={o.teamId} className="flex flex-wrap items-center gap-3 rounded-[var(--radius-chip)] bg-deck-2 p-3 ring-1 ring-line">
                <TeamLogo team={t} size={36} />
                <span className="min-w-40 flex-1">
                  <span className="block font-semibold">
                    {t.name} ({t.tier})
                  </span>
                  <span className="block text-sm text-steel">
                    {o.role}
                    {o.nil > 0 ? ` · NIL around ${money(o.nil)}` : ""}
                  </span>
                </span>
                <Button variant="secondary" disabled={busy} onClick={() => run(() => transferAction(o.teamId, ctx))}>
                  Transfer
                </Button>
              </li>
            );
          })}
        </ul>
        <Button variant="ghost" disabled={busy} onClick={() => run(() => withdrawAction())}>
          Withdraw and stay at {team.name}
        </Button>
        <p className="mt-2 text-sm text-steel">Your coach will remember that you looked around.</p>
      </Panel>
    );

  if (ev.kind === "nextYear") {
    const to = career.college?.transferTo ? ctx.collegeById?.get(career.college.transferTo) : undefined;
    return (
      <Panel title="Summer on campus">
        <p className="mb-4 text-steel">{to ? `You're off to ${to.name}.` : `Workouts at ${team.name} start in August.`}</p>
        <Button disabled={busy} onClick={() => run(() => nextCollegeYearAction(ctx))}>
          Start next season
        </Button>
      </Panel>
    );
  }

  const declared = career.college?.declared;
  return (
    <Panel title="You've declared for the draft">
      <p className="mb-1 font-semibold text-amber">Projection: {declared?.stock.label}</p>
      <p className="mb-4 text-steel">Draft night and the pros arrive in an upcoming beta update. Your career is saved and will pick up right here.</p>
      {canReturn(career) && (
        <Button variant="secondary" disabled={busy} onClick={() => run(() => undeclareAction())}>
          Change your mind and stay in school
        </Button>
      )}
    </Panel>
  );
}

export function CollegeRecent({ career, ctx }: { career: Career; ctx: HsContext }) {
  const s = currentCollege(career)!;
  const recent = useMemo(
    () =>
      userCollegeGames(s)
        .filter((g) => g.result)
        .slice(-5)
        .reverse(),
    [s],
  );
  if (!recent.length) return null;
  return (
    <Panel title="Recent games">
      <ul className="flex flex-col gap-2">
        {recent.map((g) => {
          const home = g.homeId === s.teamId;
          const opp = ctx.collegeById?.get(home ? g.awayId : g.homeId);
          const r = g.result!;
          const won = home ? r.home > r.away : r.away > r.home;
          const l = r.userLine;
          return (
            <li key={g.id} className="flex flex-wrap items-baseline gap-x-3 text-sm">
              <span className={`w-6 font-bold ${won ? "text-good" : "text-bad"}`}>{won ? "W" : "L"}</span>
              <span className="w-16 tabular-nums">
                {home ? r.home : r.away}-{home ? r.away : r.home}
              </span>
              <span className="flex-1">
                {home ? "vs" : "at"} {opp?.name}
              </span>
              <span className="text-steel">{l ? `${l.pts} pts, ${l.oreb + l.dreb} reb, ${l.ast} ast` : "DNP"}</span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** Coach trust, your role and NIL deals. */
export function CollegePanels({ career, ctx }: { career: Career; ctx: HsContext }) {
  const s = currentCollege(career)!;
  const team = ctx.collegeById?.get(s.teamId);
  const rank = liveTeamRank(s, ctx);
  const open = s.nil.filter((d) => d.status === "open");
  return (
    <>
      <Panel title="Your role">
        <p className="mb-1 font-semibold text-amber">{s.redshirt ? "Redshirting" : `${ROLE_TEXT[s.role]} · about ${ROLE_MINUTES[s.role]} minutes`}</p>
        <p className="mb-3 text-sm text-steel">
          {classLabel(s.classYear)}
          {s.walkOn ? " · walk-on" : ""} · {team ? conferenceName(ctx, team) : ""}
          {rank ? ` · team ranked No. ${rank} in ${s.tier}` : ""} · overall {playerOvr(career.player)}
        </p>
        <div className="mb-1 flex justify-between text-sm">
          <span>Coach trust</span>
          <span className="tabular-nums">{Math.round(s.trust)}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-navy">
          <div className="h-full bg-amber" style={{ width: `${s.trust}%` }} />
        </div>
        <p className="mt-2 text-xs text-steel">Beat what the coach expects from your role and trust grows. More trust means a bigger role and more minutes.</p>
      </Panel>
      <Panel title="NIL">
        <p className="mb-3 text-sm text-steel">Earned so far: {money(career.college?.earnings ?? 0)}</p>
        {open.length === 0 && <p className="text-sm text-steel">No open offers. New ones come in every season.</p>}
        <ul className="flex flex-col gap-2">
          {open.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-chip)] bg-deck-2 p-3 ring-1 ring-line">
              <span className="min-w-40 flex-1">
                <span className="block font-semibold">{d.brand}</span>
                <span className="block text-sm text-steel">
                  {money(d.amount)} ·{" "}
                  {d.kind === "community"
                    ? "counts toward your Impact"
                    : d.kind === "national"
                      ? "a national deal, but your coach won't love the distraction"
                      : "local deal"}
                </span>
              </span>
              <Button variant="secondary" onClick={() => signNilAction(d.id)}>
                Sign
              </Button>
              <Button variant="ghost" onClick={() => declineNilAction(d.id)}>
                Pass
              </Button>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
