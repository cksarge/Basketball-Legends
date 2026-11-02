import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import type { Team } from "@/engine/types";
import { jobOffers, reputation, takeJob } from "../club/jobs";
import { applyMove } from "../core/moves";
import { simDay } from "../core/season";
import { createFranchise } from "../create";
import { releasePlayer } from "../pro/rosterMoves";
import { commitFranchise, createFranchiseSave, listFranchises, loadFranchise, openFranchiseDb } from "../storage";
import type { Franchise, JobStint } from "../types";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const team = teams[0];
const make = () => createFranchise({ league: "pro", team, teams, seed: "jobs", now: 1 });
const stint = (w: number, l: number, titles = 0): JobStint => ({ teamId: team.id, league: "pro", from: 2026, w, l, titles });
const fired = (f: Franchise, stints = [stint(100, 200)]): Franchise => ({
  ...f,
  phase: "offseason",
  offseason: { step: "review", report: null },
  job: { ...f.job, stints, security: 0, seasons: 4, fired: { year: 2030, teamId: f.teamId } },
});
const strength = (id: string) => teams.find((t) => t.id === id)!.prestige;

beforeEach(() => {
  openFranchiseDb(`test-${Math.random()}`);
});

describe("offers", () => {
  it("offers depend on the record: weak teams for a poor coach, better ones for a strong record", () => {
    const f = make();
    const best = (s: JobStint[]) => Math.max(...jobOffers(fired(f, s), teams).map(strength));
    expect(best([stint(500, 320, 3)])).toBeGreaterThan(best([stint(100, 310)]));
    expect(reputation(fired(f, [stint(500, 320, 3)]))).toBeGreaterThan(reputation(fired(f, [stint(100, 310)])));
  });

  it("there's always at least one offer", () => {
    expect(jobOffers(fired(make(), [stint(0, 500)]), teams).length).toBeGreaterThan(0);
  });

  it("offers never include the team that fired you", () => {
    const f = fired(make());
    expect(jobOffers(f, teams)).not.toContain(f.teamId);
    expect(jobOffers(fired(make(), [stint(800, 100, 5)]), teams)).not.toContain(team.id);
  });
});

describe("taking a job", () => {
  const offerOf = (f: Franchise) => jobOffers(f, teams)[0];

  it("a firing keeps the coaching record and the save", () => {
    const f = fired(make());
    const next = takeJob(f, offerOf(f), teams);
    expect(next.id).toBe(f.id);
    expect(next.job.stints[0]).toMatchObject({ w: 100, l: 200, to: f.season.year });
    expect(next.job.stints[1]).toMatchObject({ teamId: offerOf(f), from: f.season.year + 1 });
    expect(next.job.fired).toBeUndefined();
    expect(next.job.security).toBe(60);
    expect(next.job.seasons).toBe(0);
  });

  it("taking a job moves the user, resets the plan and clears bids, offers, block, undo and scouting choices", () => {
    let f = fired(make());
    const offer = offerOf(f);
    f = applyMove({ ...f, phase: "regular" }, "One", (x) => releasePlayer(x, x.rosters[team.id][14]));
    f = {
      ...f,
      phase: "offseason",
      tradeBlock: [f.rosters[team.id][0]],
      tradeOffers: [{ id: "o", trade: { teams: [], assets: [] }, date: f.date }],
      draft: { ...f.draft, assigned: [f.draft.prospects[0].id] },
      freeAgency: { stage: "bidding", round: 1, bids: [{ playerId: "x", teamId: team.id, salary: 1, years: 1 }], signed: [], notices: ["old"] },
      plan: { ...f.plan, autoRotation: false, starters: f.rosters[team.id].slice(0, 5) },
    };
    const next = takeJob(f, offer, teams);
    expect(next.teamId).toBe(offer);
    expect(next.plan.autoRotation).toBe(true);
    expect(next.plan.starters).toEqual([]);
    expect(next.undo).toBeUndefined();
    expect(next.tradeBlock).toEqual([]);
    expect(next.tradeOffers).toEqual([]);
    expect(next.draft.assigned).toEqual([]);
    expect(next.freeAgency?.bids).toEqual([]);
    expect(next.freeAgency?.notices).toEqual([]);
  });

  it("the old team runs on AI and stays legal", () => {
    const f = takeJob(fired(make()), offerOf(fired(make())), teams);
    const season: Franchise = { ...f, phase: "regular" };
    expect(simDay(season, teams, { includeUser: true }).blocked).toBe(false);
    expect(season.rosters[team.id].length).toBeGreaterThanOrEqual(13);
  });

  it("a live game for the old team is dropped", () => {
    const f = { ...fired(make()), live: { gameId: "x", partial: { home: 1, away: 1, box: {}, seconds: 0 } } };
    expect(takeJob(f, offerOf(f), teams).live).toBeUndefined();
  });

  it("only a real offer can be taken", () => {
    const f = fired(make());
    expect(takeJob(f, team.id, teams)).toBe(f);
    expect(takeJob(make(), offerOf(f), teams).teamId).toBe(team.id);
  });

  it("the save summary shows the new team after a reload", async () => {
    const f = await createFranchiseSave(fired(make()), team);
    const offer = offerOf(f);
    const next = teams.find((t) => t.id === offer)!;
    await commitFranchise(takeJob(f, offer, teams), next);
    expect((await loadFranchise(f.id))!.teamId).toBe(offer);
    expect((await listFranchises())[0]).toMatchObject({ teamId: offer, teamName: `${next.name} ${next.nickname}` });
  });
});
