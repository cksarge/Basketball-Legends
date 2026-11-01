import { describe, expect, it } from "vitest";
import { archetypesFor, randomAppearance } from "@/engine/player";
import { Rng } from "@/engine/rng";
import type { Team } from "@/engine/types";
import hs from "@/data/generated/hs.json";
import college from "@/data/generated/college.json";
import pro from "@/data/generated/pro.json";
import { DEFAULT_SETTINGS, createCareer, defaultBody } from "../create";
import { hsContext, startSeason } from "../hs/season";
import { legendEvents, legendPoints } from "../legend";
import {
  DROP_IN_CHANCE,
  PARK_LADDER,
  RUNS_PER_WINDOW,
  calloutOpen,
  declineCallout,
  finishRun,
  nextUnlock,
  repName,
  rivalPlayer,
  runWindow,
  runsLeft,
  simRun,
  startRun,
  streetOf,
  unlockedParks,
} from "../park";
import { storyTick } from "../story/engine";
import type { Career, ActiveRun } from "../types";

const pros = pro.teams as unknown as Team[];
const ctx = hsContext(hs.teams as unknown as Team[], college.teams as unknown as Team[], college.conferences, pros);

function base(seed = 777, freq: Career["settings"]["storyFrequency"] = "normal"): Career {
  return createCareer(
    {
      firstName: "Test",
      lastName: "Hooper",
      pos: "SG",
      archetype: archetypesFor("SG")[0],
      body: defaultBody("SG"),
      appearance: randomAppearance(new Rng(3)),
      jersey: 4,
      hometown: "Phoenix, AZ",
      schoolId: "hs-brophy-prep",
      allocation: {},
      settings: { ...DEFAULT_SETTINGS, storyFrequency: freq },
      startYear: 2026,
    },
    seed,
  );
}
const withRun = (c: Career, run: Partial<ActiveRun> = {}, rep = 0): Career => ({
  ...c,
  street: { ...streetOf(c), rep, active: { parkId: "copper-flats", kind: "pickup", oppIds: ["park-copper-flats-1"], ...run } },
});

describe("when you can get to the park", () => {
  it("is open the summer before freshman year", () => {
    expect(runWindow(base())).toBe("hs-summer");
    expect(runWindow(startSeason(base(), 2026, ctx))).toBe("hs-pre-2026");
  });

  it("closes in season and opens again when the season ends", () => {
    const c = startSeason(base(), 2026, ctx);
    const s = c.hs.seasons[0];
    const playing = { ...c, hs: { ...c.hs, seasons: [{ ...s, tryout: { date: "x", score: 50, level: "jv" as const, note: "" } }] } };
    expect(runWindow(playing)).toBeNull();
    expect(runsLeft(playing)).toBe(0);
    const done = { ...playing, hs: { ...playing.hs, seasons: [{ ...playing.hs.seasons[0], wrapped: true }] } };
    expect(runWindow(done)).toBe("hs-2026");
  });

  it("is always open once you've retired", () => {
    const c = { ...base(), stage: "retired" as const };
    expect(runWindow(c)).toBe("retired");
    expect(runsLeft(c)).toBe(Infinity);
  });

  it("gives you three runs each off-season, then fresh ones the next", () => {
    let c = base();
    expect(runsLeft(c)).toBe(RUNS_PER_WINDOW);
    for (let i = 0; i < RUNS_PER_WINDOW; i++) c = simRun(c, "copper-flats", 3, "pickup", ctx);
    expect(runsLeft(c)).toBe(0);
    expect(startRun(c, "copper-flats", 3, "pickup", ctx, "keyboard")).toBeNull();
    const later = startSeason(c, 2026, ctx);
    expect(runsLeft(later)).toBe(RUNS_PER_WINDOW);
  });
});

describe("street reputation", () => {
  it("wins are worth more than losses, played games more than simmed ones, and tougher parks more", () => {
    const rep = (won: boolean, played: boolean, parkId = "copper-flats") => streetOf(finishRun(withRun(base(), { parkId }), won, played)).rep;
    expect(rep(true, true)).toBeGreaterThan(rep(false, true));
    expect(rep(true, true)).toBeGreaterThan(rep(true, false));
    expect(rep(true, true, "rooftop-ninth")).toBeGreaterThan(rep(true, true));
  });

  it("opens parks as your name grows, one step at a time", () => {
    expect(unlockedParks(0)).toEqual(["copper-flats", "maple-street"]);
    expect(unlockedParks(25)).toContain("boardwalk");
    expect(unlockedParks(109)).not.toContain("rooftop-ninth");
    expect(unlockedParks(110).length).toBe(PARK_LADDER.length);
    expect(nextUnlock(0)?.parkId).toBe("boardwalk");
    expect(nextUnlock(999)).toBeNull();
    expect(repName(0)).toBe("New face");
    expect(repName(120)).toBe("Street legend");
  });

  it("won't let you into a park you haven't earned", () => {
    expect(startRun(base(), "rooftop-ninth", 3, "pickup", ctx, "keyboard")).toBeNull();
  });

  it("announces a new park in the log, and the story picks it up", () => {
    const c = storyTick(base(), ctx);
    const after = finishRun({ ...withRun(c, {}, 22) }, true, true);
    expect(after.log.at(-1)!.text).toMatch(/^Earned a run at /);
    const told = storyTick(after, ctx);
    expect(told.story!.feed.length).toBeGreaterThan(0);
    expect(told.story!.threads[told.story!.mentor].length).toBeGreaterThan(2);
  });

  it("gives XP for runs", () => {
    const c = finishRun(withRun(base()), true, true);
    expect(c.player.xp + c.player.skillPoints * 60).toBeGreaterThan(base().player.xp + base().player.skillPoints * 60);
  });

  it("remembers your record against each regular", () => {
    let c = finishRun(withRun(base()), true, true);
    c = finishRun(withRun(c), false, true);
    expect(streetOf(c).regulars["park-copper-flats-1"]).toEqual({ w: 1, l: 1 });
    expect(streetOf(c).wins).toBe(1);
    expect(streetOf(c).losses).toBe(1);
  });

  it("does nothing without a run in progress", () => {
    const c = base();
    expect(finishRun(c, true, true)).toBe(c);
  });

  it("is the top of the ladder that counts for your legacy, once", () => {
    const c = finishRun(withRun(base(), {}, PARK_LADDER.at(-1)!.rep - 1), true, true);
    expect(legendPoints(legendEvents(c)).pillars.impact).toBe(10);
    const again = finishRun(withRun(c, {}, PARK_LADDER.at(-1)!.rep + 5), true, true);
    expect(legendPoints(legendEvents(again)).pillars.impact).toBe(10);
  });
});

describe("a real run", () => {
  it("builds a park game with you locked in and the regulars around you", () => {
    const c = base();
    const r = startRun(c, "copper-flats", 3, "pickup", ctx, "keyboard")!;
    expect(r.pending.mode).toBe("park");
    expect(r.pending.lockPlayerId).toBe(c.player.id);
    expect(r.pending.home.roster.length).toBe(3);
    expect(r.pending.away.roster.length).toBe(3);
    expect(r.pending.home.roster[0].id).toBe(c.player.id);
    expect(r.pending.careerRun).toBe(c.id);
    expect(r.pending.returnTo).toContain("/career/hub/");
    expect(r.career.street!.active?.parkId).toBe("copper-flats");
  });

  it("sometimes has a known pro waiting in the other crew", () => {
    let seen = 0;
    const runs = 200;
    for (let seed = 1; seed <= runs; seed++) {
      const r = startRun(base(seed), "copper-flats", 3, "pickup", ctx, "keyboard")!;
      if (r.career.street!.active?.dropIn) {
        seen++;
        expect(r.pending.away.roster.map((p) => `${p.firstName} ${p.lastName}`)).toContain(r.career.street!.active!.dropIn);
      }
    }
    expect(seen / runs).toBeGreaterThan(DROP_IN_CHANCE * 0.5);
    expect(seen / runs).toBeLessThan(DROP_IN_CHANCE * 1.6);
  });

  it("beating a pro earns extra reputation and a Moment, but only if you played it", () => {
    const run = { dropIn: "Star Player" };
    const played = finishRun(withRun(base(), run), true, true);
    const plain = finishRun(withRun(base()), true, true);
    const simmed = finishRun(withRun(base(), run), true, false);
    expect(streetOf(played).rep).toBeGreaterThan(streetOf(plain).rep);
    expect(legendPoints(legendEvents(played)).pillars.moments).toBe(3);
    expect(legendPoints(legendEvents(simmed)).pillars.moments).toBe(0);
    expect(played.log.at(-1)!.text).toContain("Star Player");
  });
});

describe("your rival calls you out", () => {
  const open = () => {
    for (let seed = 1; seed < 60; seed++) {
      const c = storyTick(base(seed), ctx);
      if (calloutOpen(c)) return c;
    }
    throw new Error("no call-out");
  };

  it("happens some off-seasons, and needs a story", () => {
    expect(calloutOpen(base())).toBe(false);
    const counts = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((s) => calloutOpen(storyTick(base(s), ctx)));
    expect(counts.some(Boolean)).toBe(true);
    expect(counts.every(Boolean)).toBe(false);
  });

  it("is one-on-one to 11 against your rival, by name", () => {
    const c = open();
    const r = startRun(c, "copper-flats", 3, "callout", ctx, "keyboard")!;
    expect(r.pending.home.roster.length).toBe(1);
    expect(r.pending.away.roster.length).toBe(1);
    expect(`${r.pending.away.roster[0].firstName} ${r.pending.away.roster[0].lastName}`).toBe(c.story!.rival.name);
    expect(r.pending.park!.rules!.target).toBe(11);
  });

  it("your rival keeps pace with you", () => {
    const c = open();
    const gap = Math.abs(rivalPlayer(c).age - c.player.age);
    expect(gap).toBe(0);
  });

  it("counts on your head-to-head, doesn't use a run, and only comes once an off-season", () => {
    const c = open();
    const r = startRun(c, "copper-flats", 3, "callout", ctx, "keyboard")!;
    const done = finishRun(r.career, true, true);
    expect(done.story!.rival.wins).toBe(1);
    expect(runsLeft(done)).toBe(RUNS_PER_WINDOW);
    expect(calloutOpen(done)).toBe(false);
    expect(legendPoints(legendEvents(done)).pillars.moments).toBe(2);
  });

  it("ducking it costs you", () => {
    const c = { ...open(), street: { ...streetOf(open()), rep: 20 } };
    const out = declineCallout(c);
    expect(streetOf(out).rep).toBe(17);
    expect(calloutOpen(out)).toBe(false);
  });
});
