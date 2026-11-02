// The general manager's side of a save. Filling it in is safe to repeat: partial commits leave older player rows
// behind, so a save can be version 3 with players that still need their files.
import { Rng, clamp } from "@/engine/rng";
import type { Player } from "@/engine/types";
import type { Franchise, PlayerFile, TeamBooks } from "../types";
import { newDraftState } from "./draftClass";
import { PICK_YEARS, futurePicks } from "./picks";
import { START_CAP } from "./rules";

const LONGEST_TENURE = 6;

type GmFields =
  "cap" | "picks" | "books" | "freeAgents" | "devRosters" | "waivers" | "draft" | "talks" | "retired" | "history" | "tradeBlock" | "tradeOffers" | "tradeLog";
export type BareFranchise = Omit<Franchise, GmFields> & Partial<Pick<Franchise, GmFields>>;

function defaultFile(seed: string, p: Player): PlayerFile {
  const service = clamp(p.age - 20, 0, 18);
  return { service, teamSeasons: new Rng(`${seed}:file:${p.id}`).int(0, Math.min(service, LONGEST_TENURE)) };
}

export function fillGmState(f: BareFranchise): Franchise {
  const teamIds = Object.keys(f.rosters);
  const year = f.season.year;
  const players = Object.values(f.players).some((p) => !p.file)
    ? Object.fromEntries(Object.entries(f.players).map(([id, p]) => [id, p.file ? p : { ...p, file: defaultFile(f.seed, p) }]))
    : f.players;
  return {
    ...f,
    players,
    cap: f.cap ?? { year, salaryCap: START_CAP },
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
    ...(f.phase === "offseason" && !f.offseason ? { offseason: { step: "review" as const, report: null } } : {}),
  };
}
