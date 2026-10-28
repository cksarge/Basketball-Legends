// Turning a finished Match into a career game outcome, and a synchronous runner for tests and tools.
import { Match, type MatchSetup } from "@/game/sim/match";
import { gameScore } from "@/game/sim/stats";
import type { UserGameOutcome } from "./season";

export function outcomeFromMatch(m: Match, played: boolean): UserGameOutcome {
  const s = m.state;
  const all = [...s.teams[0].roster, ...s.teams[1].roster];
  let best: { id: string; gs: number } | null = null;
  for (const p of all) {
    const line = s.box[p.id];
    if (line && (!best || gameScore(line) > best.gs)) best = { id: p.id, gs: gameScore(line) };
  }
  const regulation = s.cfg.rules.periods;
  return {
    homeScore: s.teams[0].score,
    awayScore: s.teams[1].score,
    overtimes: Math.max(0, s.period - regulation),
    box: s.box,
    played,
    playerOfGame: best?.id ?? null,
  };
}

/** Runs a whole game headlessly (blocking). The UI uses the time-sliced simulateToEnd instead. */
export function runMatchSync(setup: MatchSetup): Match {
  const m = new Match({ ...setup, fast: true });
  for (const a of m.state.agents) a.human = null;
  m.state.teams[0].humanControlled = false;
  m.state.teams[1].humanControlled = false;
  m.humanSlots = [[], []];
  let steps = 0;
  while (m.state.phase !== "final" && steps < 500_000) {
    m.step(1 / 30);
    steps++;
  }
  return m;
}
