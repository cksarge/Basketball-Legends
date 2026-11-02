import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateRoster } from "@/engine/player";
import type { Player, Team } from "@/engine/types";
import { SYSTEMS } from "@/game/sim/playbook";
import { defaultPlan, depthWarnings, resolveLineup, setPlayerFocus, setPlayerPosition, setSystem, togglePlay } from "../coaching/plan";
import { defaultRotation } from "../rotation";
import type { TeamPlan } from "../types";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const roster = generateRoster(teams[0], 1);
const total = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
const hurt = (p: Player): Player => ({ ...p, injury: { name: "Sprain", gamesOut: 5 } });
const manual = (o: Partial<TeamPlan> = {}): TeamPlan => ({
  ...defaultPlan(),
  autoRotation: false,
  starters: roster.slice(0, 5).map((p) => p.id),
  minutes: Object.fromEntries(roster.slice(0, 10).map((p, i) => [p.id, [36, 34, 33, 32, 30, 22, 18, 15, 12, 8][i]])),
  ...o,
});

describe("resolveLineup", () => {
  it("follows the default rotation on auto", () => {
    expect(resolveLineup(defaultPlan(), roster, 240).rotation).toEqual(defaultRotation(roster, 240));
  });

  it("uses the saved starters and minutes", () => {
    const l = resolveLineup(manual(), roster, 240);
    expect(l.starters).toEqual(roster.slice(0, 5).map((p) => p.id));
    expect(l.rotation[roster[0].id]).toBe(36);
    expect(total(l.rotation)).toBe(240);
  });

  it("gives a starter with no planned minutes real minutes", () => {
    const newStarter = roster[12];
    const plan = manual({ starters: [newStarter.id, ...roster.slice(1, 5).map((p) => p.id)] });
    const l = resolveLineup(plan, roster, 240);
    expect(l.rotation[newStarter.id]).toBeGreaterThanOrEqual(15);
    expect(total(l.rotation)).toBe(240);
  });

  it("replaces a hurt starter with a healthy player at his position", () => {
    const hurtRoster = roster.map((p, i) => (i === 0 ? hurt(p) : p));
    const l = resolveLineup(manual(), hurtRoster, 240);
    expect(l.starters).not.toContain(roster[0].id);
    expect(l.starters).toHaveLength(5);
    const fill = hurtRoster.find((p) => l.starters.includes(p.id) && !roster.slice(1, 5).some((x) => x.id === p.id))!;
    expect([fill.pos, fill.secondaryPos]).toContain(roster[0].pos);
    expect(total(l.rotation)).toBe(240);
    expect(l.rotation[roster[0].id]).toBeUndefined();
  });

  it("never changes the saved plan, so a player returns to it when healed", () => {
    const plan = manual();
    const before = structuredClone(plan);
    resolveLineup(plan, roster.map(hurt), 240);
    expect(plan).toEqual(before);
    expect(resolveLineup(plan, roster, 240).starters).toEqual(before.starters);
  });

  for (const sum of [0, 100, 400])
    it(`totals 240 with nobody over 48 when the plan adds up to ${sum}`, () => {
      const each = sum / 10;
      const l = resolveLineup(manual({ minutes: Object.fromEntries(roster.slice(0, 10).map((p) => [p.id, each])) }), roster, 240);
      expect(total(l.rotation)).toBe(240);
      expect(Math.max(...Object.values(l.rotation))).toBeLessThanOrEqual(48);
    });

  it("ignores a player who has left the team", () => {
    const l = resolveLineup(manual(), roster.slice(1), 240);
    expect(l.starters).toHaveLength(5);
    expect(l.starters).not.toContain(roster[0].id);
    expect(total(l.rotation)).toBe(240);
  });

  it("still fields five when almost everyone is hurt", () => {
    const l = resolveLineup(
      manual(),
      roster.map((p, i) => (i < 3 ? p : hurt(p))),
      240,
    );
    expect(l.starters).toHaveLength(5);
    expect(total(l.rotation)).toBe(240);
  });
});

describe("the playbook", () => {
  it("starts with a system's full book", () => {
    const plan = setSystem(defaultPlan(), "motion");
    expect(plan.tactics.system).toBe("motion");
    expect(plan.tactics.plays).toEqual(SYSTEMS.motion.plays);
  });

  it("clears with no system, back to the default offense", () => {
    const plan = setSystem(setSystem(defaultPlan(), "motion"), undefined);
    expect(plan.tactics.system).toBeUndefined();
    expect(plan.tactics.plays).toBeUndefined();
  });

  it("drops plays the new system doesn't run", () => {
    const plan = setSystem(setSystem(defaultPlan(), "motion"), "isoStar");
    expect(plan.tactics.plays).toEqual(["clearout"]);
  });

  it("adds and removes plays, up to six and never the last", () => {
    let plan = setSystem(defaultPlan(), "isoStar");
    for (const id of ["drag", "horns", "elbow", "floppy", "backdoor"] as const) plan = togglePlay(plan, id);
    expect(plan.tactics.plays).toHaveLength(6);
    expect(togglePlay(plan, "postEntry").tactics.plays).toHaveLength(6);
    expect(togglePlay(setSystem(defaultPlan(), "isoStar"), "clearout").tactics.plays).toEqual(["clearout"]);
  });
});

describe("player plans", () => {
  const id = roster[0].id;
  it("keeps a position in progress when the focus goes back to the team's", () => {
    const plan = { ...defaultPlan(), playerPlans: { [id]: { focus: "shooting", newPos: "C", posWeeks: 11 } as const } };
    expect(setPlayerFocus(plan, id, "").playerPlans[id]).toEqual({ focus: "", newPos: "C", posWeeks: 11 });
  });

  it("drops a plan with nothing left in it", () => {
    const plan = { ...defaultPlan(), playerPlans: { [id]: { focus: "shooting" } } };
    expect(setPlayerFocus(plan, id, "").playerPlans[id]).toBeUndefined();
    const learning = { ...defaultPlan(), playerPlans: { [id]: { focus: "", newPos: "C", posWeeks: 3 } as const } };
    expect(setPlayerPosition(learning, id, undefined).playerPlans[id]).toBeUndefined();
  });

  it("starts the clock on a new position, and keeps the focus", () => {
    const plan = { ...defaultPlan(), playerPlans: { [id]: { focus: "defense" } } };
    expect(setPlayerPosition(plan, id, "C").playerPlans[id]).toEqual({ focus: "defense", newPos: "C", posWeeks: 0 });
  });
});

describe("depthWarnings", () => {
  const kinds = (plan: TeamPlan, r = roster) => depthWarnings(plan, r).map((w) => [w.playerId, w.kind]);

  it("warns about fatigue past 38 minutes", () => {
    const p = roster[0];
    expect(kinds(manual({ minutes: { ...manual().minutes, [p.id]: 39 } }))).toContainEqual([p.id, "fatigue"]);
    expect(kinds(manual({ minutes: { ...manual().minutes, [p.id]: 38 } }))).not.toContainEqual([p.id, "fatigue"]);
  });

  it("warns about a starter out of position", () => {
    const bigAtPoint = roster.find((p) => p.pos === "C" && p.secondaryPos !== "PG")!;
    const starters = [
      bigAtPoint.id,
      ...roster
        .filter((p) => p !== bigAtPoint)
        .slice(1, 5)
        .map((p) => p.id),
    ];
    expect(kinds(manual({ starters }))).toContainEqual([bigAtPoint.id, "position"]);
  });

  it("warns about a hurt player in the plan", () => {
    expect(
      kinds(
        manual(),
        roster.map((p, i) => (i === 2 ? hurt(p) : p)),
      ),
    ).toContainEqual([roster[2].id, "hurt"]);
  });

  it("warns about a healthy player with no minutes in a thin rotation", () => {
    const plan = manual({ minutes: { [roster[0].id]: 48, [roster[1].id]: 48, [roster[2].id]: 48, [roster[3].id]: 48, [roster[4].id]: 48 } });
    expect(kinds(plan)).toContainEqual([roster[5].id, "unused"]);
  });

  it("stays quiet on auto", () => {
    expect(depthWarnings(defaultPlan(), roster)).toEqual([]);
  });
});
