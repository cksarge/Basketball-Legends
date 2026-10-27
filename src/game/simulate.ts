// Instant simulation: runs a Match headlessly in time-sliced chunks so the UI stays responsive.
import { Match, type MatchSetup } from "./sim/match";

export const SIM_DT = 1 / 30; // coarser step is fine headless and twice as fast

export function simulateToEnd(match: Match, onProgress?: (p: number) => void, budgetMs = 12): Promise<Match> {
  const s = match.state;
  const total = s.cfg.quarterMinutes * 60 * s.cfg.rules.periods;
  s.cfg.fast = true;
  for (const a of s.agents) a.human = null;
  s.teams[0].humanControlled = false;
  s.teams[1].humanControlled = false;
  match.humanSlots = [[], []];
  return new Promise((resolve) => {
    const tick = () => {
      const t0 = performance.now();
      let guard = 0;
      while (s.phase !== "final" && performance.now() - t0 < budgetMs && guard < 20000) {
        match.step(SIM_DT);
        guard++;
      }
      const played = Math.min(total, (s.period - 1) * s.cfg.quarterMinutes * 60 + (s.cfg.quarterMinutes * 60 - s.clock));
      onProgress?.(s.phase === "final" ? 1 : Math.min(0.99, played / total));
      if (s.phase === "final") resolve(match);
      else setTimeout(tick, 0);
    };
    tick();
  });
}

export function simulateSetup(setup: MatchSetup, onProgress?: (p: number) => void) {
  return simulateToEnd(new Match({ ...setup, fast: true }), onProgress);
}
