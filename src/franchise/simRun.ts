// Sims a stretch of days, saving after each one so closing the tab never loses or doubles anything.
import type { IsoDate } from "@/career/types";
import type { Team } from "@/engine/types";
import { nextFranchiseEvent, simDay } from "./core/season";
import { commitFranchise, loadFranchise } from "./storage";
import type { Franchise } from "./types";

export interface SimRange {
  id: string;
  until: IsoDate | "nextUserGame" | "seasonEnd";
  includeUser: boolean;
  /** Settle a game that's partway through. */
  simLive?: boolean;
}

const reached = (f: Franchise, r: SimRange) => {
  if (f.phase === "offseason") return true;
  if (r.until === "seasonEnd") return false;
  if (r.until !== "nextUserGame") return f.date > r.until;
  const ev = nextFranchiseEvent(f);
  return ev.kind === "game" && ev.date === f.date && f.season.games.every((g) => g.result || g.id === ev.game.id || g.date !== f.date);
};

export async function runSim(r: SimRange, teams: Team[], onDay: (date: IsoDate) => void, cancelled: () => boolean): Promise<Franchise> {
  let f = await loadFranchise(r.id);
  if (!f) throw new Error("That franchise isn't saved in this browser.");
  const team = teams.find((t) => t.id === f!.teamId);
  while (!reached(f, r) && !cancelled()) {
    const day = simDay(f, teams, { includeUser: r.includeUser, simLive: r.simLive });
    f = await commitFranchise(day.franchise, team, day.changedPlayers);
    onDay(f.date);
    if (day.blocked) break;
  }
  return f;
}
