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
