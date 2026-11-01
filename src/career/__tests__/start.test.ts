import { describe, expect, it } from "vitest";
import { archetypesFor, playerOvr, randomAppearance } from "@/engine/player";
import { Rng } from "@/engine/rng";
import type { Team } from "@/engine/types";
import hs from "@/data/generated/hs.json";
import college from "@/data/generated/college.json";
import pro from "@/data/generated/pro.json";
import { DEFAULT_SETTINGS, MAX_PLAY_STYLES, PLAY_STYLES, applyBonuses, computeCaps, createCareer, defaultBody } from "../create";
import { currentCollege, nextCollegeEvent } from "../college/season";
import { hsContext, nextEvent } from "../hs/season";
import { draftStep } from "../pro/draft";
import { currentPro, nextProEvent, trainingCamp } from "../pro/season";
import { START_OVR, applyStart, grownRatings } from "../start";
import { rivalLegacy, storyTick } from "../story/engine";
import { legendStatus } from "../legend";
import { trackHistory } from "../timeline";
import type { CreatorInput } from "../types";

const colleges = college.teams as unknown as Team[];
const pros = pro.teams as unknown as Team[];
const ctx = hsContext(hs.teams as unknown as Team[], colleges, college.conferences, pros);
const input = (extra: Partial<CreatorInput> = {}): CreatorInput => ({
  firstName: "Test",
  lastName: "Start",
  pos: "SG",
  archetype: archetypesFor("SG")[0],
  body: defaultBody("SG"),
  appearance: randomAppearance(new Rng(3)),
  jersey: 4,
  hometown: "Phoenix, AZ",
  schoolId: "hs-brophy-prep",
  allocation: {},
  settings: DEFAULT_SETTINGS,
  startYear: 2026,
  ...extra,
});
const base = (extra?: Partial<CreatorInput>) => createCareer(input(extra), 777);
const d1 = colleges.find((t) => t.tier === "D1")!;

describe("where you start", () => {
  it("defaults to high school, untouched", () => {
    const c = base();
    expect(applyStart(c, "hs", {}, ctx)).toBe(c);
    expect(nextEvent(c).kind).toBe("season");
  });

  it("grows your own player to the level, keeping your skills and limits", () => {
    const c = base();
    const r = grownRatings(c, START_OVR.pro);
    const p = { ...c.player, ratings: r };
    expect(Math.abs(playerOvr(p) - START_OVR.pro)).toBeLessThanOrEqual(1);
    for (const k of Object.keys(r) as (keyof typeof r)[]) expect(r[k]).toBeLessThanOrEqual(Math.max(c.player.caps[k], c.player.ratings[k]));
  });

  it("starts in college as a freshman at your program, with a full season ahead", () => {
    const c = applyStart(base(), "college", { collegeId: d1.id }, ctx);
    expect(c.stage).toBe("college");
    expect(c.player.teamId).toBe(d1.id);
    expect(c.player.age).toBe(18);
    expect(currentCollege(c)!.classYear).toBe("FR");
    expect(nextCollegeEvent(c).kind).toBe("game");
    expect(c.log[0].text).toContain(d1.name);
    expect(c.inbox.length).toBeGreaterThan(0);
  });

  it("can walk on", () => {
    expect(currentCollege(applyStart(base(), "college", { collegeId: d1.id, walkOn: true }, ctx))!.walkOn).toBe(true);
  });

  it("doesn't leap the player years ahead on the first update", () => {
    const c = applyStart(base(), "college", { collegeId: d1.id }, ctx);
    expect(Math.abs(playerOvr(c.player) - START_OVR.college)).toBeLessThanOrEqual(3);
  });

  it("starts in the pros through the draft", () => {
    const c = applyStart(base(), "pro", { proTeamId: null }, ctx);
    expect(c.stage).toBe("pro");
    expect(draftStep(c)).toBe("agent");
    expect(c.player.teamId).toBeNull();
  });

  it("starts in the pros on the team you picked, ready for camp", () => {
    const c = applyStart(base(), "pro", { proTeamId: pros[4].id }, ctx);
    expect(draftStep(c)).toBe("drafted");
    expect(nextProEvent(c).kind).toBe("training");
    const season = trainingCamp(c, "shooting", ctx);
    expect(currentPro(season)!.teamId).toBe(pros[4].id);
    expect(season.player.age).toBe(21);
    expect(nextProEvent(season).kind).toBe("game");
  });

  it("the story begins wherever you do, with your rival at your level", () => {
    const college_ = storyTick(applyStart(base(), "college", { collegeId: d1.id }, ctx), ctx);
    expect(colleges.some((t) => t.id === college_.story!.rival.teamId)).toBe(true);
    const pro_ = storyTick(applyStart(base(), "pro", { proTeamId: pros[1].id }, ctx), ctx);
    expect(pros.some((t) => t.id === pro_.story!.rival.teamId)).toBe(true);
  });
});

describe("play style badges", () => {
  it("lift their skills and caps, at most two", () => {
    const c = base();
    const caps = computeCaps("SG", c.player.archetype, c.player.body);
    const r = applyBonuses(c.player.ratings, caps, ["sharpshooter", "lockdown", "slasher"], false);
    expect(r.names).toEqual(["Sharpshooter", "Slasher"].length === MAX_PLAY_STYLES ? r.names : []);
    expect(r.names.length).toBe(MAX_PLAY_STYLES);
    expect(r.caps.three).toBeGreaterThanOrEqual(caps.three);
    expect(PLAY_STYLES.length).toBeGreaterThanOrEqual(6);
  });

  it("show up on your player", () => {
    const c = base({ playStyles: ["sharpshooter"] });
    expect(c.player.badges).toEqual(["Sharpshooter"]);
    expect(c.player.ratings.three).toBeGreaterThan(base().player.ratings.three);
  });
});

describe("a Legend's kid", () => {
  it("gets a head start and their parent as a mentor", () => {
    const legacy = { careerId: "x", name: "Old Great" };
    const c = base({ legacy });
    expect(c.legacy).toEqual(legacy);
    expect(c.player.ratings.speed).toBeGreaterThan(base().player.ratings.speed);
    const told = storyTick(c, ctx);
    expect(told.story!.mentor).toBe("Old Great");
    expect(told.story!.threads["Old Great"][0].text).toContain("name on your back");
  });
});

describe("your peak", () => {
  it("is remembered after you decline", () => {
    let c = trackHistory({ ...base(), date: "2030-01-01" });
    const best = { ...c, player: { ...c.player, ratings: grownRatings(c, 80) } };
    c = trackHistory(best);
    const peak = c.peak!.ovr;
    expect(peak).toBeGreaterThan(70);
    const old = trackHistory({ ...c, date: "2040-01-01", player: { ...c.player, ratings: base().player.ratings } });
    expect(old.peak!.ovr).toBe(peak);
  });
});

describe("your rival's legacy", () => {
  it("grows through their career and only ever counts as real as yours", () => {
    const c = storyTick(base(), ctx);
    const early = rivalLegacy(c).points;
    const later = rivalLegacy({ ...c, stage: "pro", date: "2045-07-01" });
    expect(later.points).toBeGreaterThan(early);
    expect(later.rank).not.toBe("Legend");
    expect(legendStatus(c).points).toBe(0);
  });
});
