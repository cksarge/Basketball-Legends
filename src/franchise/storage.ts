// Franchise saves in IndexedDB (via Dexie), plus .blfranchise export and import. A league is too big to rewrite on
// every change, so the summary, players and season live in separate tables and one commit is one transaction.
import Dexie, { type Table } from "dexie";
import type { Player, Team } from "@/engine/types";
import { defaultPlan } from "./coaching/plan";
import { FRANCHISE_VERSION, type Franchise, type FranchiseSummary, type LeagueSeason } from "./types";

type SaveData = Omit<Franchise, "players" | "season">;

interface SaveRow {
  id: string;
  updatedAt: number;
  revision: number;
  summary: FranchiseSummary;
  data: SaveData;
}
interface PlayerRow {
  saveId: string;
  id: string;
  data: Player;
}
interface SeasonRow {
  saveId: string;
  year: number;
  data: LeagueSeason;
}

export class FranchiseDb extends Dexie {
  saves!: Table<SaveRow, string>;
  players!: Table<PlayerRow, [string, string]>;
  seasons!: Table<SeasonRow, [string, number]>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ saves: "&id, updatedAt", players: "&[saveId+id], saveId", seasons: "&[saveId+year], saveId" });
  }
}

/** Saving over changes made elsewhere, such as in another tab. */
export class StaleFranchiseError extends Error {
  constructor() {
    super("This franchise was changed in another tab.");
    this.name = "StaleFranchiseError";
  }
}

let db: FranchiseDb | null = null;
/** Tests point the store at a fresh database. */
export function openFranchiseDb(name = "bl-franchise") {
  db?.close();
  db = new FranchiseDb(name);
  return db;
}
const getDb = () => db ?? openFranchiseDb();

export function summarizeFranchise(f: Franchise, team: Team | undefined): FranchiseSummary {
  let wins = 0,
    losses = 0;
  for (const g of f.season.games) {
    if (!g.result || g.kind !== "region" || (g.homeId !== f.teamId && g.awayId !== f.teamId)) continue;
    if (g.result.home > g.result.away === (g.homeId === f.teamId)) wins++;
    else losses++;
  }
  return {
    id: f.id,
    teamName: team ? `${team.name} ${team.nickname}` : f.teamId,
    teamId: f.teamId,
    league: f.league,
    primary: team?.colors.primary ?? "#1f3552",
    year: f.season.year,
    date: f.date,
    wins,
    losses,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}

function saveRow(f: Franchise, team: Team | undefined): SaveRow {
  const data: Partial<Franchise> = { ...f };
  delete data.players;
  delete data.season;
  return { id: f.id, updatedAt: f.updatedAt, revision: f.revision, summary: summarizeFranchise(f, team), data: data as SaveData };
}
const playerRows = (f: Franchise, ids: string[]): PlayerRow[] => ids.map((id) => ({ saveId: f.id, id, data: f.players[id] }));

export async function listFranchises(): Promise<FranchiseSummary[]> {
  const rows = await getDb().saves.orderBy("updatedAt").reverse().toArray();
  return rows.map((r) => r.summary);
}

export async function loadFranchise(id: string): Promise<Franchise | null> {
  const d = getDb();
  return d.transaction("r", d.saves, d.players, d.seasons, async () => {
    const row = await d.saves.get(id);
    if (!row) return null;
    const players = await d.players.where("saveId").equals(id).toArray();
    const seasons = await d.seasons.where("saveId").equals(id).toArray();
    const season = seasons.reduce((a, b) => (b.year > a.year ? b : a)).data;
    return migrateFranchise({ ...row.data, players: Object.fromEntries(players.map((p) => [p.id, p.data])), season });
  });
}

export async function createFranchiseSave(f: Franchise, team: Team | undefined): Promise<Franchise> {
  const d = getDb();
  await d.transaction("rw", d.saves, d.players, d.seasons, async () => {
    await d.saves.put(saveRow(f, team));
    await d.players.bulkPut(playerRows(f, Object.keys(f.players)));
    await d.seasons.put({ saveId: f.id, year: f.season.year, data: f.season });
  });
  return f;
}

/** Saves a change in one transaction. Pass changedPlayers to skip rewriting the other players. */
export async function commitFranchise(f: Franchise, team: Team | undefined, changedPlayers?: string[], now = Date.now()): Promise<Franchise> {
  const d = getDb();
  const saved: Franchise = { ...f, revision: f.revision + 1, updatedAt: now };
  await d.transaction("rw", d.saves, d.players, d.seasons, async () => {
    const row = await d.saves.get(f.id);
    if (!row || row.revision !== f.revision) throw new StaleFranchiseError();
    await d.saves.put(saveRow(saved, team));
    await d.players.bulkPut(playerRows(saved, changedPlayers ?? Object.keys(saved.players)));
    await d.seasons.put({ saveId: saved.id, year: saved.season.year, data: saved.season });
  });
  return saved;
}

export async function deleteFranchise(id: string) {
  const d = getDb();
  await d.transaction("rw", d.saves, d.players, d.seasons, async () => {
    await d.saves.delete(id);
    await d.players.where("saveId").equals(id).delete();
    await d.seasons.where("saveId").equals(id).delete();
  });
}

/** Upgrades older saves to the current format. */
export function migrateFranchise(f: Franchise): Franchise {
  if (!f || typeof f !== "object" || !f.id || !f.teamId || !f.players || !f.rosters || !Array.isArray(f.season?.games))
    throw new Error("That file isn't a franchise save.");
  if (f.version > FRANCHISE_VERSION) throw new Error("This franchise was saved by a newer version of the game. Update the game to open it.");
  // version 2 added coaching
  return {
    ...f,
    version: FRANCHISE_VERSION,
    plan: f.plan ?? defaultPlan(),
    devDate: f.devDate ?? f.date,
    settings: { ...f.settings, closeGamesOnly: f.settings.closeGamesOnly ?? false },
  };
}

export const FRANCHISE_EXPORT_KIND = "basketball-legends-franchise";

export function exportFranchise(f: Franchise): string {
  return JSON.stringify({ kind: FRANCHISE_EXPORT_KIND, version: FRANCHISE_VERSION, exportedAt: new Date().toISOString(), franchise: f });
}

/** Parses a .blfranchise file. Imports never overwrite: a franchise whose id already exists gets a new id. */
export async function importFranchise(text: string, team: (f: Franchise) => Team | undefined): Promise<Franchise> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a franchise save.");
  }
  const file = parsed as { kind?: string; franchise?: Franchise };
  if (file?.kind !== FRANCHISE_EXPORT_KIND || !file.franchise) throw new Error("That file isn't a franchise save.");
  let f = migrateFranchise(file.franchise);
  if (!team(f)) throw new Error("That file isn't a franchise save.");
  if (await getDb().saves.get(f.id)) f = { ...f, id: `${f.id}-import-${Date.now().toString(36)}` };
  return createFranchiseSave(f, team(f));
}
