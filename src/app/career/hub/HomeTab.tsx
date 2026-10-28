"use client";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { playerOvr } from "@/engine/player";
import type { Career, TryoutResult } from "@/career/types";
import { formatDate, GRADE_LABEL, LEVEL_LABEL, LEVEL_SHORT } from "@/career/format";
import { currentSeason, nextEvent, setFocus, userGames, type HsContext } from "@/career/hs/season";
import { ELIGIBLE_GPA, gpaLabel, practiceMultiplier } from "@/career/hs/academics";
import { rankingText } from "@/career/hs/rankings";
import { campsFor } from "@/career/hs/summer";
import { standings } from "@/career/hs/sim";
import { useCareer } from "@/state/careerStore";
import { useMatchStore } from "@/state/matchStore";
import { useInputDevice } from "@/ui/MenuNavigator";
import { audio } from "@/audio/engine";
import { TeamLogo } from "@/ui/TeamLogo";
import { Button, Panel, Slider } from "@/ui/kit";
import { toast } from "@/ui/Toaster";
import {
  campAction,
  careerPending,
  clearSuspended,
  finalsAction,
  finishCurrentSeason,
  graduateAction,
  nextYearAction,
  runTryout,
  showcaseAction,
  simShowcase,
  simUserGames,
  suspendedFor,
  type SimProgress,
} from "./actions";
import { FinalsQuiz } from "./FinalsQuiz";
import { TryoutDrills } from "./TryoutDrills";

function primaryDevice(device: string): string {
  if (device === "keyboard" || typeof navigator === "undefined") return "keyboard";
  const pad = [...(navigator.getGamepads?.() ?? [])].find((p): p is Gamepad => !!p && p.connected);
  return pad ? `pad${pad.index}` : "keyboard";
}

export function HomeTab({ career, ctx }: { career: Career; ctx: HsContext }) {
  const update = useCareer((s) => s.update);
  const unread = career.inbox.filter((m) => !m.read).length;
  return (
    <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
      <div className="flex flex-col gap-5">
        <NextUp career={career} ctx={ctx} />
        <SeasonGlance career={career} ctx={ctx} />
        <SchoolPanel career={career} />
      </div>
      <div className="flex flex-col gap-5">
        <Panel title={`Messages${unread ? ` (${unread} new)` : ""}`}>
          {unread > 1 && (
            <button className="mb-2 text-sm text-steel underline" onClick={() => update((c) => ({ ...c, inbox: c.inbox.map((m) => ({ ...m, read: true })) }))}>
              Mark all as read
            </button>
          )}
          <ul className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto pr-1">
            {[...career.inbox].reverse().map((m) => (
              <li key={m.id} className={`rounded-[var(--radius-chip)] p-3 ring-1 ${m.read ? "ring-line" : "bg-amber/10 ring-amber/60"}`}>
                <p className="text-xs text-steel">
                  {formatDate(m.date)} · {m.from}
                </p>
                <p className="font-semibold">{m.subject}</p>
                <p className="text-sm text-net/90">{m.body}</p>
                {!m.read && (
                  <button
                    className="mt-1 text-sm text-steel underline"
                    onClick={() => update((c) => ({ ...c, inbox: c.inbox.map((x) => (x.id === m.id ? { ...x, read: true } : x)) }))}
                  >
                    Mark as read
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Career log">
          <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
            {[...career.log].reverse().map((e, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="w-24 flex-none text-steel">{formatDate(e.date)}</span>
                <span className={e.kind === "award" ? "text-amber" : ""}>{e.text}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function NextUp({ career, ctx }: { career: Career; ctx: HsContext }) {
  const router = useRouter();
  const device = useInputDevice((s) => s.device);
  const setPending = useMatchStore((s) => s.setPending);
  const [progress, setProgress] = useState<SimProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [drills, setDrills] = useState(false);
  const [tryout, setTryout] = useState<TryoutResult | null>(null);
  const cancel = useRef(false);
  const ev = nextEvent(career);
  const s = currentSeason(career);

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
      await simUserGames(ctx, n, setProgress, () => cancel.current);
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

  if (tryout)
    return (
      <Panel title={`Tryout results: ${LEVEL_LABEL[tryout.level]}`}>
        <p className="mb-1 text-steel">Score {tryout.score}/99</p>
        <p className="mb-4">{tryout.note}</p>
        <Button onClick={() => setTryout(null)}>On to the season</Button>
      </Panel>
    );

  if (ev.kind === "tryout") {
    if (drills)
      return (
        <TryoutDrills
          ratings={career.player.ratings}
          onDone={(bonus) =>
            run(async () => {
              setDrills(false);
              setTryout(await runTryout(ctx, bonus));
            })
          }
          onSkip={() =>
            run(async () => {
              setDrills(false);
              setTryout(await runTryout(ctx, 0));
            })
          }
        />
      );
    return (
      <Panel title="Next up: tryouts">
        <p className="mb-1 text-steel">{formatDate(ev.date)}</p>
        <p className="mb-4">Every level is open. The coaches will place you on {levelsText(ctx, career)} based on your ratings and how you do in the drills.</p>
        <Button disabled={busy} onClick={() => setDrills(true)}>
          Go to tryouts
        </Button>
      </Panel>
    );
  }

  if (ev.kind === "game" && s) {
    const g = ev.game;
    const home = g.homeId === s.schoolId;
    const us = ctx.byId.get(s.schoolId)!;
    const opp = ctx.byId.get(home ? g.awayId : g.homeId)!;
    const table = standings(
      s.games.filter((x) => x.level === g.level),
      [us.id, opp.id],
    );
    // only your school's lower-level games are tracked, so opponents' records show at varsity only
    const rec = (id: string) => (id === us.id || g.level === "varsity" ? `${table.get(id)!.w}-${table.get(id)!.l}` : "");
    const saved = suspendedFor(career.id, g.id);
    const left = userGames(s).filter((x) => !x.result).length;
    const play = (resume: boolean) => {
      audio.unlock();
      const p = careerPending(career, g, ctx, primaryDevice(device));
      setPending(resume && saved ? { ...saved.pending, resume: true } : p);
      if (!resume) clearSuspended();
      router.push("/game/");
    };
    return (
      <Panel>
        <p className="text-sm text-steel">
          Next up · {formatDate(g.date)} · {LEVEL_SHORT[g.level as keyof typeof LEVEL_SHORT]}
          {g.label ? ` · ${g.label}` : g.kind === "region" ? " · Region game" : ""}
        </p>
        <div className="my-4 flex items-center justify-around gap-4">
          <TeamBlock team={home ? opp : us} record={rec(home ? opp.id : us.id)} />
          <span className="font-display text-2xl font-black text-steel">{g.neutral ? "vs" : "at"}</span>
          <TeamBlock team={home ? us : opp} record={rec(home ? us.id : opp.id)} />
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
            <Button variant="secondary" disabled={busy} onClick={() => sim(Math.min(left, 3))}>
              Sim {Math.min(left, 3)}
            </Button>
          )}
          {left > 3 && (
            <Button variant="ghost" disabled={busy} onClick={() => sim(Infinity)}>
              Sim to the playoffs
            </Button>
          )}
        </div>
      </Panel>
    );
  }

  if (ev.kind === "seasonEnd" && s) {
    const champion = s.playoffs?.find((b) => b.seeds.includes(s.schoolId));
    return (
      <Panel title={s.playoffs ? "The playoffs go on" : "Your season is over"}>
        <p className="mb-4 text-steel">
          {s.level !== "varsity"
            ? `The ${LEVEL_SHORT[s.level]} season is done. Varsity still has games and the state playoffs to finish.`
            : champion
              ? "Your team's run is over. The rest of the bracket is still playing."
              : "Your team didn't make the state playoffs this year."}
        </p>
        <Button disabled={busy} onClick={() => run(() => finishCurrentSeason(ctx))}>
          Sim to the end of the season
        </Button>
      </Panel>
    );
  }

  if (ev.kind === "finals" && s)
    return (
      <FinalsQuiz
        seed={`${career.seed}:${s.year}:${ev.semester}`}
        grade={s.grade}
        semester={ev.semester}
        onDone={(score) => run(() => finalsAction(ev.semester, score, ctx))}
      />
    );

  if (ev.kind === "camp") {
    const camps = campsFor(career);
    return (
      <Panel title="Summer camp">
        <p className="mb-3 text-steel">
          Pick one camp for June. Each sharpens a set of skills; the Elite 100 is invite-only and puts you in front of college coaches.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {camps.map((camp) => (
            <li key={camp.id}>
              <button
                disabled={!camp.invited || busy}
                onClick={() => run(() => campAction(camp.id, ctx))}
                className="h-full w-full rounded-[var(--radius-chip)] bg-deck-2 p-3 text-left ring-1 ring-line hover:ring-amber disabled:opacity-40"
              >
                <span className="block font-display text-xl font-black">{camp.name}</span>
                <span className="block text-sm text-steel">{camp.blurb}</span>
                <span className="mt-1 block text-xs text-amber">
                  {Object.entries(camp.boosts)
                    .map(([k, v]) => `+${v} ${k.replace(/([A-Z])/g, " $1").toLowerCase()}`)
                    .join(", ")}
                </span>
                {!camp.invited && <span className="mt-1 block text-xs text-steel">Invite only: top-300 prospects</span>}
              </button>
            </li>
          ))}
        </ul>
      </Panel>
    );
  }

  if (ev.kind === "showcase" && s) {
    if (!ev.game)
      return (
        <Panel title="AAU season">
          <p className="mb-4 text-steel">July means travel ball. A club wants you for three showcase games in front of college coaches.</p>
          <Button disabled={busy} onClick={() => run(showcaseAction)}>
            Join a club
          </Button>
        </Panel>
      );
    const g = ev.game;
    const left = (s.summer?.showcase ?? []).filter((x) => !x.result).length;
    const saved = suspendedFor(career.id, g.id);
    const play = (resume: boolean) => {
      audio.unlock();
      setPending(resume && saved ? { ...saved.pending, resume: true } : careerPending(career, g, ctx, primaryDevice(device)));
      if (!resume) clearSuspended();
      router.push("/game/");
    };
    return (
      <Panel>
        <p className="text-sm text-steel">
          {formatDate(g.date)} · {g.label} · {s.summer?.club?.name}
          {s.summer?.club?.elite ? " (elite circuit)" : ""}
        </p>
        <p className="my-3">Big games here raise your exposure with college coaches and your recruiting ranking.</p>
        <div className="flex flex-wrap gap-2">
          {saved ? (
            <Button disabled={busy} onClick={() => play(true)}>
              Resume game
            </Button>
          ) : (
            <Button disabled={busy} onClick={() => play(false)}>
              Play
            </Button>
          )}
          <Button variant="secondary" disabled={busy} onClick={() => run(() => simShowcase(ctx, setProgress))}>
            Sim {left > 1 ? `all ${left}` : "game"}
          </Button>
        </div>
      </Panel>
    );
  }

  if (ev.kind === "nextYear" && s)
    return (
      <Panel title="Summer's over">
        <p className="mb-4 text-steel">{s.summer?.camp ? `${s.summer.camp.name} done. ` : ""}Classes start August 1, and tryouts are in November.</p>
        <Button disabled={busy} onClick={() => run(() => nextYearAction(ctx))}>
          Start {GRADE_LABEL[s.grade + 1]?.toLowerCase()} year
        </Button>
      </Panel>
    );

  if (ev.kind === "graduated") {
    const done = career.log.some((e) => e.text.startsWith("Graduated from"));
    return (
      <Panel title={done ? "High school graduate" : "Graduation day"}>
        <p className="mb-2">
          Four years at {ctx.byId.get(career.hs.schoolId)?.name}. Overall {playerOvr(career.player)}. {rankingText(s?.ranking)}.
        </p>
        {done ? (
          <p className="text-steel">Recruiting, college and the pros arrive in an upcoming beta update. Your career is saved and will pick up right here.</p>
        ) : (
          <Button disabled={busy} onClick={() => run(() => graduateAction(ctx))}>
            Walk at graduation
          </Button>
        )}
      </Panel>
    );
  }

  return (
    <Panel title="Getting the season ready">
      <p className="text-steel" role="status">
        Setting up schedules…
      </p>
    </Panel>
  );
}

function levelsText(ctx: HsContext, career: Career) {
  const t = ctx.byId.get(career.hs.schoolId);
  const l = t?.levels ?? ["varsity", "jv"];
  const names = (["frso", "jv", "varsity"] as const).filter((x) => l.includes(x)).map((x) => LEVEL_SHORT[x]);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : names[0];
}

function TeamBlock({ team, record }: { team: { name: string; nickname: string } & Parameters<typeof TeamLogo>[0]["team"]; record: string }) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <TeamLogo team={team} size={64} />
      <p className="font-display text-xl font-black leading-tight">{team.name}</p>
      <p className="text-sm text-steel">
        {team.nickname}
        {record && ` · ${record}`}
      </p>
    </div>
  );
}

function SeasonGlance({ career, ctx }: { career: Career; ctx: HsContext }) {
  const s = currentSeason(career);
  const recent = useMemo(() => (s ? userGames(s).filter((g) => g.result) : []).slice(-5).reverse(), [s]);
  if (!s || !recent.length) return null;
  return (
    <Panel title="Recent games">
      <ul className="flex flex-col gap-2">
        {recent.map((g) => {
          const home = g.homeId === s.schoolId;
          const opp = ctx.byId.get(home ? g.awayId : g.homeId);
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

function SchoolPanel({ career }: { career: Career }) {
  const update = useCareer((x) => x.update);
  const s = currentSeason(career);
  if (!s) return null;
  const focus = s.focus ?? 0.5;
  const gpas = [s.grades.fall, s.grades.spring].filter((g): g is number => g !== undefined);
  return (
    <Panel title="School and recruiting">
      <p className="mb-1 font-semibold text-amber">{rankingText(s.ranking)}</p>
      <p className="mb-3 text-sm text-steel">
        Class of {s.year + (12 - s.grade) + 1}
        {s.ranking
          ? ` · scouting score ${s.ranking.score.toFixed(1)}, exposure ${s.ranking.exposure.toFixed(1)}`
          : " · rankings update after your first season"}
      </p>
      {gpas.length > 0 && (
        <p className="mb-2 text-sm">
          GPA {gpas.map((g) => g.toFixed(2)).join(" / ")} · {gpaLabel(gpas[gpas.length - 1])}
        </p>
      )}
      {s.ineligibleFrom && (
        <p className="mb-2 text-sm text-bad">
          Academically ineligible since {formatDate(s.ineligibleFrom)} (fall GPA under {ELIGIBLE_GPA.toFixed(1)}). Your games are simulated without you.
        </p>
      )}
      <Slider
        label="Time: basketball ↔ school"
        value={focus}
        min={0}
        max={1}
        step={0.05}
        format={(v) => (v < 0.35 ? "Hoops" : v > 0.65 ? "School" : "Balanced")}
        onChange={(v) => update((c) => setFocus(c, v))}
      />
      <p className="text-xs text-steel">Practice XP ×{practiceMultiplier(focus).toFixed(2)}. More time on school raises your grades at finals.</p>
    </Panel>
  );
}
