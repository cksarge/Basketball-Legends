import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Team } from "@/engine/types";
import { nextFranchiseEvent } from "@/franchise/core/season";
import { createFranchise } from "@/franchise/create";
import { createFranchiseSave, loadFranchise, openFranchiseDb, type FranchiseDb } from "@/franchise/storage";
import type { Franchise } from "@/franchise/types";
import { emptyLine } from "@/game/sim/stats";
import { applyFranchiseResult, loadFranchiseResult, storeFranchiseResult } from "../franchiseResult";
import { useFranchise } from "../franchiseStore";
import { useMatchStore, type MatchResult } from "../matchStore";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

const gameOf = (f: Franchise) => {
  const ev = nextFranchiseEvent(f);
  if (ev.kind !== "game") throw new Error("no game");
  return ev.game;
};
function result(f: Franchise): MatchResult {
  const g = gameOf(f);
  const id = f.rosters[f.teamId][0];
  return {
    mode: "franchise",
    homeId: g.homeId,
    awayId: g.awayId,
    homeScore: 50,
    awayScore: 40,
    box: { [id]: { ...emptyLine(), min: 720, pts: 10 } },
    periods: 4,
    playByPlay: [{ t: 1 }] as unknown as MatchResult["playByPlay"],
    playerOfGame: id,
    quarterMinutes: 6,
    simulated: false,
    injuries: [],
    franchise: { franchiseId: f.id, gameId: g.id },
  };
}

let db: FranchiseDb;
let f: Franchise;
beforeEach(async () => {
  mem.clear();
  db = openFranchiseDb(`test-${Math.random()}`);
  useFranchise.getState().close();
  useMatchStore.setState({ pending: null, lastResult: null });
  f = await createFranchiseSave(createFranchise({ league: "pro", team: teams[0], teams, seed: "res", now: 1 }), teams[0]);
  await useFranchise.getState().open(f.id);
});

describe("a finished franchise game", () => {
  it("survives losing the page: the stored copy still records it", async () => {
    storeFranchiseResult(result(f));
    expect(useMatchStore.getState().lastResult).toBeNull();
    expect(await applyFranchiseResult(f, teams)).toBe("applied");
    expect((await loadFranchise(f.id))!.season.games.find((g) => g.id === gameOf(f).id)!.result).toMatchObject({ home: 50, played: true });
    expect(loadFranchiseResult(f.id)).toBeNull();
  });

  it("leaves the play-by-play out of the stored copy", () => {
    storeFranchiseResult(result(f));
    expect(loadFranchiseResult(f.id)!.playByPlay).toEqual([]);
  });

  it("uses the in-memory result when storage was blocked", async () => {
    useMatchStore.getState().setResult(result(f));
    expect(await applyFranchiseResult(f, teams)).toBe("applied");
    expect(useMatchStore.getState().lastResult).toBeNull();
  });

  it("keeps the result when the save fails, so it can be tried again", async () => {
    storeFranchiseResult(result(f));
    const spy = vi.spyOn(db.saves, "put").mockRejectedValueOnce(new DOMException("full", "QuotaExceededError"));
    expect(await applyFranchiseResult(f, teams)).toBe("failed");
    spy.mockRestore();
    expect(loadFranchiseResult(f.id)).not.toBeNull();
    await useFranchise.getState().open(f.id);
    expect(await applyFranchiseResult(f, teams)).toBe("applied");
  });

  it("says when the game was already decided, and drops the result", async () => {
    const r = result(f);
    storeFranchiseResult(r);
    await applyFranchiseResult(f, teams);
    storeFranchiseResult(r);
    await useFranchise.getState().open(f.id);
    expect(await applyFranchiseResult(useFranchise.getState().franchise!, teams)).toBe("unused");
    expect(loadFranchiseResult(f.id)).toBeNull();
  });

  it("clears the match so going back can't replay it", async () => {
    useMatchStore.setState({ pending: { mode: "franchise" } as never });
    storeFranchiseResult(result(f));
    await applyFranchiseResult(f, teams);
    expect(useMatchStore.getState().pending).toBeNull();
  });

  it("leaves another franchise's result alone", async () => {
    storeFranchiseResult({ ...result(f), franchise: { franchiseId: "other", gameId: "g" } });
    expect(await applyFranchiseResult(f, teams)).toBe("none");
    expect(loadFranchiseResult("other")).not.toBeNull();
  });
});
