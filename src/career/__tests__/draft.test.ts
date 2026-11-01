import { describe, expect, it } from "vitest";
import { archetypesFor, randomAppearance } from "@/engine/player";
import { Rng } from "@/engine/rng";
import type { Team } from "@/engine/types";
import pro from "@/data/generated/pro.json";
import { emptyLine } from "@/game/sim/stats";
import { DEFAULT_SETTINGS, createCareer, defaultBody } from "../create";
import { currentCollege } from "../college/season";
import {
  AGENTS,
  DRAFT_PICKS,
  INTERVIEWS,
  WORKOUTS_ALLOWED,
  answerInterview,
  chooseAgent,
  currentStock,
  draftOrder,
  draftStep,
  enterPreDraft,
  finishDraft,
  joinDevLeague,
  ordinal,
  rookieContract,
  runCombine,
  runDraft,
  signTwoWay,
  workOut,
  workoutTeams,
} from "../pro/draft";
import type { Career, CollegeSeason } from "../types";

const teams = pro.teams as unknown as Team[];

function declared(score: number, seed = 777): Career {
  const c = createCareer(
    {
      firstName: "Test",
      lastName: "Prospect",
      pos: "SF",
      archetype: archetypesFor("SF")[0],
      body: defaultBody("SF"),
      appearance: randomAppearance(new Rng(3)),
      jersey: 4,
      hometown: "Phoenix, AZ",
      schoolId: "hs-brophy-prep",
      allocation: {},
      settings: DEFAULT_SETTINGS,
      startYear: 2026,
    },
    seed,
  );
  const s = {
    year: 2030,
    classYear: "SO",
    teamId: "col-albany",
    tier: "D1",
    stats: { ...emptyLine(), gp: 30, gs: 30 },
    roster: [],
    games: [],
    awards: [],
    nil: [],
  } as unknown as CollegeSeason;
  const pick = Math.max(1, Math.round(1 + (85 - score) * 5));
  return {
    ...c,
    stage: "college",
    date: "2031-04-20",
    player: { ...c.player, age: 20 },
    college: { seasons: [s], earnings: 0, declared: { date: "2031-04-20", stock: { pick, label: "x", score } } },
  };
}

/** Runs every pre-draft step with middling answers. */
function throughPreDraft(c: Career): Career {
  let x = chooseAgent(enterPreDraft(c), "family");
  x = runCombine(x, [0.5, 0.5, 0.5], 0);
  while (x.pro!.preDraft.workouts.length < WORKOUTS_ALLOWED) x = workOut(x, workoutTeams(x, teams)[0].id, teams);
  while (x.pro!.preDraft.interviews.length < INTERVIEWS.length) x = answerInterview(x, 0);
  return x;
}

describe("the road to the draft", () => {
  it("walks through each step in order", () => {
    let c = enterPreDraft(declared(80));
    expect(c.stage).toBe("pro");
    expect(c.pro!.preDraft.year).toBe(2031);
    expect(draftStep(c)).toBe("agent");
    c = chooseAgent(c, "brand");
    expect(draftStep(c)).toBe("combine");
    c = runCombine(c, [0.8, 0.6, 0.7], 2);
    expect(draftStep(c)).toBe("workouts");
    for (let i = 0; i < WORKOUTS_ALLOWED; i++) c = workOut(c, workoutTeams(c, teams)[0].id, teams);
    expect(draftStep(c)).toBe("interview");
    for (let i = 0; i < INTERVIEWS.length; i++) c = answerInterview(c, 0);
    expect(draftStep(c)).toBe("draft");
  });

  it("needs a declaration, and can't be started twice", () => {
    const c = declared(80);
    expect(enterPreDraft({ ...c, college: { ...c.college!, declared: undefined } }).pro).toBeUndefined();
    const once = enterPreDraft(c);
    expect(enterPreDraft(once)).toBe(once);
  });

  it("keeps the first agent you sign with", () => {
    const c = chooseAgent(enterPreDraft(declared(80)), "shark");
    expect(chooseAgent(c, "family").pro!.preDraft.agent).toBe("shark");
    expect(AGENTS.map((a) => a.id)).toEqual(["shark", "brand", "family"]);
  });

  it("a strong combine raises your stock and a bad one lowers it", () => {
    const c = chooseAgent(enterPreDraft(declared(78)), "family");
    expect(currentStock(runCombine(c, [1, 1, 1], 4)).score).toBeGreaterThan(currentStock(c).score);
    expect(currentStock(runCombine(c, [0, 0, 0], -4)).score).toBeLessThan(currentStock(c).score);
    const numbers = runCombine(c, [0.5, 0.5, 0.5], 0).pro!.preDraft.combine!;
    expect(numbers.verticalIn).toBeGreaterThan(20);
    expect(numbers.laneSec).toBeGreaterThan(9);
    expect(numbers.threesMade).toBeLessThanOrEqual(25);
  });

  it("limits workouts and offers teams near your draft spot", () => {
    const c = throughPreDraft(declared(80));
    expect(c.pro!.preDraft.workouts.length).toBe(WORKOUTS_ALLOWED);
    expect(workOut(c, workoutTeams(c, teams)[0].id, teams)).toBe(c);
    expect(new Set(c.pro!.preDraft.workouts.map((w) => w.teamId)).size).toBe(WORKOUTS_ALLOWED);
  });

  it("interview answers change stock and personality", () => {
    const c = chooseAgent(enterPreDraft(declared(78)), "family");
    const humble = answerInterview(c, 2);
    const brash = answerInterview(c, 1);
    expect(humble.pro!.teamFirst).toBeGreaterThan(brash.pro!.teamFirst);
    expect(brash.pro!.confidence).toBeGreaterThan(humble.pro!.confidence);
    expect(answerInterview(c, 9)).toBe(c);
  });
});

describe("draft night", () => {
  it("has 30 teams picking in the order of who needs it most", () => {
    const o = draftOrder(teams, 2031, 1);
    expect(new Set(o.map((t) => t.id)).size).toBe(30);
    expect(draftOrder(teams, 2031, 1)).toEqual(o);
  });

  it("runs two rounds of 60 picks with no player taken twice", () => {
    const d = runDraft(throughPreDraft(declared(80)), teams).pro!.draft!;
    expect(d.picks.length).toBe(DRAFT_PICKS);
    expect(d.picks.filter((p) => p.round === 1).length).toBe(30);
    expect(new Set(d.picks.map((p) => p.pick)).size).toBe(DRAFT_PICKS);
    expect(new Set(d.picks.map((p) => p.name)).size).toBeGreaterThan(55);
    expect(d.trades.length).toBeGreaterThan(0);
    expect(d.picks.some((p) => p.via)).toBe(true);
  });

  it("puts you near your projection across many drafts", () => {
    for (const [score, lo, hi] of [
      [84, 1, 14],
      [80, 14, 36],
      [75, 36, 62],
    ]) {
      const spots = [11, 22, 33, 44, 55, 66].map(
        (seed) => runDraft(throughPreDraft(declared(score, seed)), teams).pro!.draft!.picks.find((p) => p.isUser)?.pick ?? 61,
      );
      const avg = spots.reduce((a, b) => a + b, 0) / spots.length;
      expect(avg).toBeGreaterThanOrEqual(lo);
      expect(avg).toBeLessThanOrEqual(hi);
    }
  });

  it("is the same every time for the same save", () => {
    const c = throughPreDraft(declared(80));
    expect(runDraft(c, teams).pro!.draft).toEqual(runDraft(c, teams).pro!.draft);
  });

  it("a drafted player gets a team and a rookie deal scaled to the pick", () => {
    const c = finishDraft(runDraft(throughPreDraft(declared(84)), teams), teams);
    const mine = c.pro!.draft!.picks.find((p) => p.isUser)!;
    expect(draftStep(c)).toBe("drafted");
    expect(c.player.teamId).toBe(c.pro!.draft!.teamId);
    expect(c.player.contract).toEqual(rookieContract(mine.pick));
    expect(c.log.at(-1)!.text).toContain("Drafted");
  });

  it("pays higher picks more, and first-rounders get longer deals", () => {
    expect(rookieContract(1).salary).toBeGreaterThan(rookieContract(14).salary);
    expect(rookieContract(30).salary).toBeGreaterThan(rookieContract(31).salary);
    expect(rookieContract(30).years).toBe(4);
    expect(rookieContract(45).years).toBe(2);
  });

  it("writes ordinals properly", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 60].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "60th"]);
  });
});

describe("going undrafted", () => {
  const undrafted = (score: number) => finishDraft(runDraft(throughPreDraft(declared(score)), teams), teams);

  it("brings two-way offers to fringe prospects", () => {
    const c = undrafted(72);
    expect(c.pro!.draft!.teamId).toBeNull();
    expect(draftStep(c)).toBe("undrafted");
    expect(c.pro!.undraftedOffers!.length).toBe(2);
    const signed = signTwoWay(c, c.pro!.undraftedOffers![0], teams);
    expect(signed.pro!.status).toBe("twoWay");
    expect(signed.player.contract?.twoWay).toBe(true);
    expect(draftStep(signed)).toBe("drafted");
  });

  it("can't sign a two-way with a team that didn't offer", () => {
    const c = undrafted(72);
    const other = teams.find((t) => !c.pro!.undraftedOffers!.includes(t.id))!;
    expect(signTwoWay(c, other.id, teams)).toBe(c);
  });

  it("leaves the development league open to anyone", () => {
    const c = undrafted(60);
    expect(c.pro!.undraftedOffers).toEqual([]);
    const dev = joinDevLeague(c, teams[3].id, teams);
    expect(dev.pro!.status).toBe("dev");
    expect(dev.player.teamId).toBe(teams[3].id);
    expect(currentCollege(dev)).toBeTruthy();
  });
});
