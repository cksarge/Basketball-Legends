// The general manager's side of a save. Filling it in is safe to repeat: partial commits leave older player rows
// behind, so a save can be version 3 with players that still need their files.
import { Rng, clamp } from "@/engine/rng";
import type { Player, Team } from "@/engine/types";
import { leagueTactics } from "../coaching/aiPlan";
import { DEFAULT_AUTO, DEFAULT_LEAGUE } from "../settings";
import type { Franchise, PlayerFile, TeamBooks, TeamFinance } from "../types";
import { newDraftState } from "./draftClass";
import { PICK_YEARS, futurePicks } from "./picks";
import { START_CAP, capRules, ticketBase } from "./rules";

const LONGEST_TENURE = 6;
const NEUTRAL = 50;
const PRESTIGE_POINTS = 40;
export const START_SECURITY = 60;

type GmFields =
  | "cap"
  | "picks"
  | "books"
  | "freeAgents"
  | "devRosters"
  | "waivers"
  | "draft"
  | "talks"
  | "retired"
  | "history"
  | "tradeBlock"
  | "tradeOffers"
  | "tradeLog"
  | "finance"
  | "job"
  | "news"
  | "hall"
  | "records"
  | "powerLast"
  | "aiTactics";
export type BareFranchise = Omit<Franchise, GmFields> & Partial<Pick<Franchise, GmFields>>;

function defaultFile(seed: string, p: Player): PlayerFile {
  const service = clamp(p.age - 20, 0, 18);
  return { service, teamSeasons: new Rng(`${seed}:file:${p.id}`).int(0, Math.min(service, LONGEST_TENURE)) };
}

function defaultFinance(cap: Franchise["cap"], prestige?: number): TeamFinance {
  const budget = capRules(cap).budgetDefault;
  const standing = Math.round(NEUTRAL + (prestige === undefined ? 0 : (prestige - 0.5) * PRESTIGE_POINTS));
  return {
    ticketPrice: ticketBase(cap),
    budgets: { coaching: budget, scouting: budget, facilities: budget },
    facilities: standing,
    hype: standing,
    balance: 0,
    season: { revenue: 0, expenses: 0, attendance: 0, homeGames: 0 },
  };
}

/** Saves don't hold team data, so prestige only reaches the books of a new franchise. */
export function fillGmState(f: BareFranchise, teams?: Team[]): Franchise {
  const teamIds = Object.keys(f.rosters);
  const year = f.season.year;
  const cap = f.cap ?? { year, salaryCap: START_CAP };
  const players = Object.values(f.players).some((p) => !p.file)
    ? Object.fromEntries(Object.entries(f.players).map(([id, p]) => [id, p.file ? p : { ...p, file: defaultFile(f.seed, p) }]))
    : f.players;
  return {
    ...f,
    players,
    cap,
    settings: { ...f.settings, auto: { ...DEFAULT_AUTO, ...f.settings.auto }, league: f.settings.league ?? DEFAULT_LEAGUE },
    picks: f.picks ?? futurePicks(teamIds, year + 1, PICK_YEARS),
    books: f.books ?? Object.fromEntries(teamIds.map((id): [string, TeamBooks] => [id, { dead: [], midLevelUsed: 0 }])),
    freeAgents: f.freeAgents ?? [],
    devRosters: f.devRosters ?? Object.fromEntries(teamIds.map((id) => [id, []])),
    waivers: f.waivers ?? [],
    draft: f.draft ?? newDraftState(f.seed, year + 1),
    talks: f.talks ?? {},
    retired: f.retired ?? [],
    history: f.history ?? [],
    tradeBlock: f.tradeBlock ?? [],
    tradeOffers: f.tradeOffers ?? [],
    tradeLog: f.tradeLog ?? [],
    finance: f.finance ?? Object.fromEntries(teamIds.map((id) => [id, defaultFinance(cap, teams?.find((t) => t.id === id)?.prestige)])),
    job: f.job ?? {
      security: START_SECURITY,
      goals: [],
      seasons: 0,
      reviews: [],
      stints: [{ teamId: f.teamId, league: f.league, from: year, w: 0, l: 0, titles: 0 }],
    },
    news: f.news ?? [],
    hall: f.hall ?? [],
    records: f.records ?? [],
    powerLast: f.powerLast ?? {},
    aiTactics: f.aiTactics ?? leagueTactics({ rosters: f.rosters, players, seed: f.seed, season: f.season }),
    ...(f.phase === "offseason" && !f.offseason ? { offseason: { step: "review" as const, report: null } } : {}),
  };
}
