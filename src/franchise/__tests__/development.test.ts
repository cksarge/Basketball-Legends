import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addDays } from "@/career/calendar";
import { playerOvr } from "@/engine/player";
import type { Player, Team } from "@/engine/types";
import { weeklyDevelopment } from "../coaching/development";
import { simDay } from "../core/season";
import { createFranchise } from "../create";
import type { Franchise, StaffMember } from "../types";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const team = teams[0];
const make = (): Franchise => createFranchise({ league: "pro", team, teams, seed: "dev", now: 1 });
const week = (f: Franchise, n = 1) => {
  for (let i = 0; i < n; i++) f = weeklyDevelopment({ ...f, date: addDays(f.devDate, 7) }).franchise;
  return f;
};
const coach = (rating: number): StaffMember => ({ id: "c", role: "development", name: "C", rating, salary: 1 });
/** Sets up every player on the team the same way, with room to grow. */
const shaped = (f: Franchise, o: Partial<Player>, traits: Partial<Player["traits"]>): Franchise => ({
  ...f,
  players: Object.fromEntries(
    Object.entries(f.players).map(([id, p]) => [
      id,
      f.rosters[team.id].includes(id) ? { ...p, ...o, ratings: { ...p.ratings, three: 60 }, traits: { ...p.traits, ...traits } } : p,
    ]),
  ),
});
const totalThree = (f: Franchise) => f.rosters[team.id].reduce((s, id) => s + f.players[id].ratings.three, 0);
const focus = (f: Franchise, practice: Franchise["plan"]["practice"]): Franchise => ({ ...f, plan: { ...f.plan, practice } });

describe("weekly practice", () => {
  it("helps young hard workers more than old low-effort players", () => {
    const young = week(focus(shaped(make(), { age: 20, potential: 99 }, { workEthic: 1 }), "shooting"), 20);
    const old = week(focus(shaped(make(), { age: 34, potential: 99 }, { workEthic: 0 }), "shooting"), 20);
    expect(totalThree(young)).toBeGreaterThan(totalThree(old) + 5);
  });

  it("stops a player at his potential", () => {
    const start = shaped(make(), { age: 20 }, { workEthic: 1 });
    const capped = { ...start, players: Object.fromEntries(Object.entries(start.players).map(([id, p]) => [id, { ...p, potential: playerOvr(p) }])) };
    const after = week(focus(capped, "shooting"), 30);
    for (const id of after.rosters[team.id]) expect(playerOvr(after.players[id])).toBeLessThanOrEqual(after.players[id].potential);
  });

  it("gets more from a better development coach", () => {
    const start = focus(shaped(make(), { age: 22, potential: 99 }, { workEthic: 0.5 }), "shooting");
    const withCoach = (rating: number) => week({ ...start, plan: { ...start.plan, staff: [coach(rating)] } }, 20);
    expect(totalThree(withCoach(95))).toBeGreaterThan(totalThree(withCoach(40)));
  });

  it("builds stamina on a conditioning focus", () => {
    const start = shaped(make(), { age: 21, potential: 99 }, { workEthic: 1 });
    const stamina = (f: Franchise) => f.rosters[team.id].reduce((s, id) => s + f.players[id].ratings.stamina, 0);
    expect(stamina(week(focus(start, "conditioning"), 20))).toBeGreaterThan(stamina(start));
  });

  it("counts a player's own plan on top of the team's", () => {
    const start = shaped(make(), { age: 22, potential: 99 }, { workEthic: 0.5 });
    const ids = start.rosters[team.id];
    const planned = { ...start, plan: { ...start.plan, playerPlans: Object.fromEntries(ids.map((id) => [id, { focus: "shooting" }])) } };
    expect(totalThree(week(planned, 20))).toBeGreaterThan(totalThree(week(start, 20)));
  });

  it("teaches a new position after 12 weeks and not before", () => {
    const f = make();
    const id = f.rosters[team.id][0];
    const newPos = f.players[id].pos === "C" ? "PF" : "C";
    const start = { ...f, plan: { ...f.plan, playerPlans: { [id]: { focus: "defense", newPos } as const } } };
    expect(week(start, 11).players[id].secondaryPos).toBe(f.players[id].secondaryPos);
    const done = week(start, 12);
    expect(done.players[id].secondaryPos).toBe(newPos);
    expect(done.plan.playerPlans[id].newPos).toBeUndefined();
  });

  it("does nothing until a week has passed", () => {
    const f = make();
    const r = weeklyDevelopment({ ...f, date: addDays(f.devDate, 6) });
    expect(r.changedPlayers).toEqual([]);
    expect(r.franchise.devDate).toBe(f.devDate);
  });

  it("only touches the user's team, and repeats for a seed", () => {
    const f = focus(shaped(make(), { age: 20, potential: 99 }, { workEthic: 1 }), "shooting");
    const a = weeklyDevelopment({ ...f, date: addDays(f.devDate, 7) });
    const b = weeklyDevelopment({ ...f, date: addDays(f.devDate, 7) });
    expect(a).toEqual(b);
    expect(a.changedPlayers.every((id) => f.rosters[team.id].includes(id))).toBe(true);
  });

  it("runs as the league sims", () => {
    let f = focus(shaped(make(), { age: 20, potential: 99 }, { workEthic: 1 }), "shooting");
    const start = totalThree(f);
    for (let i = 0; i < 60; i++) f = simDay(f, teams, { includeUser: true }).franchise;
    expect(totalThree(f)).toBeGreaterThan(start);
    expect(f.devDate > make().devDate).toBe(true);
  });
});
