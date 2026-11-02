import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays } from "@/career/calendar";
import type { Team } from "@/engine/types";
import { createFranchise } from "@/franchise/create";
import { createFranchiseSave, openFranchiseDb } from "@/franchise/storage";
import type { Franchise } from "@/franchise/types";
import { runFranchiseSim, stopFranchiseSim, useFranchiseSim } from "../franchiseSim";
import { useFranchise } from "../franchiseStore";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
let f: Franchise;

beforeEach(async () => {
  openFranchiseDb(`test-${Math.random()}`);
  useFranchise.getState().close();
  f = await createFranchiseSave(createFranchise({ league: "pro", team: teams[0], teams, seed: "sim", now: 1 }), teams[0]);
  await useFranchise.getState().open(f.id);
});

describe("hub sims", () => {
  it("reports done and picks up the saved days", async () => {
    expect(await runFranchiseSim({ until: addDays(f.date, 1), includeUser: true }, teams)).toBe("done");
    expect(useFranchise.getState().franchise!.date).toBe(addDays(f.date, 2));
    expect(useFranchiseSim.getState().running).toBe(false);
  });

  it("shows as running, wherever the hub is, until it ends", async () => {
    const run = runFranchiseSim({ until: addDays(f.date, 3), includeUser: true }, teams);
    expect(useFranchiseSim.getState().running).toBe(true);
    await run;
  });

  it("won't start a second sim on top of the first", async () => {
    const run = runFranchiseSim({ until: addDays(f.date, 3), includeUser: true }, teams);
    expect(await runFranchiseSim({ until: addDays(f.date, 3), includeUser: true }, teams)).toBe("busy");
    expect(await run).toBe("done");
  });

  it("reports stopped when stopped", async () => {
    const run = runFranchiseSim({ until: addDays(f.date, 30), includeUser: true }, teams);
    stopFranchiseSim();
    expect(await run).toBe("stopped");
  });
});
