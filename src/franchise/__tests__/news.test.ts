import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ScheduledGame } from "@/career/types";
import { playerOvr } from "@/engine/player";
import type { Team } from "@/engine/types";
import { emptyLine } from "@/game/sim/stats";
import type { BoxResult } from "../boxsim";
import { jobOffers, takeJob } from "../club/jobs";
import { advanceOffseason } from "../core/offseason";
import { simDay } from "../core/season";
import { createFranchise } from "../create";
import { NEWS_LIMIT, addNews, gameNews, seasonNews, tradeNews } from "../history/news";
import { simDraftToEnd } from "../pro/draft";
import { staffHandles } from "../pro/freeAgency";
import { userTrade, type Trade } from "../pro/trades";
import type { Franchise } from "../types";
import { finishedSeason } from "./draftHelpers";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const make = (seed = "news") => createFranchise({ league: "pro", team: teams[0], teams, seed, now: 1 });
const f = make();
const g: ScheduledGame = { id: "g", date: f.date, level: "pro", homeId: teams[1].id, awayId: teams[2].id, kind: "region" };
const result = (o: Partial<BoxResult> = {}): BoxResult => ({ home: 100, away: 95, overtimes: 0, box: {}, playerOfGame: "", injuries: [], ...o });
const best = (teamId: string) => [...f.rosters[teamId]].sort((a, b) => playerOvr(f.players[b]) - playerOvr(f.players[a]))[0];
const worst = (teamId: string) => [...f.rosters[teamId]].sort((a, b) => playerOvr(f.players[a]) - playerOvr(f.players[b]))[0];

describe("game news", () => {
  it("a long injury to a good player makes the news, and a short one to a bench player doesn't", () => {
    const star = best(teams[1].id);
    expect(gameNews(f, g, result({ injuries: [{ playerId: star, name: "Sprain", gamesOut: 20 }] }), teams).map((n) => n.kind)).toContain("injury");
    const bench = worst(teams[1].id);
    expect(gameNews(f, g, result({ injuries: [{ playerId: bench, name: "Sprain", gamesOut: 2 }] }), teams)).toEqual([]);
  });

  it("the user's own injuries always make the news", () => {
    const mine = worst(f.teamId);
    const own = { ...g, homeId: f.teamId };
    expect(gameNews(f, own, result({ injuries: [{ playerId: mine, name: "Sprain", gamesOut: 2 }] }), teams).map((n) => n.kind)).toContain("injury");
  });

  it("an upset makes the news: a big gap in win share", () => {
    const season = finishedSeason(f, teams);
    const bad = teams[0].id,
      good = teams[29].id;
    const upset = { ...g, homeId: bad, awayId: good };
    expect(gameNews(season, upset, result(), teams).map((n) => n.kind)).toContain("upset");
    expect(gameNews(season, upset, result({ home: 90, away: 100 }), teams).map((n) => n.kind)).not.toContain("upset");
  });

  it("a 50-point game makes the news", () => {
    const id = best(teams[1].id);
    const news = gameNews(f, g, result({ box: { [id]: { ...emptyLine(), pts: 52, min: 2000 } } }), teams);
    expect(news[0].kind).toBe("milestone");
    expect(news[0].text).toContain("52");
  });

  it("career milestones appear once", () => {
    const id = best(teams[1].id);
    const career = { seasons: 9, gp: 700, min: 1, pts: 9990, reb: 1, ast: 1, stl: 1, blk: 1, bestSeasonPts: 2000 };
    const x: Franchise = {
      ...f,
      players: { ...f.players, [id]: { ...f.players[id], file: { ...f.players[id].file!, career } } },
      season: { ...f.season, stats: { [id]: { ...emptyLine(), gp: 1, gs: 1, pts: 20 } } },
    };
    const crossed = gameNews(x, g, result({ box: { [id]: { ...emptyLine(), pts: 20, min: 2000 } } }), teams);
    expect(crossed.some((n) => n.text.includes("10,000"))).toBe(true);
    const after = { ...x, season: { ...x.season, stats: { [id]: { ...emptyLine(), gp: 2, gs: 2, pts: 40 } } } };
    expect(gameNews(after, g, result({ box: { [id]: { ...emptyLine(), pts: 20, min: 2000 } } }), teams).some((n) => n.text.includes("10,000"))).toBe(false);
  });
});

describe("the feed", () => {
  it("news stays under the limit, newest kept", () => {
    const items = Array.from({ length: NEWS_LIMIT + 50 }, (_, i) => ({ date: f.date, kind: "trade" as const, text: `item ${i}`, teamIds: [] }));
    const out = addNews(f, items);
    expect(out.news).toHaveLength(NEWS_LIMIT);
    expect(out.news.at(-1)!.text).toBe(`item ${NEWS_LIMIT + 49}`);
  });

  it("news ids stay unique across seasons", () => {
    const one = addNews(f, [{ date: "2026-11-01", kind: "trade", text: "a", teamIds: [] }]);
    const two = addNews(one, [{ date: "2027-11-01", kind: "trade", text: "a", teamIds: [] }]);
    expect(new Set(two.news.map((n) => n.id)).size).toBe(2);
  });

  it("the same item doesn't appear twice", () => {
    const item = { date: "2026-11-01", kind: "trade" as const, text: "a", teamIds: [] };
    expect(addNews(addNews(f, [item]), [item]).news).toHaveLength(1);
  });

  it("simDay fills the feed, and a replay gives the same news", () => {
    let a = make("replay");
    let b = make("replay");
    for (let i = 0; i < 40; i++) a = simDay(a, teams, { includeUser: true }).franchise;
    for (let i = 0; i < 40; i++) b = simDay(JSON.parse(JSON.stringify(b)), teams, { includeUser: true }).franchise;
    expect(a.news.length).toBeGreaterThan(0);
    expect(b.news).toEqual(a.news);
  });
});

describe("league events", () => {
  it("trades make the news", () => {
    const entry = {
      date: f.date,
      teams: [teams[1].id, teams[2].id],
      assets: [{ kind: "player" as const, id: best(teams[1].id), from: teams[1].id, to: teams[2].id }],
    };
    const [item] = tradeNews(f, entry, teams);
    expect(item.kind).toBe("trade");
    expect(item.text).toContain(f.players[best(teams[1].id)].lastName);
  });

  it("the user's trades are logged and reported", () => {
    const a = f.rosters[teams[0].id][0],
      b = f.rosters[teams[1].id][0];
    const paid = {
      ...f,
      players: { ...f.players, [a]: { ...f.players[a], contract: { salary: 5e6, years: 2 } }, [b]: { ...f.players[b], contract: { salary: 5e6, years: 2 } } },
    };
    const t: Trade = {
      teams: [teams[0].id, teams[1].id],
      assets: [
        { kind: "player", id: a, from: teams[0].id, to: teams[1].id },
        { kind: "player", id: b, from: teams[1].id, to: teams[0].id },
      ],
    };
    const done = userTrade(paid, t, teams);
    expect(done.tradeLog).toHaveLength(1);
    expect(done.news.map((n) => n.kind)).toContain("trade");
  });

  it("the champion and MVP make the news", () => {
    const x = finishedSeason(f, teams);
    const id = best(teams[29].id);
    const won = {
      ...x,
      season: { ...x.season, championId: teams[29].id, awards: [{ id: "mvp", label: "Most Valuable Player", playerId: id, teamId: teams[29].id }] },
    };
    const kinds = seasonNews(won, teams)
      .map((n) => n.text)
      .join(" ");
    expect(kinds).toContain(teams[29].name);
    expect(kinds).toContain(f.players[id].lastName);
  });

  it("the offseason reports the first pick, big signings and retirements, and a firing and new job", () => {
    let x: Franchise = { ...finishedSeason(f, teams), offseason: { step: "review", report: null }, job: { ...f.job, fired: { year: 2026, teamId: f.teamId } } };
    x = takeJob(x, jobOffers(x, teams)[0], teams);
    expect(x.news.map((n) => n.kind)).toContain("job");
    while (x.offseason?.step !== "camp") {
      if (x.offseason?.step === "draft") x = simDraftToEnd(x);
      x = advanceOffseason(staffHandles(x), teams);
    }
    expect(x.news.some((n) => n.kind === "draft")).toBe(true);
    expect(x.news.some((n) => n.kind === "signing")).toBe(true);
    expect(x.news.some((n) => n.kind === "retirement")).toBe(true);
  });
});
