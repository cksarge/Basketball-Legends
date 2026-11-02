import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Team } from "@/engine/types";
import { createFranchise } from "@/franchise/create";
import { commitFranchise, createFranchiseSave, openFranchiseDb, type FranchiseDb } from "@/franchise/storage";
import { useFranchise } from "../franchiseStore";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const start = async () => {
  const f = await createFranchiseSave(createFranchise({ league: "pro", team: teams[0], teams, seed: "s", now: 5 }), teams[0]);
  await useFranchise.getState().open(f.id);
  return f;
};

let db: FranchiseDb;
beforeEach(() => {
  db = openFranchiseDb(`test-${Math.random()}`);
  useFranchise.getState().close();
});

describe("franchise store", () => {
  it("opens a save and finds its team", async () => {
    await start();
    expect(useFranchise.getState().status).toBe("ready");
    expect(useFranchise.getState().team?.id).toBe(teams[0].id);
  });

  it("reports a missing save", async () => {
    await useFranchise.getState().open("nope");
    expect(useFranchise.getState().status).toBe("missing");
  });

  it("applies and saves a change", async () => {
    await start();
    expect(await useFranchise.getState().update((f) => ({ ...f, date: "2026-12-25" }))).toBe(true);
    expect(useFranchise.getState().franchise?.date).toBe("2026-12-25");
    expect(useFranchise.getState().franchise?.revision).toBe(1);
  });

  it("goes stale instead of overwriting changes from another tab", async () => {
    const f = await start();
    await commitFranchise({ ...f, date: "2027-01-01" }, teams[0]);
    expect(await useFranchise.getState().update((x) => ({ ...x, date: "2027-02-02" }))).toBe(false);
    expect(useFranchise.getState().status).toBe("stale");
  });

  it("says so when a save fails, instead of claiming it worked", async () => {
    await start();
    const spy = vi.spyOn(db.saves, "put").mockRejectedValueOnce(new DOMException("full", "QuotaExceededError"));
    expect(await useFranchise.getState().update((x) => ({ ...x, date: "2027-02-02" }))).toBe(false);
    spy.mockRestore();
    expect(useFranchise.getState().status).toBe("error");
    expect(useFranchise.getState().error).toBe("Couldn't save. Your last change isn't stored.");
  });
});
