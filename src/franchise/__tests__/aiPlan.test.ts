import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generatePlayer } from "@/engine/player";
import { Rng } from "@/engine/rng";
import type { Player, Team } from "@/engine/types";
import { PLAYS } from "@/game/sim/playbook";
import { boxInputFor, simDay } from "../core/season";
import { simBox } from "../boxsim";
import { aiTactics } from "../coaching/aiPlan";
import { createFranchise } from "../create";
import { franchisePending } from "../match";
import { startNewSeason } from "../core/offseason";
import type { Franchise } from "../types";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const make = (seed = "ai") => createFranchise({ league: "pro", team: teams[0], teams, seed, now: 1 });

function roster(tweak: (p: Player, i: number) => Partial<Player["ratings"]>): Player[] {
  const rng = new Rng("roster");
  const pos = ["PG", "SG", "SF", "PF", "C", "PG", "SG", "SF", "PF", "C"] as const;
  return pos.map((p, i) => {
    const base = generatePlayer(rng, { pos: p, targetOvr: 76, age: 26, league: "pro", teamId: "x" });
    return { ...base, ratings: { ...base.ratings, three: 60, postControl: 60, passVision: 60, ...tweak(base, i) } };
  });
}

describe("AI systems", () => {
  it("a roster of shooters plays pace and space", () => {
    expect(
      aiTactics(
        roster(() => ({ three: 88 })),
        "s",
      ).system,
    ).toBe("paceSpace");
  });

  it("a great post scorer plays post-up", () => {
    expect(
      aiTactics(
        roster((p, i) => (i === 4 ? { postControl: 95 } : {})),
        "s",
      ).system,
    ).toBe("postUp");
  });

  it("a team with one far better player plays iso-star", () => {
    const r = roster(() => ({}));
    const star = {
      ...r[0],
      ratings: Object.fromEntries(Object.entries(r[0].ratings).map(([k, v]) => [k, Math.min(99, v + 18)])) as unknown as Player["ratings"],
    };
    expect(aiTactics([star, ...r.slice(1)], "s").system).toBe("isoStar");
  });

  it("it picks legal plays, at most six, and they fit the system", () => {
    const t = aiTactics(
      roster(() => ({ three: 88 })),
      "s",
    );
    expect(t.plays!.length).toBeGreaterThan(0);
    expect(t.plays!.length).toBeLessThanOrEqual(6);
    for (const id of t.plays!) expect(PLAYS[id]).toBeDefined();
    expect(new Set(t.plays).size).toBe(t.plays!.length);
  });
});

describe("in a league", () => {
  it("every AI team has a system from the start", () => {
    const f = make();
    const systems = new Set(teams.filter((t) => t.id !== f.teamId).map((t) => f.aiTactics[t.id].system));
    expect(f.aiTactics[teams[1].id].system).toBeDefined();
    expect(systems.size).toBeGreaterThan(1);
  });

  it("a team's system stays the same through a season", () => {
    let f = make();
    const before = f.aiTactics;
    for (let i = 0; i < 30; i++) f = simDay(f, teams, { includeUser: true }).franchise;
    expect(f.aiTactics).toEqual(before);
  });

  it("AI systems reach played games and simulated games", () => {
    const f = make();
    const g = f.season.games.find((x) => x.homeId === f.teamId || x.awayId === f.teamId)!;
    const other = g.homeId === f.teamId ? g.awayId : g.homeId;
    const side = g.homeId === f.teamId ? "away" : "home";
    expect(boxInputFor(f, g)[side].tactics).toEqual(f.aiTactics[other]);
    expect(franchisePending(f, g, teams, "keyboard")[side].tactics).toEqual(f.aiTactics[other]);
  });

  it("the next season rechooses from the new rosters", () => {
    const f: Franchise = { ...make(), phase: "offseason", offseason: { step: "camp", report: null } };
    const next = startNewSeason({ ...f, aiTactics: {} }, teams);
    expect(Object.keys(next.aiTactics).length).toBeGreaterThan(20);
  });

  it("league scoring stays within 3 percent of the baseline with every team coached", () => {
    const f = make();
    const games = f.season.games.slice(0, 300);
    const points = (x: Franchise) =>
      games.reduce((sum, g) => {
        const r = simBox(boxInputFor(x, g));
        return sum + r.home + r.away;
      }, 0);
    expect(points(f) / points({ ...f, aiTactics: {} })).toBeGreaterThan(0.97);
    expect(points(f) / points({ ...f, aiTactics: {} })).toBeLessThan(1.03);
  });

  it("a coached AI team plays the same after a reload", () => {
    const f = make();
    const g = f.season.games[0];
    expect(simBox(boxInputFor(JSON.parse(JSON.stringify(f)), g)).home).toBe(simBox(boxInputFor(f, g)).home);
  });
});
