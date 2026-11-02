// The draft order: a weighted lottery for the top four picks among teams that missed the playoffs, then record.
import { standings } from "@/career/hs/sim";
import { Rng } from "@/engine/rng";
import type { Team } from "@/engine/types";
import type { DraftPick, Franchise } from "../types";

/** Chances in 1,000 of a lottery pick, worst record first. */
export const LOTTERY_ODDS = [140, 140, 140, 125, 105, 90, 75, 60, 45, 30, 20, 15, 10, 5];
const LOTTERY_PICKS = 4;

/** The lottery teams' order after the draw. Teams come in worst first. */
export function drawLottery(teamIds: string[], rng: Rng): string[] {
  const pool = teamIds.map((id, i) => ({ id, odds: LOTTERY_ODDS[i] ?? 1 }));
  const winners: string[] = [];
  for (let i = 0; i < LOTTERY_PICKS && pool.length; i++) {
    const won = rng.weighted(
      pool,
      pool.map((p) => p.odds),
    );
    winners.push(won.id);
    pool.splice(pool.indexOf(won), 1);
  }
  return [...winners, ...pool.map((p) => p.id)];
}

/** Worst first, with ties broken by a draw. */
function worstFirst(f: Franchise, teams: Team[], rng: Rng): string[] {
  const table = standings(
    f.season.games.filter((g) => g.kind === "region"),
    teams.map((t) => t.id),
  );
  return [...table.values()]
    .map((r) => ({ r, tie: rng.next() }))
    .sort((a, b) => a.r.w - b.r.w || a.r.pf - a.r.pa - (b.r.pf - b.r.pa) || a.tie - b.tie)
    .map((x) => x.r.teamId);
}

export function runLottery(f: Franchise, teams: Team[]): Franchise {
  const rng = new Rng(`${f.seed}:lottery:${f.draft.year}`);
  const worst = worstFirst(f, teams, rng);
  const inPlayoffs = new Set(f.season.series.filter((s) => s.round >= 1).flatMap((s) => [s.high, s.low]));
  const missed = worst.filter((id) => !inPlayoffs.has(id));
  const drawn = drawLottery(missed, rng);
  const first = [...drawn, ...worst.filter((id) => inPlayoffs.has(id))];
  const pickOf = (teamId: string, round: DraftPick["round"]) => `pick-${f.draft.year}-${round}-${teamId}`;
  return {
    ...f,
    draft: {
      ...f.draft,
      order: [...first.map((id) => pickOf(id, 1)), ...worst.map((id) => pickOf(id, 2))],
      lottery: drawn.map((teamId, to) => ({ teamId, from: missed.indexOf(teamId), to })),
    },
  };
}
