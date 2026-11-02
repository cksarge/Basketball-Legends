import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateRoster, teamTalentTarget } from "@/engine/player";
import type { Team } from "@/engine/types";
import { hireStaff, staffPool, staffRating } from "../coaching/staff";
import { simBox } from "../boxsim";
import { applyGame } from "../core/season";
import { createFranchise } from "../create";
import { defaultRotation } from "../rotation";
import type { Franchise, StaffMember } from "../types";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const team = teams[0];
const make = (): Franchise => createFranchise({ league: "pro", team, teams, seed: "staff", now: 1 });
const member = (role: StaffMember["role"], rating: number): StaffMember => ({ id: `${role}-x`, role, name: "A Coach", rating, salary: 1 });

describe("staff", () => {
  it("offers 6 candidates per role, the same for a seed", () => {
    const pool = staffPool(make(), "trainer");
    expect(pool).toHaveLength(6);
    expect(staffPool(make(), "trainer")).toEqual(pool);
    for (const s of pool) {
      expect(s.role).toBe("trainer");
      expect(s.rating).toBeGreaterThanOrEqual(40);
      expect(s.rating).toBeLessThanOrEqual(95);
      expect(s.name.length).toBeGreaterThan(3);
    }
  });

  it("pays better coaches more", () => {
    const pool = [...staffPool(make(), "development")].sort((a, b) => a.rating - b.rating);
    expect(pool[5].salary).toBeGreaterThan(pool[0].salary);
  });

  it("replaces whoever held the role", () => {
    const one = hireStaff(make(), member("scout", 60));
    const two = hireStaff(one, { ...member("scout", 80), id: "scout-y" });
    expect(two.plan.staff.filter((s) => s.role === "scout").map((s) => s.rating)).toEqual([80]);
  });

  it("treats an empty role as 50", () => {
    expect(staffRating(make(), "assistant")).toBe(50);
    expect(staffRating(hireStaff(make(), member("assistant", 77)), "assistant")).toBe(77);
  });

  it("gets hurt players back faster with a better trainer", () => {
    const hurtFor = (rating: number) => {
      const f = hireStaff(make(), member("trainer", rating));
      const g = f.season.games.find((x) => x.homeId === team.id)!;
      const id = f.rosters[team.id][0];
      const next = applyGame(
        f,
        g.id,
        { home: 1, away: 0, overtimes: 0, box: {}, playerOfGame: null, injuries: [{ playerId: id, name: "Sprain", gamesOut: 8 }] },
        false,
      );
      return next.players[id].injury!.gamesOut;
    };
    expect(hurtFor(90)).toBeLessThan(8);
    expect(hurtFor(40)).toBeGreaterThanOrEqual(8);
  });

  it("wins a little more with a good assistant", () => {
    const [a, b] = [...teams].sort((x, y) => teamTalentTarget(x) - teamTalentTarget(y)).slice(14, 16);
    const ra = generateRoster(a, 1),
      rb = generateRoster(b, 2);
    const score = (coachEdge: number) => {
      let pts = 0;
      for (let i = 0; i < 300; i++) {
        const side = (t: Team, r: typeof ra, edge?: number) => {
          const rotation = defaultRotation(r, 240);
          return { teamId: t.id, roster: r, rotation, starters: Object.keys(rotation).slice(0, 5), coachEdge: edge };
        };
        pts += simBox({ league: "pro", quarterMinutes: 12, periods: 4, home: side(a, ra, coachEdge), away: side(b, rb), seed: `e${i}` }).home;
      }
      return pts / 300;
    };
    expect(score(0.004)).toBeGreaterThan(score(0));
  });
});
