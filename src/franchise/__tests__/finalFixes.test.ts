import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import type { Team } from "@/engine/types";
import { emptyLine } from "@/game/sim/stats";
import { simDay } from "../core/season";
import { createFranchise } from "../create";
import { applyTrade, type Trade } from "../pro/trades";
import { releasePlayer } from "../pro/rosterMoves";
import { DEFAULT_LEAGUE } from "../settings";
import { createFranchiseSave, loadFranchise, openFranchiseDb } from "../storage";
import type { Franchise } from "../types";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const me = teams[0].id;
const make = (games: 82 | 41 = 82, seed = "fixes") =>
  createFranchise({ league: "pro", team: teams[0], teams, seed, now: 1, settings: { league: { ...DEFAULT_LEAGUE, gamesPerSeason: games } } });
const median = (n: number[]) => [...n].sort((a, b) => a - b)[Math.floor(n.length / 2)];
function season(f: Franchise) {
  let x = f;
  for (let i = 0; i < 400 && x.phase !== "offseason"; i++) x = simDay(x, teams, { includeUser: true }).franchise;
  return x;
}

beforeEach(() => {
  openFranchiseDb(`test-${Math.random()}`);
});

describe("short seasons and money", () => {
  it("a 41-game season pays about like an 82-game one", () => {
    const full = season(make(82));
    const short = season(make(41));
    const profit = (f: Franchise) => median(teams.map((t) => f.finance[t.id].lastSeason!.profit));
    expect(profit(short)).toBeGreaterThan(profit(full) * 0.6);
    expect(teams.filter((t) => short.finance[t.id].lastSeason!.profit < 0).length).toBeLessThan(8);
  });
});

describe("saves from beta.10", () => {
  /** As beta.10 wrote it, at the review after a finished season. */
  function beta10(f: Franchise) {
    const old = JSON.parse(JSON.stringify(f));
    for (const k of ["finance", "job", "news", "hall", "records", "powerLast", "aiTactics"]) delete old[k];
    delete old.settings.auto;
    delete old.settings.league;
    for (const p of Object.values(old.players) as { file: Record<string, unknown> }[]) delete p.file.career;
    return { ...old, version: 3 } as Franchise;
  }

  it("keeps the coach's record from seasons before the upgrade", async () => {
    const played = season(make());
    const old = beta10({ ...played, history: [{ year: 2025, record: { w: 50, l: 32 }, awards: [] }] });
    await createFranchiseSave(old, teams[0]);
    const up = (await loadFranchise(played.id))!;
    let w = 0,
      l = 0;
    for (const g of played.season.games) {
      if (!g.result || g.kind !== "region" || (g.homeId !== me && g.awayId !== me)) continue;
      if (g.result.home > g.result.away === (g.homeId === me)) w++;
      else l++;
    }
    expect(up.job.stints[0]).toMatchObject({ w: 50 + w, l: 32 + l });
  });

  it("builds career totals from the seasons in the database", async () => {
    const f = make();
    const id = f.rosters[me][0];
    const old = beta10({ ...f, season: { ...f.season, year: 2027 } });
    const past = [2025, 2026].map((year) => ({ ...f.season, year, games: [], stats: { [id]: { ...emptyLine(), gp: 70, gs: 70, pts: 1400 } } }));
    await createFranchiseSave(old, teams[0], past);
    const up = (await loadFranchise(f.id))!;
    expect(up.players[id].file?.career).toMatchObject({ seasons: 2, gp: 140, pts: 2800 });
  });
});

describe("untouchable", () => {
  it("wears off when a player leaves the team", () => {
    const f = make();
    const [a, b] = [f.rosters[me][0], f.rosters[teams[1].id][0]];
    const marked: Franchise = {
      ...f,
      players: {
        ...f.players,
        [a]: { ...f.players[a], contract: { salary: 5e6, years: 2 }, file: { ...f.players[a].file!, untouchable: true } },
        [b]: { ...f.players[b], contract: { salary: 5e6, years: 2 } },
      },
    };
    const t: Trade = {
      teams: [me, teams[1].id],
      assets: [
        { kind: "player", id: a, from: me, to: teams[1].id },
        { kind: "player", id: b, from: teams[1].id, to: me },
      ],
    };
    expect(applyTrade(marked, t).players[a].file?.untouchable).toBeFalsy();
    expect(releasePlayer(marked, a).players[a].file?.untouchable).toBeFalsy();
  });
});
