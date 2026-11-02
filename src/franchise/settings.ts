// League rules the user can change, and which systems run themselves.
import type { ScheduledGame } from "@/career/types";
import { Rng } from "@/engine/rng";
import type { AutoKey, Franchise, FranchiseSettings, LeagueSettings } from "./types";

export const DEFAULT_LEAGUE: LeagueSettings = {
  gamesPerSeason: 82,
  playoffFormat: { firstRoundBestOf: 7, playIn: true },
  tradeDifficulty: "normal",
  injuries: "normal",
  progression: "normal",
};

/** Only the roster runs itself to start with, so a sim is never blocked by surprise. */
export const DEFAULT_AUTO: Record<AutoKey, boolean> = {
  tactics: false,
  practice: false,
  scouting: false,
  draft: false,
  contracts: false,
  freeAgency: false,
  trades: false,
  finances: false,
  roster: true,
};

/** Home games minus away games a team can carry after a trim. */
const HOME_LEAN = 2;
const WAITS = ["gamesPerSeason", "playoffFormat"] as const;
export const INJURY_RATE: Record<LeagueSettings["injuries"], number> = { off: 0, fewer: 0.5, normal: 1, more: 1.5 };
export const PROGRESSION_SPEED: Record<LeagueSettings["progression"], number> = { slow: 0.7, normal: 1, fast: 1.3 };
export const TRADE_MARGINS: Record<LeagueSettings["tradeDifficulty"], number> = { easy: 0.02, normal: 0.08, hard: 0.16 };

const same = (a: LeagueSettings, b: LeagueSettings) => JSON.stringify(a) === JSON.stringify(b);

/** Game count and playoff format wait for next season. Everything else applies at once. */
export function setLeagueSettings(f: Franchise, patch: Partial<LeagueSettings>): Franchise {
  const now = { ...f.settings.league };
  const later = { ...(f.settings.pendingLeague ?? f.settings.league) };
  for (const [key, value] of Object.entries(patch)) {
    Object.assign(later, { [key]: value });
    if (!(WAITS as readonly string[]).includes(key)) Object.assign(now, { [key]: value });
  }
  const settings: FranchiseSettings = { ...f.settings, league: now, pendingLeague: later };
  if (same(later, now)) delete settings.pendingLeague;
  return { ...f, settings };
}

export function applyPending(f: Franchise): Franchise {
  const { pendingLeague, ...rest } = f.settings;
  return pendingLeague ? { ...f, settings: { ...rest, league: pendingLeague } } : f;
}

/** Cuts a schedule to a shorter season, keeping every team at exactly that many games. */
export function trimSchedule(games: ScheduledGame[], teamIds: string[], perTeam: number, seed: string): ScheduledGame[] {
  const count = Object.fromEntries(teamIds.map((id) => [id, 0]));
  for (const g of games) {
    count[g.homeId]++;
    count[g.awayId]++;
  }
  if (teamIds.every((id) => count[id] === perTeam)) return games;
  const rng = new Rng(`${seed}:trim:${perTeam}`);
  const order = rng.shuffle([...games]);
  const cut = new Set<ScheduledGame>();
  const over = (id: string) => count[id] > perTeam;
  for (const g of order) {
    if (!over(g.homeId) || !over(g.awayId)) continue;
    cut.add(g);
    count[g.homeId]--;
    count[g.awayId]--;
  }
  // anyone still over has no game left to drop with another team that's over: drop two of theirs, and bring back a game between those opponents
  for (let left = teamIds.filter(over); left.length; left = teamIds.filter(over)) {
    const [a, b = a] = left;
    const kept = order.filter((g) => !cut.has(g));
    const teamGames = (id: string, skip: string) =>
      kept.filter((g) => (g.homeId === id || g.awayId === id) && (a === b || (g.homeId !== skip && g.awayId !== skip)));
    const opponent = (g: ScheduledGame, id: string) => (g.homeId === id ? g.awayId : g.homeId);
    const between = (c: string, d: string) => [...cut].find((g) => (g.homeId === c && g.awayId === d) || (g.homeId === d && g.awayId === c));
    const swap = teamGames(a, b)
      .flatMap((x) =>
        teamGames(b, a).map((y) => ({ x, y, back: x !== y && opponent(x, a) !== opponent(y, b) ? between(opponent(x, a), opponent(y, b)) : undefined })),
      )
      .find((s) => s.back);
    if (!swap) break;
    cut.add(swap.x);
    cut.add(swap.y);
    cut.delete(swap.back!);
    count[a]--;
    count[b]--;
  }
  return balanceHomes(
    games.filter((g) => !cut.has(g)),
    teamIds,
  );
}

/** Cutting games at random can leave a team too many at home, so lopsided matchups swap courts. */
function balanceHomes(games: ScheduledGame[], teamIds: string[]): ScheduledGame[] {
  const lean = Object.fromEntries(teamIds.map((id) => [id, 0]));
  for (const g of games) {
    lean[g.homeId]++;
    lean[g.awayId]--;
  }
  return games.map((g) => {
    if (lean[g.homeId] <= HOME_LEAN || lean[g.awayId] >= -HOME_LEAN) return g;
    lean[g.homeId] -= 2;
    lean[g.awayId] += 2;
    return { ...g, homeId: g.awayId, awayId: g.homeId };
  });
}
