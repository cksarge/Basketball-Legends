import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays } from "@/career/calendar";
import type { Team } from "@/engine/types";
import { createFranchise } from "../create";
import { startSim } from "../simClient";
import { createFranchiseSave, loadFranchise, openFranchiseDb } from "../storage";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const save = () => createFranchiseSave(createFranchise({ league: "pro", team: teams[0], teams, seed: "client", now: 1 }), teams[0]);

beforeEach(() => {
  openFranchiseDb(`test-${Math.random()}`);
});

describe("startSim without a worker", () => {
  it("falls back to this thread and finishes the range", async () => {
    expect(typeof Worker).toBe("undefined");
    const f = await save();
    const days: string[] = [];
    await startSim({ id: f.id, until: addDays(f.date, 2), includeUser: true }, teams, (d) => days.push(d)).done;
    expect(days).toHaveLength(3);
    expect((await loadFranchise(f.id))!.date).toBe(addDays(f.date, 3));
  });

  it("stops within a day of cancel and keeps the last finished day", async () => {
    const f = await save();
    const days: string[] = [];
    const handle = startSim({ id: f.id, until: addDays(f.date, 30), includeUser: true }, teams, (d) => {
      days.push(d);
      if (days.length === 2) handle.cancel();
    });
    await handle.done;
    expect(days).toHaveLength(2);
    expect((await loadFranchise(f.id))!.date).toBe(days[1]);
  });
});
