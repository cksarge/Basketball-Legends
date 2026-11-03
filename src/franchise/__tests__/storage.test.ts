import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Team } from "@/engine/types";
import { emptyLine } from "@/game/sim/stats";
import { createFranchise } from "../create";
import {
  StaleFranchiseError,
  commitFranchise,
  createFranchiseSave,
  deleteFranchise,
  exportFranchise,
  importFranchise,
  listFranchises,
  loadFranchise,
  migrateFranchise,
  openFranchiseDb,
  pastSeasons,
  type FranchiseDb,
} from "../storage";
import { defaultPlan } from "../coaching/plan";
import { FRANCHISE_VERSION, type Franchise } from "../types";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const team = teams[0];
let n = 0;
const make = () => createFranchise({ league: "pro", team, teams, seed: `s${n++}`, now: 1000 + n });

let db: FranchiseDb;
beforeEach(() => {
  db = openFranchiseDb(`test-${Math.random()}`);
});

describe("franchise storage", () => {
  it("round trips a save", async () => {
    const f = await createFranchiseSave(make(), team);
    const loaded = await loadFranchise(f.id);
    expect(loaded).toEqual(f);
    expect(Object.keys(loaded!.players)).toHaveLength(Object.keys(f.players).length);
    expect(await loadFranchise("missing")).toBeNull();
  });

  it("lists newest first", async () => {
    const a = await createFranchiseSave(make(), team);
    const b = await createFranchiseSave(make(), team);
    await commitFranchise({ ...a, date: "2026-12-01" }, team, []);
    expect((await listFranchises()).map((s) => s.id)).toEqual([a.id, b.id]);
    expect((await listFranchises())[0].date).toBe("2026-12-01");
  });

  it("raises the revision on each commit", async () => {
    const f = await createFranchiseSave(make(), team);
    const next = await commitFranchise({ ...f, date: "2026-12-01" }, team);
    expect(next.revision).toBe(f.revision + 1);
  });

  it("refuses a stale copy and leaves the stored save alone", async () => {
    const f = await createFranchiseSave(make(), team);
    await commitFranchise({ ...f, date: "2026-12-01" }, team);
    await expect(commitFranchise({ ...f, date: "2027-01-01" }, team)).rejects.toBeInstanceOf(StaleFranchiseError);
    expect((await loadFranchise(f.id))!.date).toBe("2026-12-01");
  });

  it("writes only the changed players when told which ones changed", async () => {
    const f = await createFranchiseSave(make(), team);
    const [a, b] = Object.keys(f.players);
    const players = { ...f.players, [a]: { ...f.players[a], age: 50 }, [b]: { ...f.players[b], age: 51 } };
    await commitFranchise({ ...f, players }, team, [a]);
    const loaded = (await loadFranchise(f.id))!;
    expect(loaded.players[a].age).toBe(50);
    expect(loaded.players[b].age).toBe(f.players[b].age);
  });

  it("deleting removes every table's rows", async () => {
    const f = await createFranchiseSave(make(), team);
    const other = await createFranchiseSave(make(), team);
    await deleteFranchise(f.id);
    expect(await loadFranchise(f.id)).toBeNull();
    expect(await db.players.where("saveId").equals(f.id).count()).toBe(0);
    expect(await db.seasons.where("saveId").equals(f.id).count()).toBe(0);
    expect(await loadFranchise(other.id)).not.toBeNull();
  });

  it("refuses a save from a newer version", () => {
    expect(() => migrateFranchise({ ...make(), version: FRANCHISE_VERSION + 1 })).toThrow(/saved by a newer version/);
  });

  const version1 = (): Franchise => {
    const f = { ...make(), version: 1 } as Partial<Franchise>;
    delete f.plan;
    delete f.devDate;
    return f as Franchise;
  };

  it("opens a version 1 save with default coaching and its stats intact", async () => {
    const stats = { x: { ...emptyLine(), gp: 3, gs: 3 } };
    const old = version1();
    await createFranchiseSave({ ...old, season: { ...old.season, stats } }, team);
    const f = (await loadFranchise(old.id))!;
    expect(f.version).toBe(FRANCHISE_VERSION);
    expect(f.plan).toEqual(defaultPlan());
    expect(f.devDate).toBe(old.date);
    expect(f.season.stats).toEqual(stats);
  });

  it("upgrades a version 1 export", async () => {
    const f = await importFranchise(exportFranchise(version1()), () => team);
    expect(f.plan).toEqual(defaultPlan());
  });

  it("a retired player's row is gone after a full commit and reload", async () => {
    const f = await createFranchiseSave(make(), team);
    const players = { ...f.players };
    const id = f.rosters[team.id][0];
    delete players[id];
    await commitFranchise({ ...f, players, rosters: { ...f.rosters, [team.id]: f.rosters[team.id].slice(1) } }, team);
    expect((await loadFranchise(f.id))!.players[id]).toBeUndefined();
  });

  /** A save as beta.6 wrote it: version 2, before the general manager's fields. */
  function beta6(f: Franchise) {
    const old = JSON.parse(JSON.stringify(f));
    for (const k of ["cap", "picks", "books", "freeAgents", "devRosters", "waivers", "draft", "talks", "retired", "history"]) delete old[k];
    for (const p of Object.values(old.players) as { file?: unknown }[]) delete p.file;
    return { ...old, version: 2 } as Franchise;
  }

  it("a beta.6 save opens with default books, picks, cap and a class, and keeps its stats", async () => {
    const f = make();
    const line = { ...emptyLine(), gp: 3, gs: 3, pts: 60 };
    const id = f.rosters[team.id][0];
    await createFranchiseSave(beta6({ ...f, season: { ...f.season, stats: { [id]: line } } }), team);
    const up = (await loadFranchise(f.id))!;
    expect(up.version).toBe(FRANCHISE_VERSION);
    expect(up.season.stats[id].pts).toBe(60);
    expect(up.cap).toEqual({ year: f.season.year, salaryCap: 140e6 });
    expect(up.picks).toHaveLength(240);
    expect(Object.keys(up.books)).toHaveLength(30);
    expect(up.freeAgents).toEqual([]);
    expect(up.draft.year).toBe(f.season.year + 1);
    expect(up.offseason).toBeUndefined();
  });

  it("a beta.6 save in the offseason opens at the review step", () => {
    const up = migrateFranchise({ ...beta6(make()), phase: "offseason" });
    expect(up.offseason).toEqual({ step: "review", report: null });
  });

  it("every player has a file after a partial commit and a reload", async () => {
    const f = make();
    await createFranchiseSave(beta6(f), team);
    const open = (await loadFranchise(f.id))!;
    const before = open.players[f.rosters[team.id][1]].file;
    await commitFranchise(open, team, [f.rosters[team.id][0]]);
    const again = (await loadFranchise(f.id))!;
    expect(Object.values(again.players).every((p) => p.file)).toBe(true);
    expect(again.players[f.rosters[team.id][1]].file).toEqual(before);
  });

  /** A save as beta.10 wrote it: version 3, before finances and history. */
  function beta10(f: Franchise) {
    const old = JSON.parse(JSON.stringify(f));
    for (const k of ["finance", "job", "news", "hall", "records", "powerLast", "aiTactics"]) delete old[k];
    delete old.settings.auto;
    delete old.settings.league;
    for (const p of Object.values(old.players) as { file: Record<string, unknown> }[]) delete p.file.career;
    return { ...old, version: 3 } as Franchise;
  }

  it("a beta.10 save opens with finance, a job and empty news, and keeps its stats", async () => {
    const f = make();
    const id = f.rosters[team.id][0];
    await createFranchiseSave(beta10({ ...f, season: { ...f.season, stats: { [id]: { ...emptyLine(), gp: 3, gs: 3, pts: 60 } } } }), team);
    const up = (await loadFranchise(f.id))!;
    expect(up.version).toBe(FRANCHISE_VERSION);
    expect(FRANCHISE_VERSION).toBe(5);
    expect(up.season.stats[id].pts).toBe(60);
    expect(Object.keys(up.finance)).toHaveLength(30);
    expect(up.finance[team.id]).toMatchObject({ hype: 50, facilities: 50, balance: 0 });
    expect(up.job.security).toBe(60);
    expect(up.job.stints).toEqual([{ teamId: team.id, league: "pro", from: f.season.year, w: 0, l: 0, titles: 0 }]);
    expect(up.news).toEqual([]);
    expect(up.settings.league.gamesPerSeason).toBe(82);
    expect(up.settings.auto.roster).toBe(true);
    expect(up.settings.auto.trades).toBe(false);
  });

  it("a beta.10 save in the offseason opens at its step", () => {
    const up = migrateFranchise({ ...beta10(make()), phase: "offseason", offseason: { step: "draft", report: null } });
    expect(up.offseason?.step).toBe("draft");
    expect(up.finance).toBeDefined();
  });

  it("every player keeps career totals after a partial commit and a reload", async () => {
    const f = make();
    const [a, b] = f.rosters[team.id];
    const career = { seasons: 1, gp: 10, min: 1, pts: 5, reb: 1, ast: 1, stl: 1, blk: 1, bestSeasonPts: 5 };
    const players = {
      ...f.players,
      [a]: { ...f.players[a], file: { ...f.players[a].file!, career } },
      [b]: { ...f.players[b], file: { ...f.players[b].file!, career } },
    };
    const open = await createFranchiseSave({ ...f, players }, team);
    await commitFranchise(open, team, [a]);
    const back = (await loadFranchise(f.id))!;
    expect(back.players[b].file?.career).toEqual(career);
    expect(back.players[a].file?.career).toEqual(career);
  });

  it("an export with three past seasons imports with all three", async () => {
    const f = make();
    const past = [2023, 2024, 2025].map((year) => ({ ...f.season, year, games: [] }));
    const text = exportFranchise(f, past);
    const copy = await importFranchise(text, () => team);
    const back = await pastSeasons(copy.id);
    expect(back.map((s) => s.year)).toEqual([2023, 2024, 2025]);
  });

  it("an old export with no past seasons still imports", async () => {
    const f = make();
    const copy = await importFranchise(exportFranchise(f), () => team);
    expect(await pastSeasons(copy.id)).toEqual([]);
  });

  it("a finished season's row keeps its stats and loses its games once the year turns", async () => {
    const f = await createFranchiseSave(make(), team);
    const year = f.season.year;
    const next = { ...f, history: [{ year, record: { w: 1, l: 0 }, awards: [] }], season: { ...f.season, year: year + 1 } };
    await commitFranchise(next, team);
    const [old] = await pastSeasons(f.id);
    expect(old.year).toBe(year);
    expect(old.games).toEqual([]);
  });

  it("gives an imported save a new id when the original exists", async () => {
    const f = await createFranchiseSave(make(), team);
    const copy = await importFranchise(exportFranchise(f), () => team);
    expect(copy.id).not.toBe(f.id);
    expect(await listFranchises()).toHaveLength(2);
    expect((await loadFranchise(copy.id))!.players).toEqual(f.players);
  });

  it("rejects bad files and writes nothing", async () => {
    await expect(importFranchise("not json", () => team)).rejects.toThrow("That file isn't a franchise save.");
    await expect(importFranchise(JSON.stringify({ kind: "other" }), () => team)).rejects.toThrow("That file isn't a franchise save.");
    expect(await listFranchises()).toHaveLength(0);
  });

  it("rejects a save file with no rosters and stores nothing", async () => {
    const f = make();
    const broken = JSON.stringify({ ...JSON.parse(exportFranchise(f)), franchise: { ...f, rosters: undefined } });
    await expect(importFranchise(broken, () => team)).rejects.toThrow("That file isn't a franchise save.");
    expect(await listFranchises()).toHaveLength(0);
  });

  it("rejects a save file for a team the game doesn't have", async () => {
    await expect(importFranchise(exportFranchise(make()), () => undefined)).rejects.toThrow("That file isn't a franchise save.");
    expect(await listFranchises()).toHaveLength(0);
  });

  it("keeps the last save readable when storage is full", async () => {
    const f = await createFranchiseSave(make(), team);
    const [a] = Object.keys(f.players);
    const spy = vi.spyOn(db.players, "bulkPut").mockRejectedValueOnce(new DOMException("full", "QuotaExceededError"));
    await expect(commitFranchise({ ...f, date: "2026-12-01", players: { ...f.players, [a]: { ...f.players[a], age: 50 } } }, team)).rejects.toThrow();
    spy.mockRestore();
    const loaded = (await loadFranchise(f.id))!;
    expect(loaded.revision).toBe(f.revision);
    expect(loaded.date).toBe(f.date);
  });
});
