import { describe, expect, it } from "vitest";
import { archetypesFor, randomAppearance } from "@/engine/player";
import { Rng } from "@/engine/rng";
import type { Team } from "@/engine/types";
import hs from "@/data/generated/hs.json";
import college from "@/data/generated/college.json";
import pro from "@/data/generated/pro.json";
import { emptyLine } from "@/game/sim/stats";
import { DEFAULT_SETTINGS, createCareer, defaultBody } from "../create";
import { hsContext, startSeason } from "../hs/season";
import { legendEvents, legendPoints } from "../legend";
import { currentPro, fame, trainingCamp } from "../pro/season";
import { currentStock } from "../pro/draft";
import { FAN_NAMES, MEDIA_DAY, POSTGAME_LOSS, POSTGAME_WIN, RANDOM_EVENTS, RIVAL_GAME, SCRIPTED } from "../story/content";
import { MAX_PENDING, isRivalGame, personality, readThread, replyText, resolveEvent, skipEvent, storyTick } from "../story/engine";
import type { Career, ProCareer, ScheduledGame, StoryEvent } from "../types";

const teams = hs.teams as unknown as Team[];
const pros = pro.teams as unknown as Team[];
const ctx = hsContext(teams, college.teams as unknown as Team[], college.conferences, pros);

function base(frequency: Career["settings"]["storyFrequency"] = "normal"): Career {
  return createCareer(
    {
      firstName: "Test",
      lastName: "Story",
      pos: "PG",
      archetype: archetypesFor("PG")[0],
      body: defaultBody("PG"),
      appearance: randomAppearance(new Rng(3)),
      jersey: 4,
      hometown: "Phoenix, AZ",
      schoolId: "hs-brophy-prep",
      allocation: {},
      settings: { ...DEFAULT_SETTINGS, storyFrequency: frequency },
      startYear: 2026,
    },
    777,
  );
}
const pending = (c: Career): StoryEvent[] => c.story!.pending;
const withLog = (c: Career, text: string, kind: Career["log"][number]["kind"] = "milestone"): Career => ({
  ...c,
  log: [...c.log, { date: "2027-01-01", text, kind }],
});
const proCareer = (): Career => {
  const c = base();
  return {
    ...c,
    stage: "pro",
    date: "2031-06-28",
    player: { ...c.player, age: 21, teamId: pros[0].id, devDate: "2031-06-28", contract: { salary: 5e6, years: 4 } },
    pro: {
      preDraft: { year: 2031, agent: "family", workouts: [], interviews: [], stockDelta: 0 },
      status: "standard",
      confidence: 0,
      teamFirst: 0,
      earnings: 0,
      seasons: [],
      endorsements: [],
    } as ProCareer,
  };
};

describe("starting the story", () => {
  it("gives you a mentor from the greats and a rival from a nearby school, and your phone lights up", () => {
    const c = storyTick(base(), ctx);
    const s = c.story!;
    expect(s.mentor).toBeTruthy();
    expect(s.rival.name).toBeTruthy();
    const mine = teams.find((t) => t.id === "hs-brophy-prep")!;
    expect(teams.find((t) => t.id === s.rival.teamId)!.conferenceId).toBe(mine.conferenceId);
    expect(s.threads[s.mentor].length).toBe(2);
    expect(s.unread).toContain(s.mentor);
    expect(s.threads[s.mentor][0].text).toContain(s.mentor);
    expect(s.threads[s.mentor][1].text).toContain(s.rival.name);
  });

  it("does nothing the second time when nothing has happened", () => {
    const c = storyTick(base(), ctx);
    expect(storyTick(c, ctx)).toBe(c);
  });

  it("leaves older events out when a career with history picks up the story", () => {
    const c = withLog(withLog(base(), "Made the Varsity team after tryouts."), "Called up to Varsity.");
    expect(storyTick(c, ctx).story!.logSeen).toBe(c.log.length);
    expect(storyTick(c, ctx).story!.threads["Mom"]).toBeUndefined();
  });
});

describe("reading the career", () => {
  const start = () => storyTick(base(), ctx);

  it("family and mentor react to what happens", () => {
    const c = storyTick(withLog(start(), "Made the Junior Varsity team after tryouts."), ctx);
    expect(c.story!.threads["Mom"].length).toBe(1);
    const up = storyTick(withLog(start(), "Called up to Varsity."), ctx);
    expect(up.story!.threads[up.story!.mentor].length).toBe(3);
  });

  it("each log entry is only read once", () => {
    const c = storyTick(withLog(start(), "Made the Junior Varsity team after tryouts."), ctx);
    expect(storyTick({ ...c, date: "2027-02-01" }, ctx).story!.threads["Mom"].length).toBe(1);
  });

  it("a draft pick gets a press conference and a post, and the rival turns pro", () => {
    const c = storyTick(withLog(start(), "Drafted 5th overall by Boston."), ctx);
    expect(pending(c).some((e) => e.title === "Draft night press conference")).toBe(true);
    expect(c.story!.feed.length).toBeGreaterThan(0);
    expect(pros.some((t) => t.id === c.story!.rival.teamId)).toBe(true);
  });

  it("a title brings a press conference, but a region title doesn't", () => {
    expect(pending(storyTick(withLog(start(), "6A State champion", "award"), ctx)).some((e) => e.title === "Champions")).toBe(true);
    expect(pending(storyTick(withLog(start(), "Region champion", "award"), ctx)).some((e) => e.title === "Champions")).toBe(false);
  });

  it("an injury brings calls from home", () => {
    const c = storyTick(withLog(start(), "Sprained ankle: out about 3 games."), ctx);
    expect(c.story!.threads["Mom"].length).toBe(1);
  });

  it("media day comes once a season", () => {
    const c = trainingCamp(proCareer(), "shooting", ctx);
    const once = storyTick(c, ctx);
    expect(pending(once).filter((e) => e.title === "Media day").length).toBe(1);
    expect(storyTick({ ...once, date: "2031-11-01" }, ctx).story!.pending.filter((e) => e.title === "Media day").length).toBe(1);
  });

  it("fills in names everywhere, leaving no placeholders", () => {
    const c = storyTick(withLog(withLog(trainingCamp(proCareer(), "shooting", ctx), "Drafted 5th overall by Boston."), "League champion", "award"), ctx);
    const words = JSON.stringify([c.story!.pending, c.story!.feed, c.story!.threads]);
    expect(words).not.toMatch(/\{(name|team|opp|pts|rival|mentor|award|text|hometown|rivalTeam)\}/);
  });

  it("never lets more than a few answers pile up", () => {
    let c = start();
    for (let i = 0; i < 8; i++) c = storyTick({ ...withLog(c, "League champion", "award"), date: `2027-01-1${i}` }, ctx);
    expect(pending(c).length).toBeLessThanOrEqual(MAX_PENDING);
  });
});

describe("your games", () => {
  const game = (win: boolean, pts: number, oppId: string, extra: Partial<ScheduledGame> = {}, i = 0): ScheduledGame => ({
    id: `g${i}`,
    date: `2031-1${i % 2}-1${i % 9}`,
    level: "pro",
    homeId: pros[0].id,
    awayId: oppId,
    kind: "region",
    result: { home: win ? 110 : 90, away: 100, played: true, overtimes: 0, userLine: { ...emptyLine(), min: 2000, pts, fgm: 10, fga: 15, ast: 8, dreb: 6 } },
    ...extra,
  });
  const inSeason = (games: ScheduledGame[], c = storyTick(trainingCamp(proCareer(), "shooting", ctx), ctx)) => {
    const s = currentPro(c)!;
    return { ...c, pro: { ...c.pro!, seasons: [{ ...s, games }] } };
  };

  it("keeps score against your rival and calls you to the microphone", () => {
    const start = storyTick(trainingCamp(proCareer(), "shooting", ctx), ctx);
    const rivalTeam = pros[5].id;
    const c0 = { ...start, story: { ...start.story!, rival: { ...start.story!.rival, teamId: rivalTeam }, pending: [] } };
    const c = storyTick(inSeason([game(true, 25, rivalTeam)], c0), ctx);
    expect(c.story!.rival.wins).toBe(1);
    expect(pending(c).some((e) => e.title === "You beat your rival")).toBe(true);
    expect(pending(c)[0].body).toContain(c.story!.rival.name);
    expect(isRivalGame(c, game(true, 25, rivalTeam))).toBe(true);
    expect(isRivalGame(c, game(true, 25, pros[9].id))).toBe(false);
  });

  it("only asks about the latest game after a long sim", () => {
    const list = Array.from({ length: 30 }, (_, i) => game(true, 40, pros[1 + (i % 4)].id, { id: `g${i}` }, i));
    const c = storyTick(inSeason(list), ctx);
    expect(c.story!.pending.length).toBeLessThanOrEqual(MAX_PENDING);
    expect(c.story!.gamesSeen).toBe(30);
  });

  it("a low setting means fewer story beats than a high one", () => {
    const count = (f: Career["settings"]["storyFrequency"]) => {
      let n = 0;
      for (let seed = 0; seed < 80; seed++) {
        const bare = base(f);
        const started = storyTick(trainingCamp({ ...proCareer(), settings: bare.settings, seed }, "shooting", ctx), ctx);
        const c = { ...started, story: { ...started.story!, pending: [] } };
        n += pending(storyTick(inSeason([game(true, 40, pros[1].id)], c), ctx)).length;
      }
      return n;
    };
    expect(count("high")).toBeGreaterThan(count("low"));
  });
});

describe("answering", () => {
  const withEvent = (choices: StoryEvent["choices"], stage: Career["stage"] = "hs"): Career => {
    const c = storyTick(base(), ctx);
    return { ...c, stage, story: { ...c.story!, pending: [{ id: "e1", date: c.date, kind: "press", title: "Test", body: "?", choices }] } };
  };

  it("moves your personality and standing, and tells you how it went", () => {
    const { career, reply } = resolveEvent(
      withEvent([{ text: "a", reply: "ok", confident: 0.3, star: -0.4, fans: 5, media: -5, teammates: 3, coach: 2 }]),
      "e1",
      0,
    );
    const s = career.story!;
    expect(reply).toBe("ok");
    expect([s.confident, s.star, s.fans, s.media, s.teammates, s.coach]).toEqual([0.3, -0.4, 55, 45, 53, 52]);
    expect(s.pending).toEqual([]);
    expect(personality(career).label).toBe("Confident, team-first");
  });

  it("keeps meters in bounds", () => {
    const c = withEvent([{ text: "a", reply: "", fans: 500, confident: 9 }]);
    const s = resolveEvent(c, "e1", 0).career.story!;
    expect(s.fans).toBe(100);
    expect(s.confident).toBe(1);
  });

  it("ignores events that aren't waiting", () => {
    const c = withEvent([{ text: "a", reply: "" }]);
    expect(resolveEvent(c, "nope", 0).career).toBe(c);
    expect(resolveEvent(c, "e1", 5).career).toBe(c);
  });

  it("community choices earn Impact on the Road to Legend", () => {
    const c = withEvent([{ text: "a", reply: "", impact: 30, impactText: "Started a foundation in your hometown" }]);
    const r = resolveEvent(c, "e1", 0).career;
    expect(legendPoints(legendEvents(r)).pillars.impact).toBe(30);
    expect(r.log.at(-1)!.text).toContain("foundation");
  });

  it("the coach's trust and team chemistry move with your answers", () => {
    const c = storyTick(trainingCamp(proCareer(), "shooting", ctx), ctx);
    const s = currentPro(c)!;
    const ready = {
      ...c,
      story: {
        ...c.story!,
        pending: [{ id: "e1", date: c.date, kind: "choice" as const, title: "T", body: "?", choices: [{ text: "a", reply: "", coach: 10, teammates: 10 }] }],
      },
    };
    const after = currentPro(resolveEvent(ready, "e1", 0).career)!;
    expect(after.trust).toBeGreaterThan(s.trust);
    expect(after.chemistry).toBeGreaterThan(s.chemistry);
  });

  it("skipping a press conference costs a little with the media", () => {
    const c = skipEvent(withEvent([{ text: "a", reply: "" }]), "e1");
    expect(c.story!.media).toBe(48);
    expect(c.story!.pending).toEqual([]);
  });

  it("fans lift your fame, and the media lifts your draft stock", () => {
    const c = trainingCamp(proCareer(), "shooting", ctx);
    const famous = { ...c, story: { ...storyTick(c, ctx).story!, fans: 100 } };
    const unknown = { ...c, story: { ...storyTick(c, ctx).story!, fans: 0 } };
    expect(fame(famous)).toBeGreaterThan(fame(unknown));
    const loved = {
      ...famous,
      college: { seasons: [], earnings: 0, declared: { date: "x", stock: { pick: 20, label: "", score: 81 } } },
      story: { ...famous.story!, media: 100 },
    };
    const hated = { ...loved, story: { ...famous.story!, media: 0 } };
    expect(currentStock(loved).score).toBeGreaterThan(currentStock(hated).score);
  });
});

describe("the phone", () => {
  it("opening a thread clears it, and replies are kept", () => {
    const c = storyTick(base(), ctx);
    const who = c.story!.mentor;
    const read = readThread(c, who);
    expect(read.story!.unread).toEqual([]);
    expect(readThread(read, who)).toBe(read);
    const replied = replyText(read, who, "Thank you.");
    expect(replied.story!.threads[who].at(-1)).toMatchObject({ mine: true, text: "Thank you." });
  });
});

describe("the writing", () => {
  const all = [...POSTGAME_WIN, ...POSTGAME_LOSS, ...RIVAL_GAME, ...RANDOM_EVENTS, ...Object.values(MEDIA_DAY), ...Object.values(SCRIPTED)];

  it("every event has a real choice to make", () => {
    for (const e of all) {
      expect(e.choices.length).toBeGreaterThanOrEqual(2);
      for (const c of e.choices) {
        expect(c.text.length).toBeGreaterThan(2);
        expect(c.reply.length).toBeGreaterThan(2);
      }
    }
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
    expect(RANDOM_EVENTS.length).toBeGreaterThan(15);
  });

  it("Impact choices explain themselves", () => {
    for (const e of all) for (const c of e.choices) if (c.impact) expect(c.impactText).toBeTruthy();
  });

  it("has fan accounts with invented names", () => {
    expect(FAN_NAMES.length).toBeGreaterThan(5);
  });

  it("keeps a season's start out of the way of a brand-new career", () => {
    const c = startSeason(base(), 2026, ctx);
    expect(storyTick(c, ctx).story!.pending).toEqual([]);
  });
});
