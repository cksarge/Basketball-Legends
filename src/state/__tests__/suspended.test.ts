import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Match } from "@/game/sim/match";
import type { PendingMatch } from "../matchStore";
import {
  clearSuspended,
  findCareerSave,
  findFranchiseSave,
  pruneFranchiseSaves,
  loadSuspended,
  pruneCareerSaves,
  resumePending,
  saveGroupOf,
  saveRows,
  saveSuspended,
  slotLabel,
  SLOTS,
  type SuspendedGame,
} from "../suspended";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

const team = (name: string, score: number) => ({ team: { name }, score });
const fakeMatch = (score = 10) =>
  ({
    state: { phase: "play", cfg: { rules: { periods: 4 } }, period: 2, clock: 90, teams: [team("Home", score), team("Away", 8)] },
    serialize: () => "match",
  }) as unknown as Match;
const quick = { mode: "quick" } as PendingMatch;
const park = { mode: "park" } as PendingMatch;
const career = (careerId: string, gameId: string) => ({ mode: "career", career: { careerId, gameId } }) as PendingMatch;
const franchise = (franchiseId: string, gameId: string) => ({ mode: "franchise", franchise: { franchiseId, gameId } }) as PendingMatch;

beforeEach(() => {
  store.clear();
  vi.useRealTimers();
});

describe("save groups", () => {
  it("gives Quick Play and the park one set, Career and Franchise their own", () => {
    expect(saveGroupOf(quick)).toBe("play");
    expect(saveGroupOf(park)).toBe("play");
    expect(saveGroupOf({ mode: "career" })).toBe("career");
    expect(saveGroupOf({ mode: "franchise" })).toBe("franchise");
  });

  it("makes nine separate slots that never overwrite each other", () => {
    for (const slot of SLOTS) {
      saveSuspended(fakeMatch(slot), quick, slot);
      saveSuspended(fakeMatch(slot + 10), career("c", "g"), slot);
      saveSuspended(fakeMatch(slot + 20), { mode: "franchise" } as PendingMatch, slot);
    }
    expect(store.size).toBe(9);
    expect(loadSuspended(1)?.summary.homeScore).toBe(1);
    expect(loadSuspended(1, "career")?.summary.homeScore).toBe(11);
    expect(loadSuspended(1, "franchise")?.summary.homeScore).toBe(21);
    clearSuspended(1, "career");
    expect(loadSuspended(1, "career")).toBeNull();
    expect(loadSuspended(1)).not.toBeNull();
    expect(loadSuspended(1, "franchise")).not.toBeNull();
  });

  it("keeps the original keys, so older Quick Play and park saves still load", () => {
    saveSuspended(fakeMatch(), park, 2);
    saveSuspended(fakeMatch(), quick);
    expect([...store.keys()].sort()).toEqual(["bl-save-2", "bl-suspended"]);
  });

  it("names slots for the save lists", () => {
    expect(slotLabel("auto", "play")).toBe("Autosave");
    expect(slotLabel(2, "play")).toBe("Slot 2");
    expect(slotLabel(2, "career")).toBe("Legend slot 2");
  });
});

describe("resuming", () => {
  it("resumes from the slot the game is in and keeps saving there", () => {
    saveSuspended(fakeMatch(), career("c", "g"), 3);
    const p = resumePending(3, loadSuspended(3, "career")!);
    expect(p).toMatchObject({ resume: true, resumeFrom: 3, saveSlot: 3 });
  });

  it("finds a franchise game in any Franchise slot, and only that game", () => {
    saveSuspended(fakeMatch(4), franchise("f", "g1"), 2);
    saveSuspended(fakeMatch(5), franchise("other", "g1"), 3);
    expect(findFranchiseSave("f", "g1")?.summary.homeScore).toBe(4);
    expect(findFranchiseSave("f", "g2")).toBeNull();
  });

  it("prunes only the franchise games that can't be played any more", () => {
    saveSuspended(fakeMatch(1), franchise("f", "old"), 1);
    saveSuspended(fakeMatch(2), franchise("f", "open"), 2);
    saveSuspended(fakeMatch(3), franchise("other", "old"), 3);
    pruneFranchiseSaves("f", (id) => id === "open");
    expect(loadSuspended(1, "franchise")).toBeNull();
    expect(loadSuspended(2, "franchise")).not.toBeNull();
    expect(loadSuspended(3, "franchise")).not.toBeNull();
  });

  it("finds a career game in any Career slot, and only that game", () => {
    saveSuspended(fakeMatch(), career("c", "g1"), 2);
    saveSuspended(fakeMatch(), career("other", "g1"), 3);
    expect(findCareerSave("c", "g1")?.pending.resumeFrom).toBe(2);
    expect(findCareerSave("c", "g2")).toBeNull();
    expect(findCareerSave("nope", "g1")).toBeNull();
  });

  it("finds a career game in the autosave", () => {
    saveSuspended(fakeMatch(), career("c", "g1"));
    expect(findCareerSave("c", "g1")?.pending.resumeFrom).toBe("auto");
  });

  it("uses the newest copy when a game is saved twice", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    saveSuspended(fakeMatch(10), career("c", "g1"), 1);
    vi.setSystemTime(2000);
    saveSuspended(fakeMatch(20), career("c", "g1"), 2);
    expect(findCareerSave("c", "g1")).toMatchObject({ pending: { resumeFrom: 2 }, summary: { homeScore: 20 } });
  });
});

describe("pruneCareerSaves", () => {
  it("drops only that career's games that can't be played anymore", () => {
    saveSuspended(fakeMatch(), career("c", "done"), 1);
    saveSuspended(fakeMatch(), career("c", "open"), 2);
    saveSuspended(fakeMatch(), career("other", "done"), 3);
    saveSuspended(fakeMatch(), quick, 1);
    pruneCareerSaves("c", (id) => id === "open");
    expect(loadSuspended(1, "career")).toBeNull();
    expect(loadSuspended(2, "career")).not.toBeNull();
    expect(loadSuspended(3, "career")).not.toBeNull();
    expect(loadSuspended(1)).not.toBeNull();
  });

  it("clears a career's autosave but leaves another mode's alone", () => {
    saveSuspended(fakeMatch(), quick);
    pruneCareerSaves("c", () => false);
    expect(loadSuspended()).not.toBeNull();
    saveSuspended(fakeMatch(), career("c", "g"));
    pruneCareerSaves("c", () => false);
    expect(loadSuspended()).toBeNull();
  });
});

describe("the Resume game list", () => {
  const game = { savedAt: 1 } as SuspendedGame;
  const names = (rows: ReturnType<typeof saveRows>) => rows.map((r) => `${r.group}-${r.slot}${r.game ? "*" : ""}`);

  it("lists three slots for each kind of game, Franchise included", () => {
    expect(names(saveRows([]))).toEqual(["play-1", "play-2", "play-3", "career-1", "career-2", "career-3", "franchise-1", "franchise-2", "franchise-3"]);
  });

  it("moves slots in use to the top, keeping the usual order within each part", () => {
    const rows = saveRows([
      { slot: 2, group: "franchise", game },
      { slot: 1, group: "career", game },
      { slot: 3, group: "career", game },
      { slot: 1, group: "play", game },
    ]);
    expect(names(rows)).toEqual(["play-1*", "career-1*", "career-3*", "franchise-2*", "play-2", "play-3", "career-2", "franchise-1", "franchise-3"]);
  });

  it("keeps the autosave first when there is one", () => {
    const rows = saveRows([
      { slot: 1, group: "franchise", game },
      { slot: "auto", group: "play", game },
    ]);
    expect(names(rows).slice(0, 2)).toEqual(["play-auto*", "franchise-1*"]);
  });
});
