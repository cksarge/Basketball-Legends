import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generatePlayer } from "@/engine/player";
import { Rng } from "@/engine/rng";
import type { Player, Team } from "@/engine/types";
import { emptyLine } from "@/game/sim/stats";
import { createFranchise } from "../create";
import { askingPrice, marketValue, mood, negotiate, offerScore, recordTalk } from "../pro/market";
import { capRules } from "../pro/rules";
import type { Franchise } from "../types";
import { finishedSeason } from "./draftHelpers";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const base = finishedSeason(createFranchise({ league: "pro", team: teams[0], teams, seed: "market", now: 1 }), teams);
const worst = teams[0].id;
const best = teams[29].id;

function agent(ovr: number, age = 27, o: Partial<Player> = {}, traits: Partial<Player["traits"]> = {}): Player {
  const p = generatePlayer(new Rng(`${ovr}:${age}`), { pos: "SG", targetOvr: ovr, age, league: "pro", teamId: null });
  return {
    ...p,
    age,
    teamId: null,
    traits: { ...p.traits, workEthic: 0.5, ego: 0.5, loyalty: 0.5, consistency: 0.5, ...traits },
    file: { service: 8, teamSeasons: 0 },
    ...o,
  };
}
const ask = (p: Player, teamId = best, f: Franchise = base) => askingPrice(f, p, teamId);

describe("value", () => {
  it("value rises steeply with overall and never tops the player's max", () => {
    expect(marketValue(base, agent(85))).toBeGreaterThan(marketValue(base, agent(75)) * 2);
    expect(marketValue(base, agent(97, 27, { file: { service: 2, teamSeasons: 0 } }))).toBeLessThanOrEqual(capRules(base.cap).maxSalary(2));
    expect(marketValue(base, agent(40))).toBe(capRules(base.cap).minSalary);
  });

  it("a 34-year-old gets less than a 27-year-old of the same overall", () => {
    expect(marketValue(base, agent(80, 34))).toBeLessThan(marketValue(base, agent(80, 27)));
  });

  it("a big year adds value, and a quiet one takes some off", () => {
    const p = agent(75);
    const year = (pts: number) => ({ ...base, season: { ...base.season, stats: { [p.id]: { ...emptyLine(), gp: 60, gs: 60, pts: pts * 60 } } } });
    expect(marketValue(year(30), p)).toBeGreaterThan(marketValue(base, p));
    expect(marketValue(year(2), p)).toBeLessThan(marketValue(base, p));
  });
});

describe("mood", () => {
  it("mood rises with winning and with a starting role", () => {
    const star = agent(92);
    expect(mood(base, star, best).parts.winning).toBeGreaterThan(mood(base, star, worst).parts.winning);
    expect(mood(base, star, best).parts.role).toBeGreaterThan(mood(base, agent(55), best).parts.role);
  });

  it("high ego weighs role more, and high loyalty favors his current team", () => {
    const score = (ego: number, ovr: number) => mood(base, agent(ovr, 27, {}, { ego }), best).score;
    expect(score(0.9, 92) - score(0.9, 55)).toBeGreaterThan(score(0.1, 92) - score(0.1, 55));
    const own = (loyalty: number) => {
      const p = agent(80, 27, { file: { service: 8, teamSeasons: 4, rightsTeamId: worst } }, { loyalty });
      return mood(base, p, worst).score - mood(base, p, teams[1].id).score;
    };
    expect(own(0.9)).toBeGreaterThan(own(0.1));
  });

  it("a contender can pay less than a loser for the same player", () => {
    const p = agent(82);
    expect(ask(p, best).salary).toBeLessThan(ask(p, worst).salary);
  });
});

describe("negotiation", () => {
  const p = agent(82);
  const a = ask(p);
  const offer = (salary: number, years = a.years, o = {}) => ({ teamId: best, salary, years, ...o });

  it("an offer at the ask is accepted, far below it walks after three tries", () => {
    expect(negotiate(base, p, offer(a.salary)).kind).toBe("accept");
    expect(negotiate(base, p, offer(a.salary * 0.4)).kind).toBe("counter");
    let f = base;
    f = recordTalk(recordTalk(f, p.id), p.id);
    expect(negotiate(f, p, offer(a.salary * 0.4)).kind).toBe("walk");
  });

  it("once he's walked, he won't talk until next year", () => {
    const f = recordTalk(recordTalk(recordTalk(base, p.id), p.id), p.id);
    expect(negotiate(f, p, offer(a.salary * 2)).kind).toBe("walk");
  });

  it("a counter sits between the offer and the ask", () => {
    const reply = negotiate(base, p, offer(a.salary * 0.6));
    expect(reply.kind).toBe("counter");
    if (reply.kind !== "counter") return;
    expect(reply.salary).toBeGreaterThan(a.salary * 0.6);
    expect(reply.salary).toBeLessThanOrEqual(a.salary);
    expect(reply.note).not.toBe("");
  });

  it("a player option costs less salary, and a team option costs more", () => {
    const just = a.salary * 0.97;
    expect(negotiate(base, p, offer(just)).kind).toBe("counter");
    expect(negotiate(base, p, offer(just, a.years, { playerOption: true })).kind).toBe("accept");
    expect(negotiate(base, p, offer(a.salary, a.years, { teamOption: true })).kind).toBe("counter");
  });

  it("an option on a one-year deal is worth nothing", () => {
    const one = offer(a.salary, 1);
    expect(offerScore(base, p, { ...one, playerOption: true })).toBe(offerScore(base, p, one));
  });

  it("older players won't take long deals, and young stars prefer them", () => {
    expect(ask(agent(80, 35)).years).toBe(1);
    expect(ask(agent(80, 31)).years).toBeLessThanOrEqual(3);
    expect(ask(agent(85, 24)).years).toBeGreaterThanOrEqual(4);
    const old = agent(80, 35);
    expect(offerScore(base, old, { teamId: best, salary: ask(old).salary, years: 4 })).toBeLessThan(
      offerScore(base, old, { teamId: best, salary: ask(old).salary, years: 1 }),
    );
  });

  it("an offer's score weighs winning as well as money", () => {
    const q = agent(80);
    const contender = offerScore(base, q, { teamId: best, salary: 15e6, years: 3 });
    const loser = offerScore(base, q, { teamId: worst, salary: 15.5e6, years: 3 });
    expect(contender).toBeGreaterThan(loser);
  });

  it("the same inputs give the same answer", () => {
    expect(negotiate(base, p, offer(a.salary * 0.8))).toEqual(negotiate(base, p, offer(a.salary * 0.8)));
  });
});
