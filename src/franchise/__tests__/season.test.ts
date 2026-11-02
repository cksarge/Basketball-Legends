import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, proCalendar } from "@/career/calendar";
import type { Team } from "@/engine/types";
import { applyGame, conferenceSeeds, dueGame, nextFranchiseEvent, simDay } from "../core/season";
import { createFranchise } from "../create";
import { simBox } from "../boxsim";
import { defaultRotation } from "../rotation";
import { runSim } from "../simRun";
import { createFranchiseSave, loadFranchise, openFranchiseDb } from "../storage";
import type { Franchise } from "../types";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const team = teams[0];
const make = (seed = "season") => createFranchise({ league: "pro", team, teams, seed, now: 1 });
const finished = (f: Franchise, id: string) => f.season.games.filter((g) => g.result && g.kind === "region" && (g.homeId === id || g.awayId === id)).length;

function simSeason(f: Franchise) {
  for (let i = 0; i < 400 && f.phase !== "offseason"; i++) f = simDay(f, teams, { includeUser: true }).franchise;
  return f;
}
const season = simSeason(make());

beforeEach(() => {
  openFranchiseDb(`test-${Math.random()}`);
});

describe("a new franchise", () => {
  it("has the 1,230-game schedule with 82 games a team", () => {
    const f = make();
    expect(f.season.games).toHaveLength(1230);
    for (const t of teams) expect(f.season.games.filter((g) => g.homeId === t.id || g.awayId === t.id)).toHaveLength(82);
  });

  it("has the user's first game next", () => {
    const f = make();
    const first = f.season.games.filter((g) => g.homeId === team.id || g.awayId === team.id).sort((a, b) => a.date.localeCompare(b.date))[0];
    const ev = nextFranchiseEvent(f);
    expect(ev.kind).toBe("game");
    if (ev.kind === "game") expect(ev.game.id).toBe(first.id);
  });
});

describe("simDay", () => {
  it("never books a team twice in a day", () => {
    const seen = new Set<string>();
    for (const g of season.season.games)
      for (const id of [g.homeId, g.awayId]) {
        const key = `${g.date}:${id}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
  });

  it("stops for the user's game and leaves it open", () => {
    let f = make();
    let r = simDay(f, teams, { includeUser: false });
    for (let i = 0; i < 60 && !r.blocked; i++) {
      f = r.franchise;
      r = simDay(f, teams, { includeUser: false });
    }
    expect(r.blocked).toBe(true);
    const ev = nextFranchiseEvent(r.franchise);
    expect(ev.kind === "game" && ev.date === r.franchise.date && !ev.game.result).toBe(true);
    const others = r.franchise.season.games.filter((g) => g.date === r.franchise.date && g.homeId !== team.id && g.awayId !== team.id);
    expect(others.every((g) => g.result)).toBe(true);
  });

  it("repeats exactly for a seed", () => {
    let a = make(),
      b = make();
    for (let i = 0; i < 30; i++) {
      a = simDay(a, teams, { includeUser: true }).franchise;
      b = simDay(b, teams, { includeUser: true }).franchise;
    }
    expect(a).toEqual(b);
  });
});

describe("a full season", () => {
  it("ends in the offseason with a champion", () => {
    expect(season.phase).toBe("offseason");
    expect(teams.map((t) => t.id)).toContain(season.season.championId);
    expect(nextFranchiseEvent(season).kind).toBe("seasonEnd");
  });

  it("finishes all 82 games for every team, with nobody over 82 played", () => {
    for (const t of teams) expect(finished(season, t.id)).toBe(82);
    for (const line of Object.values(season.season.stats)) expect(line.gp).toBeLessThanOrEqual(82);
  });

  it("sends 16 teams to the first round, seeded from the standings", () => {
    const r1 = season.season.series.filter((x) => x.round === 1);
    expect(new Set(r1.flatMap((x) => [x.high, x.low])).size).toBe(16);
    const east = conferenceSeeds(season, teams, "East");
    expect(east).toHaveLength(15);
    expect(r1.find((x) => x.id === "East-r1-0")!.high).toBe(east[0]);
  });

  it("keeps league stats apart from playoff stats", () => {
    expect(Object.keys(season.season.playoffStats).length).toBeGreaterThan(50);
    const totalPoints = Object.values(season.season.stats).reduce((s, l) => s + l.pts, 0);
    const scored = season.season.games.filter((g) => g.kind === "region").reduce((s, g) => s + g.result!.home + g.result!.away, 0);
    expect(totalPoints).toBe(scored);
  });

  it("counts starts only for starters", () => {
    for (const line of Object.values(season.season.stats)) expect(line.gs).toBeLessThanOrEqual(line.gp);
    expect(Object.values(season.season.stats).filter((l) => l.gs > 40).length).toBeGreaterThanOrEqual(100);
  });

  it("keeps only the user's box score on each game", () => {
    const g = season.season.games.find((x) => x.homeId === team.id)!;
    const other = season.season.games.find((x) => x.homeId !== team.id && x.awayId !== team.id)!;
    expect(Object.keys(g.result!.box!).every((id) => season.rosters[team.id].includes(id))).toBe(true);
    expect(other.result!.box).toBeUndefined();
  });

  it("heals injuries and keeps hurt players off the floor", () => {
    expect(Object.values(season.players).some((p) => p.injury)).toBe(true);
    let f = make();
    const hurtId = f.rosters[team.id][0];
    f = { ...f, players: { ...f.players, [hurtId]: { ...f.players[hurtId], injury: { name: "Sprain", gamesOut: 2 } } } };
    let games = 0;
    const before = () => f.players[hurtId].injury?.gamesOut ?? 0;
    for (let i = 0; i < 40 && before() > 0; i++) {
      const next = simDay(f, teams, { includeUser: true }).franchise;
      const played = finished(next, team.id) - finished(f, team.id);
      games += played;
      f = next;
    }
    expect(f.players[hurtId].injury).toBeUndefined();
    expect(games).toBe(2);
    expect(f.season.stats[hurtId]).toBeUndefined();
  });

  it("simulates in under a minute", () => {
    const t0 = performance.now();
    simSeason(make("speed"));
    expect(performance.now() - t0).toBeLessThan(60_000);
  });
});

describe("dueGame", () => {
  const atGameDay = () => {
    let f = make("due");
    for (let i = 0; i < 60; i++) {
      const r = simDay(f, teams, { includeUser: false });
      f = r.franchise;
      if (r.blocked) break;
    }
    return f;
  };

  it("is the user's game once the league has caught up to it", () => {
    const f = atGameDay();
    const ev = nextFranchiseEvent(f);
    expect(dueGame(f)?.id).toBe(ev.kind === "game" ? ev.game.id : "none");
  });

  it("is nothing while the game is still days away", () => {
    expect(dueGame({ ...make("due"), date: "2026-10-01" })).toBeNull();
  });

  it("is nothing once the season is over", () => {
    expect(dueGame(season)).toBeNull();
  });
});

describe("applyGame", () => {
  const box = (f: Franchise, gameId: string) => {
    const g = f.season.games.find((x) => x.id === gameId)!;
    const side = (id: string) => {
      const roster = f.rosters[id].map((p) => f.players[p]);
      const rotation = defaultRotation(roster, 240);
      return { teamId: id, roster, rotation, starters: Object.keys(rotation).slice(0, 5) };
    };
    return simBox({ league: "pro", quarterMinutes: 12, periods: 4, home: side(g.homeId), away: side(g.awayId), seed: "x" });
  };

  it("records the game once, however many times it's applied", () => {
    const f = make();
    const g = f.season.games[0];
    const r = box(f, g.id);
    const once = applyGame(f, g.id, r, true);
    expect(once.season.games[0].result?.played).toBe(true);
    expect(applyGame(once, g.id, r, true)).toEqual(once);
  });
});

describe("runSim", () => {
  const until = addDays(proCalendar(2026).opening, 25);
  const save = async (seed: string) => createFranchiseSave(make(seed), team);

  it("stops at the user's next game", async () => {
    const f = await save("a");
    const end = await runSim(
      { id: f.id, until: "nextUserGame", includeUser: false },
      teams,
      () => {},
      () => false,
    );
    const ev = nextFranchiseEvent(end);
    expect(ev.kind === "game" && ev.date === end.date).toBe(true);
    expect((await loadFranchise(f.id))!.revision).toBe(end.revision);
  });

  it("stops when cancelled, with the last finished day stored", async () => {
    const f = await save("b");
    let days = 0;
    const end = await runSim(
      { id: f.id, until, includeUser: true },
      teams,
      () => days++,
      () => days >= 3,
    );
    expect(days).toBe(3);
    expect((await loadFranchise(f.id))!.date).toBe(end.date);
  });

  it("picks up after an interrupted run with no doubled stats", async () => {
    const whole = await save("same");
    const done = await runSim(
      { id: whole.id, until, includeUser: true },
      teams,
      () => {},
      () => false,
    );
    openFranchiseDb(`test-${Math.random()}`);
    const cut = await save("same");
    let days = 0;
    await expect(
      runSim(
        { id: cut.id, until, includeUser: true },
        teams,
        () => {
          if (++days === 12) throw new Error("tab closed");
        },
        () => false,
      ),
    ).rejects.toThrow("tab closed");
    const resumed = await runSim(
      { id: cut.id, until, includeUser: true },
      teams,
      () => {},
      () => false,
    );
    expect(resumed.season.stats).toEqual(done.season.stats);
    expect(resumed.date).toBe(done.date);
  });
});
