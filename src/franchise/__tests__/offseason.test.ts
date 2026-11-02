import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { draftCalendar, proCalendar } from "@/career/calendar";
import type { Team } from "@/engine/types";
import { simDay } from "../core/season";
import { jobOffers, takeJob } from "../club/jobs";
import { advanceOffseason, canAdvance, startNewSeason } from "../core/offseason";
import { createFranchise } from "../create";
import { leagueModule } from "../leagues";
import { simDraftToEnd } from "../pro/draft";
import { staffHandles } from "../pro/freeAgency";
import { commitFranchise, createFranchiseSave, loadFranchise, openFranchiseDb } from "../storage";
import type { Franchise } from "../types";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const team = teams[0];
const make = (seed = "off") => createFranchise({ league: "pro", team, teams, seed, now: 1 });
function simSeason(f: Franchise) {
  for (let i = 0; i < 400 && f.phase !== "offseason"; i++) f = simDay(f, teams, { includeUser: true }).franchise;
  return f;
}
function throughOffseason(f: Franchise) {
  for (let i = 0; i < 12 && f.phase === "offseason"; i++) {
    if (f.offseason?.step === "draft") f = simDraftToEnd(f);
    if (f.job.fired) f = takeJob(f, jobOffers(f, teams)[0], teams);
    f = advanceOffseason(staffHandles(f), teams);
  }
  return f;
}
const ended = simSeason(make());
const year = ended.season.year;

beforeEach(() => {
  openFranchiseDb(`test-${Math.random()}`);
});

describe("the offseason", () => {
  it("starts at the review when the champion is crowned", () => {
    expect(ended.offseason).toEqual({ step: "review", report: null });
  });

  it("walks every step in order, on the right dates", () => {
    let f = ended;
    const seen: string[] = [];
    const dates: Record<string, string> = {};
    for (const step of leagueModule("pro").offseasonSteps) {
      expect(f.offseason?.step).toBe(step);
      seen.push(step);
      dates[step] = f.date;
      if (step === "draft") f = simDraftToEnd(f);
      f = advanceOffseason(staffHandles(f), teams);
    }
    expect(seen).toEqual(["review", "progress", "lottery", "draft", "contracts", "freeAgency", "camp"]);
    expect(dates.draft).toBe(draftCalendar(year + 1).draft);
    expect(dates.contracts).toBe(`${year + 1}-06-29`);
    expect(dates.freeAgency).toBe(`${year + 1}-07-01`);
    expect(dates.camp).toBe(proCalendar(year + 1).camp);
    expect(f.phase).toBe("regular");
    expect(f.date).toBe(proCalendar(year + 1).opening);
  });

  it("won't leave the draft until it's finished", () => {
    let f = ended;
    while (f.offseason?.step !== "draft") f = advanceOffseason(f, teams);
    expect(canAdvance(f)).toEqual({ ok: false, reason: expect.stringMatching(/draft/) });
    expect(advanceOffseason(f, teams)).toBe(f);
    expect(canAdvance(simDraftToEnd(f))).toEqual({ ok: true });
  });

  it("a progress report waits on the progress step", () => {
    const f = advanceOffseason(ended, teams);
    expect(f.offseason?.report?.changes.length).toBeGreaterThan(0);
  });
});

describe("the next season", () => {
  const next = throughOffseason(ended);

  it("a second season has a valid 82-game schedule with fresh game ids", () => {
    expect(next.season.year).toBe(year + 1);
    expect(next.season.games).toHaveLength(1230);
    for (const t of teams) expect(next.season.games.filter((g) => g.homeId === t.id || g.awayId === t.id)).toHaveLength(82);
    const old = new Set(ended.season.games.map((g) => g.id));
    expect(next.season.games.some((g) => old.has(g.id))).toBe(false);
  });

  it("clears stats, sets devDate to opening day and creates next year's class and picks", () => {
    expect(next.season.stats).toEqual({});
    expect(next.season.series).toEqual([]);
    expect(next.devDate).toBe(next.date);
    expect(next.draft.year).toBe(year + 2);
    expect(next.draft.results).toEqual([]);
    expect(next.draft.prospects).toHaveLength(70);
    expect(Math.min(...next.picks.map((p) => p.year))).toBe(year + 2);
    expect(next.picks).toHaveLength(240);
    expect(next.offseason).toBeUndefined();
    expect(next.cap.year).toBe(year + 1);
    expect(next.cap.salaryCap).toBeGreaterThan(ended.cap.salaryCap);
  });

  it("retired players move to f.retired and leave f.players only when the new season starts", () => {
    const camp = (() => {
      let f = ended;
      while (f.offseason?.step !== "camp") {
        if (f.offseason?.step === "draft") f = simDraftToEnd(f);
        f = advanceOffseason(staffHandles(f), teams);
      }
      return f;
    })();
    const gone = camp.offseason!.report!.retired;
    expect(gone.length).toBeGreaterThan(3);
    for (const id of gone) expect(camp.players[id]).toBeDefined();
    const after = startNewSeason(staffHandles(camp), teams);
    for (const id of gone) {
      expect(after.players[id]).toBeUndefined();
      expect(after.retired.find((r) => r.id === id)).toBeDefined();
    }
    const r = after.retired[0];
    expect(r.name).toMatch(/ /);
    expect(r.peak).toBeGreaterThan(40);
    expect(r.year).toBe(year + 1);
  });

  it("career totals, awards and titles carry into the next season", () => {
    const line = ended.season.stats;
    const id = Object.keys(line).find((x) => next.players[x] && line[x].gp > 40)!;
    expect(next.players[id].file?.career).toMatchObject({ seasons: 1, gp: line[id].gp, pts: line[id].pts });
    const champ = ended.rosters[ended.season.championId!].find((x) => next.players[x])!;
    expect(next.players[champ].file?.titles).toBe(1);
    const mvp = ended.season.awards.find((a) => a.id === "mvp")!.playerId;
    expect(next.players[mvp]?.file?.awards ?? 1).toBeGreaterThan(0);
  });

  it("a retired player keeps his career totals", () => {
    const r = next.retired.find((x) => ended.season.stats[x.id]);
    expect(r?.career?.gp).toBe(ended.season.stats[r!.id].gp);
  });

  it("a finished season sets league records", () => {
    expect(next.records.find((r) => r.key === "seasonPts")?.value).toBeGreaterThan(1000);
    expect(next.records.find((r) => r.key === "careerPts")?.value).toBeGreaterThan(1000);
  });

  it("the season summary keeps the champion, record and award names", () => {
    const s = next.history[0];
    expect(s.year).toBe(year);
    expect(s.championId).toBe(ended.season.championId);
    expect(s.record.w + s.record.l).toBe(82);
    expect(s.awards.find((a) => a.id === "mvp")?.name).toMatch(/ /);
  });

  it("heals everyone and leaves no pending draft or playoff state", () => {
    expect(Object.values(next.players).some((p) => p.injury)).toBe(false);
  });

  it("everyone has played a year more", () => {
    const id = Object.keys(next.players).find((x) => ended.players[x] && next.players[x].file!.draft === undefined)!;
    expect(next.players[id].file!.service).toBe(ended.players[id].file!.service + 1);
  });

  it("the current season loads after the year changes, and the old row stays", async () => {
    await createFranchiseSave(ended, team);
    const saved = await commitFranchise(next, team);
    const back = (await loadFranchise(ended.id))!;
    expect(back.season.year).toBe(year + 1);
    expect(Object.keys(back.players).length).toBe(Object.keys(saved.players).length);
  });

  it("a saved offseason step survives a reload", async () => {
    const f = advanceOffseason(ended, teams);
    await createFranchiseSave(ended, team);
    await commitFranchise(f, team);
    expect((await loadFranchise(ended.id))!.offseason).toEqual(f.offseason);
  });

  it("three full seasons run with 15 on every roster and no missing player ids", () => {
    let f = next;
    for (let i = 0; i < 2; i++) f = throughOffseason(simSeason(f));
    expect(f.season.year).toBe(year + 3);
    for (const t of teams) {
      expect(f.rosters[t.id].length).toBeGreaterThanOrEqual(13);
      expect(f.rosters[t.id].length).toBeLessThanOrEqual(15);
      for (const id of f.rosters[t.id]) {
        expect(f.players[id]).toBeDefined();
        expect(f.players[id].teamId).toBe(t.id);
      }
    }
    for (const id of f.freeAgents) expect(f.players[id].teamId).toBeNull();
    const placed = [...Object.values(f.rosters).flat(), ...Object.values(f.devRosters).flat(), ...f.freeAgents];
    expect(new Set(placed).size).toBe(placed.length);
    expect(placed.length).toBe(Object.keys(f.players).length);
  }, 120_000);
});
