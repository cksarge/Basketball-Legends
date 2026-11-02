import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addDays } from "@/career/calendar";
import { playerOvr } from "@/engine/player";
import type { Team } from "@/engine/types";
import { emptyLine } from "@/game/sim/stats";
import { applyGame, simDay } from "../core/season";
import { hireStaff } from "../coaching/staff";
import { createFranchise } from "../create";
import { simBox } from "../boxsim";
import { MAX_ASSIGNED, assignScout, isUnknown, prospectRange, shownOvr, weeklyScouting } from "../pro/scouting";
import type { Franchise } from "../types";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const make = (seed = "scout") => createFranchise({ league: "pro", team: teams[0], teams, seed, now: 1 });
const withPoints = (f: Franchise, points: number): Franchise => ({
  ...f,
  draft: { ...f.draft, scouting: Object.fromEntries(f.draft.prospects.map((p) => [p.id, points])) },
});
const scout = (rating: number) => ({ id: "s", role: "scout" as const, name: "A B", rating, salary: 1 });

describe("scouting", () => {
  it("the true rating is always inside the range", () => {
    const f = make();
    for (const pts of [0, 1, 5, 30, 200]) {
      const g = withPoints(f, pts);
      for (const p of g.draft.prospects) {
        const r = prospectRange(g, p);
        expect(playerOvr(p)).toBeGreaterThanOrEqual(r.ovr[0]);
        expect(playerOvr(p)).toBeLessThanOrEqual(r.ovr[1]);
        expect(p.potential).toBeGreaterThanOrEqual(r.pot[0]);
        expect(p.potential).toBeLessThanOrEqual(r.pot[1]);
      }
    }
  });

  it("ranges narrow with points and with a better scout", () => {
    const f = make();
    const p = f.draft.prospects[0];
    const width = (g: Franchise) => {
      const r = prospectRange(g, p).ovr;
      return r[1] - r[0];
    };
    expect(width(withPoints(f, 40))).toBeLessThan(width(f));
    expect(width(hireStaff(withPoints(f, 20), scout(95)))).toBeLessThan(width(hireStaff(withPoints(f, 20), scout(40))));
  });

  it("a prospect's range doesn't jump around as points are added", () => {
    const f = make();
    for (const p of f.draft.prospects) {
      let last = prospectRange(f, p).ovr;
      for (const pts of [1, 3, 9, 27, 81]) {
        const r = prospectRange(withPoints(f, pts), p).ovr;
        expect(r[0]).toBeGreaterThanOrEqual(last[0]);
        expect(r[1]).toBeLessThanOrEqual(last[1]);
        last = r;
      }
    }
  });

  it("assignments stop at twelve", () => {
    let f = make();
    for (const p of f.draft.prospects.slice(0, 20)) f = assignScout(f, p.id, true);
    expect(f.draft.assigned).toHaveLength(MAX_ASSIGNED);
    f = assignScout(f, f.draft.assigned[0], false);
    expect(f.draft.assigned).toHaveLength(MAX_ASSIGNED - 1);
  });

  it("assigned prospects gain more points each week", () => {
    const f = assignScout(make(), make().draft.prospects[0].id, true);
    const next = weeklyScouting(f);
    expect(next.draft.scouting[f.draft.prospects[0].id]).toBe(3);
    expect(next.draft.scouting[f.draft.prospects[1].id]).toBeCloseTo(0.4);
  });

  it("simDay scouts once a week", () => {
    let f = assignScout(make(), make().draft.prospects[0].id, true);
    const start = f.date;
    while (f.date < addDays(start, 7)) f = simDay(f, teams, { includeUser: true }).franchise;
    expect(f.draft.scouting[f.draft.prospects[0].id]).toBe(3);
  });
});

describe("what the user sees", () => {
  const f = make();
  const id = f.rosters[teams[1].id][0];
  const rookie = { ...f.players[id], file: { service: 0, teamSeasons: 0, range: { ovr: [70, 78] as [number, number], pot: [80, 90] as [number, number] } } };
  const withRookie: Franchise = { ...f, players: { ...f.players, [id]: rookie } };

  it("a rookie shows a range until he plays, then his overall", () => {
    expect(isUnknown(rookie)).toBe(true);
    expect(shownOvr(rookie)).toBe("70-78");
    const g = withRookie.season.games.find((x) => x.homeId === teams[1].id || x.awayId === teams[1].id)!;
    const box = { [id]: { ...emptyLine(), min: 20, pts: 10 } };
    const played = applyGame(
      withRookie,
      g.id,
      { ...simBox({ league: "pro", quarterMinutes: 1, periods: 1, home: side(g.homeId), away: side(g.awayId), seed: "x" }), box },
      false,
    );
    expect(isUnknown(played.players[id])).toBe(false);
    expect(shownOvr(played.players[id])).toBe(String(playerOvr(rookie)));
  });

  function side(teamId: string) {
    const roster = f.rosters[teamId].map((x) => f.players[x]);
    const rotation = Object.fromEntries(roster.slice(0, 5).map((p) => [p.id, 1]));
    return { teamId, roster, rotation, starters: Object.keys(rotation) };
  }
});
