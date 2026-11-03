// Whether a deal is legal, and making it happen. AI deals go through the same checks as the user's.
import { proCalendar } from "@/career/calendar";
import type { Team } from "@/engine/types";
import { addNews, tradeNews } from "../history/news";
import type { Franchise } from "../types";
import { moneyM, payroll, rightsLimit } from "./cap";
import { freeJersey } from "./draft";
import { askingPrice } from "./market";
import { joinTeam, standardCount } from "./rosterMoves";
import { OFFSEASON_ROSTER_MAX, ROSTER_MAX, ROSTER_MIN, TWO_WAY_MAX, capRules } from "./rules";

export type TradeAsset =
  | { kind: "player"; id: string; from: string; to: string; signAndTrade?: { salary: number; years: number } }
  | { kind: "pick"; id: string; from: string; to: string };
export interface Trade {
  teams: string[];
  assets: TradeAsset[];
}

const MAX_TEAMS = 3;
const MATCH_OVER_CAP = 1.25;
const MATCH_FIRST_APRON = 1.1;

export function tradeOpen(f: Franchise): boolean {
  if (f.phase === "offseason") return true;
  return f.phase === "regular" && f.date <= proCalendar(f.season.year).tradeDeadline;
}

const assetSalary = (f: Franchise, a: TradeAsset) =>
  a.kind !== "player" ? 0 : a.signAndTrade ? a.signAndTrade.salary : (f.players[a.id].contract?.salary ?? 0);
const onCapAsset = (f: Franchise, a: TradeAsset) => a.kind === "player" && !f.players[a.id].contract?.twoWay && !f.players[a.id].contract?.dev;

function assetProblem(f: Franchise, t: Trade, a: TradeAsset): string | null {
  if (!t.teams.includes(a.from) || !t.teams.includes(a.to) || a.from === a.to) return "Every asset has to move between teams in the deal.";
  if (a.kind === "pick") {
    const pick = f.picks.find((p) => p.id === a.id);
    if (!pick) return "That pick no longer exists.";
    if (f.draft.results.some((r) => r.pickId === a.id)) return "That pick has already been used.";
    return pick.ownerId === a.from ? null : `${a.from} doesn't own that pick.`;
  }
  const p = f.players[a.id];
  if (!p) return "That player is gone.";
  if (f.waivers.some((w) => w.playerId === a.id)) return `${p.firstName} ${p.lastName} is on waivers.`;
  if (a.signAndTrade) {
    if (!f.freeAgents.includes(a.id) || p.file?.rightsTeamId !== a.from) return `${a.from} doesn't hold his rights.`;
    return a.signAndTrade.salary > rightsLimit(f, p, a.from) ? `His rights allow up to ${moneyM(rightsLimit(f, p, a.from))}.` : null;
  }
  if (f.freeAgents.includes(a.id)) return `${p.firstName} ${p.lastName} is a free agent.`;
  return p.teamId === a.from ? null : `${p.firstName} ${p.lastName} isn't on ${a.from}.`;
}

function salaryProblem(f: Franchise, t: Trade, teamId: string): string | null {
  const rules = capRules(f.cap);
  const incoming = t.assets.filter((a) => a.to === teamId && onCapAsset(f, a));
  const coming = incoming.reduce((sum, a) => sum + assetSalary(f, a), 0);
  const going = t.assets.filter((a) => a.from === teamId && onCapAsset(f, a)).reduce((sum, a) => sum + assetSalary(f, a), 0);
  const after = payroll(f, teamId) - going + coming;
  if (after > rules.firstApron && incoming.some((a) => a.kind === "player" && a.signAndTrade))
    return `${teamId} is over the first apron and can't take a sign-and-trade.`;
  if (coming <= going || after <= rules.salaryCap) return null;
  if (after > rules.secondApron) return `${teamId} is over the second apron and can't take on salary.`;
  const share = after > rules.firstApron ? MATCH_FIRST_APRON : MATCH_OVER_CAP;
  const limit = going * share + rules.tradeCushion;
  return coming > limit ? `${teamId} can take back at most ${moneyM(limit)} in salary, and this is ${moneyM(coming)}.` : null;
}

function rosterProblem(f: Franchise, t: Trade, teamId: string): string | null {
  const counts = (a: TradeAsset) => a.kind === "player" && !f.players[a.id].contract?.twoWay;
  const after =
    standardCount(f, teamId) +
    t.assets.filter((a) => a.to === teamId && counts(a)).length -
    t.assets.filter((a) => a.from === teamId && counts(a) && !(a.kind === "player" && a.signAndTrade)).length;
  const limit = f.phase === "offseason" ? OFFSEASON_ROSTER_MAX : ROSTER_MAX;
  const twoWay = (a: TradeAsset) => a.kind === "player" && !!f.players[a.id].contract?.twoWay;
  const lowDeals =
    f.rosters[teamId].filter((id) => f.players[id].contract?.twoWay).length +
    t.assets.filter((a) => a.to === teamId && twoWay(a)).length -
    t.assets.filter((a) => a.from === teamId && twoWay(a)).length;
  if (lowDeals > TWO_WAY_MAX) return `${teamId} would have more than ${TWO_WAY_MAX} two-way players.`;
  if (after > limit) return `${teamId} would have ${after} players, over the roster limit of ${limit}.`;
  // AI teams keep a full roster in season; the user can sign someone before the next game
  return f.phase !== "offseason" && teamId !== f.teamId && after < ROSTER_MIN ? `${teamId} would have too few players.` : null;
}

/** Everything wrong with a deal. Empty means it's legal. */
export function tradeProblems(f: Franchise, t: Trade): string[] {
  if (!tradeOpen(f)) return ["The trade deadline has passed."];
  if (t.teams.length < 2 || t.teams.length > MAX_TEAMS || new Set(t.teams).size !== t.teams.length) return ["A trade needs two or three teams."];
  if (!t.assets.length) return ["Add something to the deal."];
  const assets = t.assets.map((a) => assetProblem(f, t, a)).filter((x): x is string => !!x);
  if (assets.length) return assets;
  return t.teams.flatMap((id) => [salaryProblem(f, t, id), rosterProblem(f, t, id)]).filter((x): x is string => !!x);
}

/** The user's deal: made, logged and reported. */
export function userTrade(f: Franchise, t: Trade, teams: Team[]): Franchise {
  const next = applyTrade(f, t);
  if (next === f) return f;
  const entry = { date: f.date, teams: t.teams, assets: t.assets };
  return addNews({ ...next, tradeLog: [...next.tradeLog, entry] }, tradeNews(next, entry, teams));
}

/** A team's expired players it could sign and trade during free agency, at what they'd take within its rights. */
export function signAndTradeOptions(f: Franchise, teamId: string) {
  if (!f.freeAgency) return [];
  return f.freeAgents
    .map((id) => f.players[id])
    .filter((p) => p.file?.rightsTeamId === teamId && rightsLimit(f, p, teamId) > 0)
    .map((p) => {
      const ask = askingPrice(f, p, teamId);
      return { id: p.id, salary: Math.min(ask.salary, rightsLimit(f, p, teamId)), years: ask.years };
    });
}

export function applyTrade(f: Franchise, t: Trade): Franchise {
  if (tradeProblems(f, t).length) return f;
  let next = f;
  for (const a of t.assets) {
    if (a.kind === "pick") {
      next = { ...next, picks: next.picks.map((p) => (p.id === a.id ? { ...p, ownerId: a.to } : p)) };
      continue;
    }
    const p = next.players[a.id];
    const moved = a.signAndTrade
      ? joinTeam(next, a.to, a.id, { salary: a.signAndTrade.salary, years: a.signAndTrade.years })
      : { ...p, teamId: a.to, jersey: freeJersey(next, a.to, p.jersey) };
    const dev = next.devRosters[a.from].includes(a.id);
    next = {
      ...next,
      players: { ...next.players, [a.id]: { ...moved, file: { ...moved.file!, teamSeasons: 0 } } },
      rosters: dev ? next.rosters : { ...next.rosters, [a.from]: next.rosters[a.from].filter((x) => x !== a.id), [a.to]: [...next.rosters[a.to], a.id] },
      devRosters: dev
        ? { ...next.devRosters, [a.from]: next.devRosters[a.from].filter((x) => x !== a.id), [a.to]: [...next.devRosters[a.to], a.id] }
        : next.devRosters,
      freeAgents: next.freeAgents.filter((x) => x !== a.id),
    };
  }
  return next;
}
