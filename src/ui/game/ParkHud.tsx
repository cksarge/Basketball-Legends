"use client";
// HUD and results for Play in the Park: pickup scoreboard, 21 leaderboard, HORSE letters, 3-point contest racks.
import { useEffect, useRef, useState } from "react";
import type { Match } from "@/game/sim/match";
import type { GameEvent } from "@/game/sim/events";
import { BALLS_PER_RACK, contestScore, HorseDrill, RACKS, ThreePointDrill, type ContestShot } from "@/game/sim/drill";
import type { ParkSession } from "@/state/matchStore";
import { Button } from "../kit";

function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const h = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(h);
  }, [ms]);
}

const short = (m: Match, id: string) => {
  const p = [...m.state.teams[0].roster, ...m.state.teams[1].roster].find((x) => x.id === id);
  return p ? `${p.firstName[0]}. ${p.lastName}` : "";
};

export function rulesLine(session: ParkSession) {
  const r = session.rules;
  if (!r) return "";
  const parts = [r.game === "21" ? `First to exactly ${r.target}` : `Game to ${r.target}`];
  if (r.game !== "21" && r.winBy === 2) parts.push("win by 2");
  parts.push(r.scoring === "ones" ? "1s and 2s" : "2s and 3s");
  if (r.game !== "21") parts.push(r.halfCourt ? "half court" : "full court");
  if (r.game !== "21" && r.makeItTakeIt) parts.push("make it, take it");
  return parts.join(" · ");
}

/** A short line for park events (checks, called fouls, baskets that didn't count, busts). */
function useParkCallout(match: Match) {
  const [text, setText] = useState<string | null>(null);
  const seen = useRef(0);
  useTick(150);
  const evs = match.state.events;
  useEffect(() => {
    if (evs.length < seen.current) seen.current = 0;
    for (let i = seen.current; i < evs.length; i++) {
      const e = evs[i] as GameEvent;
      if (e.t !== "park") continue;
      const who = e.player !== null ? match.name(e.player) : "";
      if (e.kind === "foulCall") setText(`${who} calls a foul. Check ball.`);
      else if (e.kind === "noClear") setText("Doesn't count: take it back past the arc");
      else if (e.kind === "bust") setText(`${who} goes over and drops back to ${match.state.park?.points[match.state.agents[e.player!].player.id] ?? 13}`);
    }
    seen.current = evs.length;
  });
  useEffect(() => {
    if (!text) return;
    const h = setTimeout(() => setText(null), 2600);
    return () => clearTimeout(h);
  }, [text]);
  return text;
}

function Callout({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div
      className="pointer-events-none fixed left-1/2 top-24 z-20 -translate-x-1/2 rounded-[var(--radius-chip)] bg-navy/90 px-4 py-2 font-display text-xl font-bold text-amber ring-1 ring-line"
      role="status"
    >
      {text}
    </div>
  );
}

export function ParkHud({ match, session }: { match: Match; session: ParkSession }) {
  useTick(120);
  const callout = useParkCallout(match);
  const s = match.state;
  if (match.drill instanceof HorseDrill) return <HorseBoard match={match} drill={match.drill} />;
  if (match.drill instanceof ThreePointDrill) return <ContestBoard match={match} drill={match.drill} />;
  const rules = session.rules!;
  const humanTeam = s.agents.find((a) => a.human !== null)?.team ?? null;
  const takeItBack = rules.halfCourt && s.park && !s.park.cleared && s.phase === "live" && humanTeam === s.offense && s.ball.owner !== null;

  if (rules.game === "21") {
    const rows = Object.entries(s.park?.points ?? {}).sort((a, b) => b[1] - a[1]);
    const holder = s.ball.owner !== null ? s.agents[s.ball.owner].player.id : null;
    return (
      <>
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-20 -translate-x-1/2 select-none rounded-[var(--radius-chip)] bg-navy/90 px-4 py-2 ring-1 ring-line backdrop-blur">
          <p className="mb-1 text-center text-xs text-steel">
            {rulesLine(session)} · over goes back to {Math.round(rules.target * 0.62)}
          </p>
          <div className="flex gap-4">
            {rows.map(([id, pts]) => (
              <div key={id} className="text-center">
                <p className={`text-sm ${id === holder ? "text-amber" : "text-steel"}`}>{short(match, id)}</p>
                <p className="led text-3xl">{pts}</p>
              </div>
            ))}
          </div>
        </div>
        {s.freeThrows && (
          <Callout text={`Free throws: ${s.freeThrows.made} of ${s.freeThrows.attempt - (s.ball.mode === "dead" ? 1 : 0)}, keep shooting until you miss`} />
        )}
        {!s.freeThrows && takeItBack && <Callout text="Take it back past the arc" />}
        {!s.freeThrows && !takeItBack && <Callout text={callout} />}
      </>
    );
  }

  const side = (ti: 0 | 1) => {
    const t = s.teams[ti];
    const color = session.sideShirts?.[ti] ?? t.team.colors.primary;
    return (
      <div className={`flex items-center gap-2 ${ti === 0 ? "flex-row-reverse" : ""}`}>
        <div className="flex h-12 items-center gap-2 px-3" style={{ background: color }}>
          <span className="whitespace-nowrap font-display text-xl font-extrabold" style={{ color: lightColor(color) ? "#14171c" : "#ffffff" }}>
            {t.team.name}
          </span>
        </div>
        <span className="led w-12 text-center text-4xl font-black text-net">{t.score}</span>
        <span className={`h-2 w-2 rounded-full ${s.offense === ti ? "bg-amber" : "bg-transparent"}`} aria-label={s.offense === ti ? "Possession" : undefined} />
      </div>
    );
  };
  return (
    <>
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-20 -translate-x-1/2 select-none" aria-live="off">
        <div className="flex items-stretch overflow-hidden rounded-[var(--radius-chip)] bg-navy/90 shadow-2xl ring-1 ring-line backdrop-blur">
          {side(1)}
          <div className="flex w-52 flex-col items-center justify-center border-x border-line bg-deck px-3 text-center">
            <span className="text-[11px] leading-tight text-steel">{rulesLine(session)}</span>
          </div>
          {side(0)}
        </div>
      </div>
      <Callout text={takeItBack ? "Take it back past the arc" : callout} />
    </>
  );
}

function lightColor(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) > 150;
}

function HorseBoard({ match, drill }: { match: Match; drill: HorseDrill }) {
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-20 w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2 select-none rounded-[var(--radius-chip)] bg-navy/90 px-4 py-3 ring-1 ring-line backdrop-blur">
      <div className="flex flex-wrap justify-center gap-5">
        {drill.players.map((p, i) => (
          <div key={p.idx} className={`text-center ${p.out ? "opacity-40" : ""}`}>
            <p className={`text-sm ${i === drill.turn ? "text-amber" : "text-steel"}`}>{match.name(p.idx)}</p>
            <p className="font-display text-2xl font-black tracking-[0.2em]">
              {drill.word.split("").map((ch, k) => (
                <span key={k} className={k < p.letters ? "text-bad" : "text-line"}>
                  {ch}
                </span>
              ))}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-1 text-center text-sm" role="status">
        {drill.mode === "match" && drill.setShot ? <b className="text-amber">Match it: {drill.setShot.label}. </b> : null}
        {drill.message}
      </p>
    </div>
  );
}

function ContestBoard({ match, drill }: { match: Match; drill: ThreePointDrill }) {
  void match;
  const dots = (rack: number) =>
    Array.from({ length: BALLS_PER_RACK }, (_, b) => {
      const shot = drill.shots.find((x) => x.rack === rack && x.ball === b);
      const money = b === BALLS_PER_RACK - 1;
      const cls = shot ? (shot.made ? (money ? "bg-amber" : "bg-good") : "bg-bad/70") : money ? "ring-1 ring-amber" : "ring-1 ring-line";
      return <span key={b} className={`h-3 w-3 rounded-full ${cls}`} />;
    });
  return (
    // top-left, so the racks along the near sideline stay in view
    <div className="pointer-events-none fixed left-5 top-5 z-20 select-none rounded-[var(--radius-chip)] bg-navy/90 px-5 py-3 ring-1 ring-line backdrop-blur">
      <div className="flex items-center gap-6">
        <div className="text-center">
          <p className="text-xs text-steel">Time</p>
          <p className={`led text-4xl ${drill.timeLeft < 10 ? "text-bad" : ""}`}>
            {drill.countdown > 0 ? Math.ceil(drill.countdown) : drill.timeLeft.toFixed(1)}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: RACKS }, (_, r) => (
            <div key={r} className={`flex items-center gap-1.5 ${r === drill.rack ? "" : "opacity-70"}`}>
              <span className={`w-14 text-xs ${r === drill.rack ? "text-amber" : "text-steel"}`}>{["L corner", "L wing", "Top", "R wing", "R corner"][r]}</span>
              {dots(r)}
            </div>
          ))}
        </div>
        <div className="text-center">
          <p className="text-xs text-steel">Score</p>
          <p className="led text-4xl">{drill.score}</p>
        </div>
      </div>
      <p className="mt-1 text-center text-xs text-steel">
        {drill.countdown > 0 ? "Get ready…" : "Walk to the rack for the next ball. Gold balls are worth 2."}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ results
export interface ParkOutcome {
  title: string;
  lines: { name: string; value: string; you?: boolean }[];
  youWon: boolean;
}

export function parkOutcome(match: Match, session: ParkSession, contestRivals: { name: string; shots: ContestShot[] }[] = []): ParkOutcome {
  const s = match.state;
  const youId = s.agents.find((a) => a.human !== null)?.player.id;
  if (match.drill instanceof HorseDrill) {
    const d = match.drill;
    const win = d.winner !== null ? d.players[d.winner] : null;
    return {
      title: win ? `${match.name(win.idx)} wins HORSE` : "HORSE",
      lines: d.players.map((p) => ({ name: match.name(p.idx), value: d.lettersOf(p) || "No letters", you: s.agents[p.idx].player.id === youId })),
      youWon: !!win && s.agents[win.idx].player.id === youId,
    };
  }
  if (match.drill instanceof ThreePointDrill) {
    const mine = match.drill.score;
    const rows = [
      { name: "You", value: String(mine), score: mine, you: true },
      ...contestRivals.map((r) => ({ name: r.name, value: String(contestScore(r.shots)), score: contestScore(r.shots), you: false })),
    ].sort((a, b) => b.score - a.score);
    return {
      title: rows[0].you ? "You win the 3-point contest" : `${rows[0].name} wins the 3-point contest`,
      lines: rows,
      youWon: rows[0].you && rows[0].score > (rows[1]?.score ?? -1),
    };
  }
  if (session.rules?.game === "21") {
    const pts = Object.entries(s.park?.points ?? {}).sort((a, b) => b[1] - a[1]);
    const w = s.park?.winnerId;
    return {
      title: w ? `${short(match, w)} wins 21` : "21",
      lines: pts.map(([id, p]) => ({ name: short(match, id), value: String(p), you: id === youId })),
      youWon: w === youId,
    };
  }
  const [h, a] = s.teams;
  const humanTeam = s.agents.find((x) => x.human !== null)?.team ?? 0;
  const winner = s.winner ?? (h.score > a.score ? 0 : 1);
  return {
    title: `${s.teams[winner].team.name} win ${Math.max(h.score, a.score)}-${Math.min(h.score, a.score)}`,
    lines: [
      { name: h.team.name, value: String(h.score), you: humanTeam === 0 },
      { name: a.team.name, value: String(a.score), you: humanTeam === 1 },
    ],
    youWon: winner === humanTeam,
  };
}

export function ParkFinal({
  outcome,
  onAgain,
  onBack,
  nextLabel,
  onNext,
}: {
  outcome: ParkOutcome;
  onAgain: () => void;
  onBack: () => void;
  nextLabel?: string;
  onNext?: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-navy/80 p-4 backdrop-blur" role="dialog" aria-label="Game over">
      <div className="w-full max-w-md rounded-[var(--radius-panel)] bg-deck p-6 ring-1 ring-line">
        <p className={`font-display text-lg font-bold ${outcome.youWon ? "text-good" : "text-steel"}`}>{outcome.youWon ? "You won" : "Good run"}</p>
        <h2 className="mb-4 font-display text-4xl font-black leading-tight">{outcome.title}</h2>
        <ul className="mb-6 flex flex-col gap-1">
          {outcome.lines.map((l, i) => (
            <li key={i} className={`flex justify-between rounded px-3 py-1.5 ${l.you ? "bg-amber/15 text-amber" : "bg-deck-2"}`}>
              <span>{l.name}</span>
              <span className="font-display text-xl font-black">{l.value}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          {onNext && <Button onClick={onNext}>{nextLabel ?? "Next game"}</Button>}
          <Button variant={onNext ? "secondary" : "primary"} onClick={onAgain}>
            Run it back
          </Button>
          <Button variant="secondary" onClick={onBack}>
            Back to the park
          </Button>
        </div>
      </div>
    </div>
  );
}
