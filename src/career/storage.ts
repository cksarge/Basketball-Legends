// Career saves in IndexedDB (via Dexie), plus .blcareer export and import.
// Each row keeps a small summary for the career select screen next to the full save.
import Dexie, { type Table } from "dexie";
import { playerOvr } from "@/engine/player";
import type { Team } from "@/engine/types";
import { CAREER_VERSION, type Career, type CareerSummary } from "./types";

interface CareerRow {
  id: string;
  updatedAt: number;
  summary: CareerSummary;
  data: Career;
}

class CareerDb extends Dexie {
  careers!: Table<CareerRow, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ careers: "&id, updatedAt" });
  }
}

let db: CareerDb | null = null;
/** Tests point the store at a fresh database. */
export function openCareerDb(name = "bl-career") {
  db?.close();
  db = new CareerDb(name);
  return db;
}
const getDb = () => db ?? openCareerDb();

export function summarize(c: Career, team: Team | undefined): CareerSummary {
  const p = c.player;
  return {
    id: c.id,
    name: `${p.firstName} ${p.lastName}`,
    updatedAt: c.updatedAt,
    createdAt: c.createdAt,
    stage: c.stage,
    date: c.date,
    teamName: team ? `${team.name} ${team.nickname}` : "Free agent",
    pos: p.pos,
    archetype: p.archetype,
    ovr: playerOvr(p),
    jersey: p.jersey,
    appearance: p.appearance,
    primary: team?.colors.primary ?? "#1f3552",
  };
}

export async function listCareers(): Promise<CareerSummary[]> {
  const rows = await getDb().careers.orderBy("updatedAt").reverse().toArray();
  return rows.map((r) => r.summary);
}

export async function loadCareer(id: string): Promise<Career | null> {
  const row = await getDb().careers.get(id);
  return row ? migrate(row.data) : null;
}

export async function saveCareer(c: Career, team: Team | undefined, now = Date.now()): Promise<Career> {
  const saved = { ...c, updatedAt: now };
  await getDb().careers.put({ id: saved.id, updatedAt: saved.updatedAt, summary: summarize(saved, team), data: saved });
  return saved;
}

export async function deleteCareer(id: string) {
  await getDb().careers.delete(id);
}

/** Upgrades older saves to the current format and fills in fields added since they were saved. */
export function migrate(c: Career): Career {
  if (!c || typeof c !== "object" || !c.player || !c.id) throw new Error("Not a Basketball Legends career");
  if (c.version > CAREER_VERSION) throw new Error("This career was saved by a newer version of the game. Update the game to open it.");
  // fields added during the 0.3.0 betas get their defaults
  return {
    ...c,
    player: { ...c.player, academics: c.player.academics ?? 0.6 },
    hs: { ...c.hs, seasons: c.hs.seasons.map((s) => ({ ...s, grades: s.grades ?? {}, focus: s.focus ?? 0.5 })) },
  };
}

export const EXPORT_KIND = "basketball-legends-career";

export function exportCareer(c: Career): string {
  return JSON.stringify({ kind: EXPORT_KIND, version: CAREER_VERSION, exportedAt: new Date().toISOString(), career: c });
}

/** Parses a .blcareer file. Imports never overwrite: a career whose id already exists gets a new id. */
export async function importCareer(text: string, team: (c: Career) => Team | undefined): Promise<Career> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a career save.");
  }
  const file = parsed as { kind?: string; career?: Career };
  if (file?.kind !== EXPORT_KIND || !file.career) throw new Error("That file isn't a career save.");
  let c = migrate(file.career);
  if (await getDb().careers.get(c.id)) c = { ...c, id: `${c.id}-import-${Date.now().toString(36)}` };
  return saveCareer(c, team(c));
}
