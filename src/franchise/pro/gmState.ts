// The general manager's side of a save. Filling it in is safe to repeat: partial commits leave older player rows
// behind, so a save can be version 3 with players that still need their files.
import { Rng, clamp } from "@/engine/rng";
import type { Player, Team } from "@/engine/types";
import { leagueTactics } from "../coaching/aiPlan";
import { DEFAULT_AUTO, DEFAULT_LEAGUE } from "../settings";
import { addSeason } from "../history/career";
import type { Franchise, LeagueSeason, PlayerFile, TeamBooks, TeamFinance } from "../types";
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
  | "aiTactics"
  | "world"
  | "formerWorlds";
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

/** A save from before jobs existed: its record comes from the season summaries, plus a season finished but not yet summarized. */
function startingJob(f: BareFranchise): Franchise["job"] {
  const history = f.history ?? [];
  const total = history.reduce((t, h) => ({ w: t.w + h.record.w, l: t.l + h.record.l, titles: t.titles + (h.championId === f.teamId ? 1 : 0) }), {
    w: 0,
    l: 0,
    titles: 0,
  });
  if (f.phase === "offseason") {
    for (const g of f.season.games) {
      if (!g.result || g.kind !== "region" || (g.homeId !== f.teamId && g.awayId !== f.teamId)) continue;
      if (g.result.home > g.result.away === (g.homeId === f.teamId)) total.w++;
      else total.l++;
    }
    if (f.season.championId === f.teamId) total.titles++;
  }
  const from = history[0]?.year ?? f.season.year;
  const division = f.world?.division;
  return {
    security: START_SECURITY,
    goals: [],
    seasons: 0,
    reviews: [],
    stints: [{ teamId: f.teamId, league: f.league, ...(division ? { division } : {}), from, ...total }],
  };
}

/** Career totals for a save from before they were kept, from its finished seasons. */
export function backfillCareers(f: Franchise, past: LeagueSeason[]): Franchise {
  const done = past.filter((s) => s.year < f.season.year).sort((a, b) => a.year - b.year);
  if (!done.length) return f;
  const players = { ...f.players };
  for (const s of done)
    for (const [id, line] of Object.entries(s.stats)) {
      const p = players[id];
      if (p) players[id] = addSeason(p, line, { ...f, season: s });
    }
  return { ...f, players };
}

/** Saves from before college and high school ran in the pro world. */
export function fillWorld<T extends BareFranchise>(f: T): T & Pick<Franchise, "world" | "formerWorlds"> {
  return {
    ...f,
    world: f.world ?? { league: f.league },
    formerWorlds: f.formerWorlds ?? [],
    season: f.season.brackets ? f.season : { ...f.season, brackets: [] },
  };
}

/** Saves don't hold team data, so prestige only reaches the books of a new franchise. */
export function fillGmState(bare: BareFranchise, teams?: Team[]): Franchise {
  const f = fillWorld(bare);
  // the cap, picks, the draft and club money exist only in pro
  const pro = f.league === "pro";
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
    picks: f.picks ?? (pro ? futurePicks(teamIds, year + 1, PICK_YEARS) : []),
    books: f.books ?? (pro ? Object.fromEntries(teamIds.map((id): [string, TeamBooks] => [id, { dead: [], midLevelUsed: 0 }])) : {}),
    freeAgents: f.freeAgents ?? [],
    devRosters: f.devRosters ?? Object.fromEntries(teamIds.map((id) => [id, []])),
    waivers: f.waivers ?? [],
    draft: f.draft ?? (pro ? newDraftState(f.seed, year + 1) : { year: year + 1, prospects: [], scouting: {}, assigned: [], results: [] }),
    talks: f.talks ?? {},
    retired: f.retired ?? [],
    history: f.history ?? [],
    tradeBlock: f.tradeBlock ?? [],
    tradeOffers: f.tradeOffers ?? [],
    tradeLog: f.tradeLog ?? [],
    finance: f.finance ?? (pro ? Object.fromEntries(teamIds.map((id) => [id, defaultFinance(cap, teams?.find((t) => t.id === id)?.prestige)])) : {}),
    job: f.job ?? startingJob(f),
    news: f.news ?? [],
    hall: f.hall ?? [],
    records: f.records ?? [],
    powerLast: f.powerLast ?? {},
    aiTactics: f.aiTactics ?? leagueTactics({ rosters: f.rosters, players, seed: f.seed, season: f.season }),
    ...(f.phase === "offseason" && !f.offseason ? { offseason: { step: "review" as const, report: null } } : {}),
  };
}
