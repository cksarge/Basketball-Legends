// One career from freshman year to retirement, through every system in the order a player meets them.
// Normal runs use scripted game results so the whole road takes seconds. SOAK=1 runs every game through the real engine.
import { describe, expect, it } from "vitest";
import { archetypesFor, playerOvr, randomAppearance } from "@/engine/player";
import { Rng } from "@/engine/rng";
import type { Team } from "@/engine/types";
import hs from "@/data/generated/hs.json";
import college from "@/data/generated/college.json";
import pro from "@/data/generated/pro.json";
import { emptyLine } from "@/game/sim/stats";
import type { MatchSetup } from "@/game/sim/match";
import { DEFAULT_SETTINGS, createCareer, defaultBody } from "../create";
import {
  advanceTo,
  applyShowcaseGame,
  applyTryout,
  applyUserGame,
  currentSeason,
  finishSeason,
  goToCamp,
  graduate,
  hsContext,
  nextEvent,
  placeAtTryout,
  prepareShowcase,
  recruitStep,
  showcaseSetup,
  spendPoint,
  startNextYear,
  startSeason,
  takeFinals,
  userMatchSetup,
  type UserGameOutcome,
} from "../hs/season";
import { CAMPS } from "../hs/summer";
import { outcomeFromMatch, runMatchSync } from "../hs/play";
import { chooseCollege, liveOffers, walkOnOptions } from "../recruiting";
import {
  advanceCollege,
  applyCollegeGame,
  collegeMatchSetup,
  currentCollege,
  declareForDraft,
  enterCollege,
  enterPortal,
  finishCollegeSeason,
  nextCollegeEvent,
  returnToSchool,
  signNil,
  startNextCollegeYear,
  transferTo,
} from "../college/season";
import {
  INTERVIEWS,
  WORKOUTS_ALLOWED,
  answerInterview,
  chooseAgent,
  draftStep,
  enterPreDraft,
  finishDraft,
  joinDevLeague,
  runCombine,
  runDraft,
  signTwoWay,
  workOut,
  workoutTeams,
} from "../pro/draft";
import {
  advancePro,
  applyProGame,
  currentPro,
  finishProSeason,
  negotiate,
  nextProEvent,
  proMatchSetup,
  signContract,
  signEndorsement,
  trainingCamp,
} from "../pro/season";
import { retire } from "../pro/retire";
import { legendStatus } from "../legend";
import { migrate } from "../storage";
import { calloutOpen, finishRun, runsLeft, simRun, startRun } from "../park";
import { resolveEvent, storyTick } from "../story/engine";
import type { Career } from "../types";

const SOAK = !!process.env.SOAK;
const hsTeams = hs.teams as unknown as Team[];
const pros = pro.teams as unknown as Team[];
const ctx = hsContext(hsTeams, college.teams as unknown as Team[], college.conferences, pros);

const line = (pts: number) => ({
  ...emptyLine(),
  min: 30 * 60,
  pts,
  fgm: Math.round(pts / 2.2),
  fga: Math.round(pts / 1.1),
  tpm: 2,
  tpa: 5,
  oreb: 1,
  dreb: 5,
  ast: 6,
  stl: 1,
  blk: 1,
});

interface Options {
  seed: number;
  /** Scripted points per game by career stage. */
  pts: number;
  win: number;
  hsSchool?: string;
  transfer?: boolean;
  undrafted?: boolean;
  retireAt?: number;
}

function play(c: Career, setup: MatchSetup, rng: Rng, o: Options): UserGameOutcome {
  if (SOAK) return outcomeFromMatch(runMatchSync(setup), false);
  const mine = setup.home.roster.some((p) => p.id === c.player.id);
  const won = rng.chance(o.win);
  const [a, b] = won ? [80, 70] : [70, 80];
  return {
    homeScore: mine ? a : b,
    awayScore: mine ? b : a,
    overtimes: 0,
    box: { [c.player.id]: line(Math.max(0, Math.round(rng.normal(o.pts, 5)))) },
    played: rng.chance(0.3),
    playerOfGame: null,
  };
}

/** The story and the park run alongside: answer whatever's waiting, and take your pickup runs. */
function life(c: Career, rng: Rng): Career {
  let x = storyTick(c, ctx);
  while (x.story?.pending.length) {
    const e = x.story.pending[0];
    x = storyTick(resolveEvent(x, e.id, rng.int(0, e.choices.length - 1)).career, ctx);
  }
  if (x.stage !== "retired") {
    if (calloutOpen(x)) x = storyTick(simRun(x, "copper-flats", 1, "callout", ctx), ctx);
    while (runsLeft(x) > 0) {
      const r = startRun(x, "copper-flats", 3, "pickup", ctx, "keyboard");
      if (!r) break;
      x = storyTick(finishRun(r.career, rng.chance(0.6), rng.chance(0.5)), ctx);
    }
  }
  while (x.player.skillPoints > 0) {
    const keys = Object.keys(x.player.ratings) as (keyof typeof x.player.ratings)[];
    const before = x.player.skillPoints;
    x = spendPoint(x, rng.pick(keys));
    if (x.player.skillPoints === before && rng.chance(0.2)) break;
  }
  return x;
}

function highSchool(c0: Career, rng: Rng, o: Options): Career {
  let c = c0;
  for (let i = 0; i < 400; i++) {
    c = life(c, rng);
    const ev = nextEvent(c);
    switch (ev.kind) {
      case "season":
        c = startSeason(c, Number(ev.date.slice(0, 4)), ctx);
        break;
      case "tryout": {
        c = advanceTo(c, ev.date, ctx);
        c = applyTryout(c, placeAtTryout(c, ctx, rng.int(-2, 3)));
        break;
      }
      case "game": {
        c = advanceTo(c, ev.date, ctx);
        const game = currentSeason(c)!.games.find((g) => g.id === ev.game.id)!;
        c = advanceTo(applyUserGame(c, game.id, play(c, userMatchSetup(c, game, ctx), rng, o), ctx), game.date, ctx);
        break;
      }
      case "finals":
        c = recruitStep(takeFinals(advanceTo(c, ev.date, ctx), ev.semester, 0.8), ctx, ev.date);
        break;
      case "seasonEnd":
        c = advanceTo(c, ev.date, ctx);
        if (nextEvent(c).kind !== "game") c = finishSeason(c, ctx);
        break;
      case "camp":
        c = recruitStep(goToCamp(c, CAMPS[0].id), ctx, c.date);
        break;
      case "showcase":
        if (!ev.game) c = prepareShowcase(c);
        else {
          const g = ev.game;
          c = recruitStep(applyShowcaseGame(c, g.id, play(c, showcaseSetup(c, g), rng, o)), ctx, g.date);
        }
        break;
      case "nextYear":
        c = startNextYear(c, ctx);
        break;
      case "graduated": {
        const offers = liveOffers(c);
        const team = offers[0]?.teamId ?? walkOnOptions(c, ctx.colleges!)[0]?.id ?? ctx.colleges!.find((t) => t.state === "AZ")!.id;
        c = graduate(chooseCollege(c, team, ctx.colleges!, c.date), ctx);
        return enterCollege(c, ctx);
      }
    }
  }
  throw new Error(`high school got stuck on ${nextEvent(c).kind}`);
}

function collegeYears(c0: Career, rng: Rng, o: Options): Career {
  let c = c0;
  let years = 0;
  for (let i = 0; i < 800; i++) {
    c = life(c, rng);
    const ev = nextCollegeEvent(c);
    switch (ev.kind) {
      case "game": {
        c = advanceCollege(c, ev.date, ctx);
        const now = nextCollegeEvent(c);
        if (now.kind !== "game") break;
        const s = currentCollege(c)!;
        for (const d of s.nil) if (d.status === "open" && rng.chance(0.5)) c = signNil(c, d.id);
        c = advanceCollege(applyCollegeGame(c, now.game.id, play(c, collegeMatchSetup(c, now.game, ctx), rng, o), ctx), now.game.date, ctx);
        break;
      }
      case "seasonEnd":
        c = advanceCollege(c, ev.date, ctx);
        if (nextCollegeEvent(c).kind === "seasonEnd") c = finishCollegeSeason(c, ctx);
        break;
      case "decision":
        years++;
        if (years >= 3 || !currentCollege(c)) return declareForDraft(c);
        if (o.transfer && years === 1) {
          const p = enterPortal(c, ctx);
          const offer = currentCollege(p)!.portalOffers?.[0];
          c = offer ? transferTo(p, offer.teamId, ctx) : returnToSchool(c);
        } else c = returnToSchool(c);
        if (nextCollegeEvent(c).kind === "decision") return declareForDraft(c);
        break;
      case "portal":
        c = returnToSchool(c);
        break;
      case "nextYear":
        c = startNextCollegeYear(c, ctx);
        break;
      case "declared":
        return c;
    }
  }
  throw new Error(`college got stuck on ${nextCollegeEvent(c).kind}`);
}

function draft(c0: Career, rng: Rng): Career {
  let c = chooseAgent(enterPreDraft(c0), rng.pick(["shark", "brand", "family"] as const));
  c = runCombine(c, [0.6, 0.7, 0.5], 1);
  while (c.pro!.preDraft.workouts.length < WORKOUTS_ALLOWED) c = workOut(c, workoutTeams(c, pros)[0].id, pros);
  while (c.pro!.preDraft.interviews.length < INTERVIEWS.length) c = answerInterview(c, rng.int(0, 2));
  c = life(finishDraft(runDraft(c, pros), pros), rng);
  if (draftStep(c) === "undrafted") c = c.pro!.undraftedOffers?.length ? signTwoWay(c, c.pro!.undraftedOffers[0], pros) : joinDevLeague(c, pros[0].id, pros);
  return c;
}

function proYears(c0: Career, rng: Rng, o: Options): Career {
  let c = c0;
  const retireAt = o.retireAt ?? 35;
  for (let i = 0; i < 6000; i++) {
    c = life(c, rng);
    const ev = nextProEvent(c);
    switch (ev.kind) {
      case "training":
        if (c.player.age >= retireAt) return retire(c, "family", ctx);
        for (const e of c.pro!.endorsementOffers ?? []) c = signEndorsement(c, e.brand);
        c = trainingCamp(c, rng.pick(["shooting", "finishing", "playmaking", "defense", "athleticism"]), ctx);
        break;
      case "game": {
        c = advancePro(c, ev.date, ctx);
        const now = nextProEvent(c);
        if (now.kind !== "game") break;
        c = advancePro(applyProGame(c, now.game.id, play(c, proMatchSetup(c, now.game, ctx), rng, o), ctx), now.game.date, ctx);
        break;
      }
      case "injured":
        c = advancePro(c, ev.date, ctx);
        break;
      case "seasonEnd":
        c = advancePro(c, ev.date, ctx);
        if (nextProEvent(c).kind === "seasonEnd") c = finishProSeason(c, ctx);
        break;
      case "freeAgency": {
        const offers = c.pro!.offers ?? [];
        if (!offers.length) return retire(c, "kids", ctx);
        c = negotiate(c, offers[0].teamId, 0.04).career;
        const open = c.pro!.offers!.find((x) => !x.pulled) ?? null;
        if (!open) return retire(c, "kids", ctx);
        c = signContract(c, open.teamId, ctx);
        break;
      }
    }
  }
  throw new Error(`the pros got stuck on ${nextProEvent(c).kind}`);
}

function fullCareer(o: Options): Career {
  const rng = new Rng(`full:${o.seed}`);
  const created = createCareer(
    {
      firstName: "Full",
      lastName: "Career",
      pos: rng.pick(["PG", "SG", "SF", "PF", "C"] as const),
      archetype: archetypesFor("SG")[0],
      body: defaultBody("SG"),
      appearance: randomAppearance(rng),
      jersey: 7,
      hometown: "Phoenix, AZ",
      schoolId: o.hsSchool ?? "hs-brophy-prep",
      allocation: {},
      settings: { ...DEFAULT_SETTINGS, storyFrequency: "high" },
      startYear: 2026,
    },
    o.seed,
  );
  return proYears(draft(collegeYears(highSchool(created, rng, o), rng, o), rng), rng, o);
}

/** Things that should be true of any save at the end of any career. */
function checkSave(c: Career) {
  expect(c.stage).toBe("retired");
  expect(c.retirement).toBeTruthy();
  const size = JSON.stringify(c).length;
  expect(size).toBeLessThan(40_000_000);
  expect(() => migrate(JSON.parse(JSON.stringify(c)))).not.toThrow();
  for (const v of Object.values(c.player.ratings)) {
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(99);
  }
  expect(Number.isFinite(legendStatus(c).points)).toBe(true);
  for (let i = 1; i < c.log.length; i++) expect(typeof c.log[i].date).toBe("string");
  expect(JSON.stringify(c)).not.toMatch(/NaN|undefined,|\{(name|team|opp|pts|rival|mentor|award|text|hometown|rivalTeam)\}/);
}

describe("a whole career", () => {
  const seeds: Options[] = SOAK
    ? [{ seed: 11, pts: 0, win: 0, retireAt: 33 }]
    : [
        { seed: 1, pts: 26, win: 0.75 },
        { seed: 2, pts: 12, win: 0.5, transfer: true, retireAt: 33 },
        { seed: 3, pts: 34, win: 0.85, retireAt: 38 },
        { seed: 4, pts: 5, win: 0.3, hsSchool: hsTeams.find((t) => !(t.levels ?? []).includes("frso"))?.id, retireAt: 31 },
      ];
  it.each(seeds)(
    "gets from freshman year to retirement: seed $seed",
    (o) => {
      const c = fullCareer(o);
      checkSave(c);
      const pro = c.pro!.seasons.filter((s) => s.stats.gp > 0);
      const summary = {
        seed: o.seed,
        peak: playerOvr(c.player),
        age: c.retirement!.age,
        seasons: { hs: c.hs.seasons.length, col: c.college?.seasons.length, pro: c.pro!.seasons.length },
        rank: c.retirement!.rank,
        points: c.retirement!.points,
        totals: c.retirement!.totals,
        earnings: c.pro!.earnings,
        street: c.street?.rep,
        rival: c.story?.rival,
        sizeMB: Math.round(JSON.stringify(c).length / 1e4) / 100,
        last: pro.at(-1)?.finish,
        awards: pro.flatMap((s) => s.awards).length,
      };
      if (process.env.SOAK_OUT) process.stdout.write(`${JSON.stringify(summary)}\n`);
      expect(c.hs.seasons.length).toBeGreaterThanOrEqual(3);
      expect(c.pro!.seasons.length).toBeGreaterThan(3);
      expect(currentPro(c)!.wrapped).toBe(true);
    },
    SOAK ? 3_000_000 : 180_000,
  );
});
