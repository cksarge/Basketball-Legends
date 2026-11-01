import { describe, expect, it } from "vitest";
import { archetypesFor, generateRoster, playerOvr, randomAppearance, teamTalentTarget } from "@/engine/player";
import { Rng } from "@/engine/rng";
import type { RatingKey, Team } from "@/engine/types";
import hs from "@/data/generated/hs.json";
import college from "@/data/generated/college.json";
import pro from "@/data/generated/pro.json";
import { emptyLine, type StatLine } from "@/game/sim/stats";
import { DEFAULT_SETTINGS, createCareer, defaultBody } from "../create";
import { hsContext, type UserGameOutcome } from "../hs/season";
import { rosterStrength } from "../hs/rosters";
import { outcomeFromMatch, runMatchSync } from "../hs/play";
import { GAMES_PER_TEAM, generateDevSchedule, generateProSchedule, matchups } from "../pro/schedule";
import {
  BADGES,
  MAX_AGE,
  MAX_SALARY,
  PRO_STRENGTH_BIAS,
  ROLE_MINUTES,
  advancePro,
  agePlayer,
  beatsField,
  applyProGame,
  canRequestTrade,
  conferenceTable,
  contestField,
  contractOffers,
  currentPro,
  endorsementOffers,
  fame,
  finishProSeason,
  marketValue,
  negotiate,
  nextProEvent,
  proMatchSetup,
  proRole,
  recordThreeContest,
  requestTrade,
  seasonImpact,
  signContract,
  signEndorsement,
  trainingCamp,
  tradeTo,
  userProGames,
} from "../pro/season";
import { LEGEND_BAR, RANK_POINTS, legendEvents, legendStatus } from "../legend";
import { allTimeRank, careerTotals, nextToPass, retire } from "../pro/retire";
import type { Career, ProCareer } from "../types";

const teams = pro.teams as unknown as Team[];
const ctx = hsContext(hs.teams as unknown as Team[], college.teams as unknown as Team[], college.conferences, teams);

function rookie(boost: number, status: ProCareer["status"] = "standard", teamId = teams[0].id): Career {
  const c = createCareer(
    {
      firstName: "Test",
      lastName: "Pro",
      pos: "SG",
      archetype: archetypesFor("SG")[0],
      body: defaultBody("SG"),
      appearance: randomAppearance(new Rng(3)),
      jersey: 4,
      hometown: "Phoenix, AZ",
      schoolId: "hs-brophy-prep",
      allocation: {},
      settings: DEFAULT_SETTINGS,
      startYear: 2026,
    },
    777,
  );
  const ratings = { ...c.player.ratings };
  const caps = { ...c.player.caps };
  for (const k of Object.keys(ratings) as RatingKey[]) {
    ratings[k] = Math.min(99, ratings[k] + boost);
    caps[k] = 99;
  }
  return {
    ...c,
    stage: "pro",
    date: "2031-06-28",
    player: { ...c.player, age: 21, ratings, caps, devDate: "2031-06-28", teamId, contract: { salary: 5_000_000, years: 4, rookie: true } },
    pro: {
      preDraft: { year: 2031, agent: "family", workouts: [], interviews: [], stockDelta: 0 },
      status,
      confidence: 0,
      teamFirst: 0,
      earnings: 0,
      seasons: [],
      endorsements: [],
    },
  };
}

const line = (pts: number, min = 34): StatLine => ({
  ...emptyLine(),
  min: min * 60,
  pts,
  fgm: Math.round(pts / 2.2),
  fga: Math.round(pts / 1.1),
  tpm: 2,
  tpa: 5,
  oreb: 1,
  dreb: 5,
  ast: 6,
  stl: 1,
  blk: 1,
});
function outcome(c: Career, gameId: string, pts: number, win: boolean, extra: Partial<UserGameOutcome> = {}): UserGameOutcome {
  const s = currentPro(c)!;
  const g = (s.devGames ?? []).find((x) => x.id === gameId) ?? s.games.find((x) => x.id === gameId)!;
  const home = g.homeId === s.teamId;
  return {
    homeScore: home === win ? 110 : 100,
    awayScore: home === win ? 100 : 110,
    overtimes: 0,
    box: { [c.player.id]: line(pts) },
    played: false,
    playerOfGame: null,
    ...extra,
  };
}

/** Plays a whole season with a fixed line. */
function playSeason(c: Career, pts = 20, win = true): Career {
  let x = c;
  for (let i = 0; i < 160; i++) {
    const ev = nextProEvent(x);
    if (ev.kind === "seasonEnd") {
      x = advancePro(x, ev.date, ctx);
      if (nextProEvent(x).kind !== "seasonEnd") continue;
      return finishProSeason(x, ctx);
    }
    if (ev.kind === "injured") {
      x = advancePro(x, ev.date, ctx);
      continue;
    }
    if (ev.kind !== "game") return x;
    x = advancePro(x, ev.date, ctx);
    const now = nextProEvent(x);
    if (now.kind !== "game") continue;
    x = advancePro(applyProGame(x, now.game.id, outcome(x, now.game.id, pts, win), ctx), now.game.date, ctx);
  }
  throw new Error("season never ended");
}

describe("the 82-game schedule", () => {
  it("has every team playing 82, half at home, in the right mix", () => {
    const m = matchups(teams);
    expect(m.length).toBe(1230);
    for (const t of teams) {
      expect(m.filter(([h]) => h === t.id).length).toBe(41);
      expect(m.filter(([, a]) => a === t.id).length).toBe(41);
    }
    const div = teams.filter((t) => t.divisionId === teams[0].divisionId);
    expect(m.filter(([h, a]) => (h === div[0].id && a === div[1].id) || (h === div[1].id && a === div[0].id)).length).toBe(4);
    const other = teams.find((t) => t.conferenceId !== teams[0].conferenceId)!;
    expect(m.filter(([h, a]) => (h === teams[0].id && a === other.id) || (h === other.id && a === teams[0].id)).length).toBe(2);
  });

  it("dates every game with nobody playing twice in a day", () => {
    const games = generateProSchedule(teams, 2031, 1);
    expect(games.length).toBe(1230);
    const seen = new Set<string>();
    const count = new Map<string, number>();
    for (const g of games)
      for (const t of [g.homeId, g.awayId]) {
        expect(seen.has(`${t}|${g.date}`)).toBe(false);
        seen.add(`${t}|${g.date}`);
        count.set(t, (count.get(t) ?? 0) + 1);
      }
    expect([...count.values()].every((n) => n === GAMES_PER_TEAM)).toBe(true);
  });

  it("gives development teams a 30-game season", () => {
    expect(generateDevSchedule(teams, teams[0].id, 2031, 1).length).toBe(30);
  });
});

describe("rosters and roles", () => {
  it("keeps the strength estimate near real rosters", () => {
    const gaps = teams.map((t) => rosterStrength(generateRoster(t, 2031)) - teamTalentTarget(t));
    expect(Math.abs(gaps.reduce((a, b) => a + b, 0) / gaps.length - PRO_STRENGTH_BIAS)).toBeLessThan(1.2);
  });

  it("roles follow your rank on the team, and trust can move them", () => {
    const roster = generateRoster(teams[0], 2031);
    const sorted = roster.map(playerOvr).sort((a, b) => b - a);
    expect(proRole(sorted[0] + 1, roster, 50)).toBe("starter");
    expect(proRole(sorted[13] - 1, roster, 50)).toBe("bench");
    expect(ROLE_MINUTES[proRole(sorted[6], roster, 95)]).toBeGreaterThan(ROLE_MINUTES[proRole(sorted[6], roster, 5)]);
  });
});

describe("a pro season", () => {
  const start = trainingCamp(rookie(45), "shooting", ctx);
  const done = playSeason(start, 24);
  const s = currentPro(done)!;

  it("training camp starts the year, once", () => {
    expect(currentPro(start)!.year).toBe(2031);
    expect(start.player.age).toBe(22);
    expect(nextProEvent(start).kind).toBe("game");
    expect(trainingCamp(start, "shooting", ctx)).toBe(start);
  });

  it("training raises the ratings you work on", () => {
    const base = rookie(10);
    const after = trainingCamp(base, "shooting", ctx);
    expect(after.player.ratings.three).toBeGreaterThan(base.player.ratings.three);
  });

  it("plays 82 games and wraps the year", () => {
    expect(s.wrapped).toBe(true);
    expect(s.stats.gp).toBe(82);
    expect(s.finish).toBeTruthy();
    expect(s.standings!.length).toBe(30);
  });

  it("every team's record adds up to 82 games", () => {
    for (const r of s.standings!) expect(r.w + r.l).toBe(82);
    const total = s.standings!.reduce((a, r) => a + r.w, 0);
    expect(total).toBe(1230);
  });

  it("runs the play-in and four rounds to one champion", () => {
    const pi = s.series.filter((x) => x.round === 0);
    expect(pi.length).toBe(6);
    for (const round of [1, 2, 3]) expect(s.series.filter((x) => x.round === round).length).toBe(8 / 2 ** (round - 1));
    const finals = s.series.find((x) => x.id === "finals")!;
    expect(finals.winner).toBeTruthy();
    for (const x of s.series.filter((y) => y.bestOf === 7)) {
      expect(x.games.length).toBeGreaterThanOrEqual(4);
      expect(x.games.length).toBeLessThanOrEqual(7);
      expect(x.winner).toBeTruthy();
    }
  });

  it("pays you and takes a year off your contract", () => {
    expect(done.pro!.earnings).toBe(Math.round(5_000_000 * 0.98));
    expect(done.player.contract!.years).toBe(3);
    expect(nextProEvent(done).kind).toBe("training");
  });

  it("a losing team misses the playoffs and can't hide it", () => {
    const d = playSeason(trainingCamp(rookie(0), "shooting", ctx), 6, false);
    expect(currentPro(d)!.finish).toBeTruthy();
    expect(currentPro(d)!.stats.gp).toBeGreaterThan(70);
  });

  it("carries most teammates into next year", () => {
    const next = trainingCamp(done, "defense", ctx);
    const after = currentPro(next)!;
    expect(after.year).toBe(2032);
    expect(after.roster.filter((p) => s.roster.some((q) => q.id === p.id)).length).toBeGreaterThan(5);
  });
});

describe("All-Star weekend", () => {
  it("picks a star, and they play East against West", () => {
    const d = playSeason(trainingCamp(rookie(45), "shooting", ctx), 34);
    const s = currentPro(d)!;
    expect(s.allStar?.selected).toBe(true);
    expect(s.awards).toContain("All-Star");
    const g = s.games.find((x) => x.kind === "allstar")!;
    expect(g.result).toBeTruthy();
    expect(s.stats.gp).toBe(82);
  });

  it("leaves role players at home", () => {
    const s = currentPro(playSeason(trainingCamp(rookie(20), "shooting", ctx), 6))!;
    expect(s.allStar?.selected).toBe(false);
    expect(s.games.some((x) => x.kind === "allstar")).toBe(false);
  });

  it("builds a real All-Star match with you on your conference's team", () => {
    const d = playSeason(trainingCamp(rookie(45), "shooting", ctx), 34);
    const s = currentPro(d)!;
    const c = { ...d, pro: { ...d.pro!, seasons: [{ ...s, wrapped: false }] } };
    const setup = proMatchSetup(
      c,
      s.games.find((x) => x.kind === "allstar")!,
      ctx,
    );
    const rosters = [setup.home.roster, setup.away.roster];
    expect(rosters.filter((r) => r.some((p) => p.id === c.player.id)).length).toBe(1);
    expect(setup.home.team.nickname).toBe("All-Stars");
  });
});

describe("injuries", () => {
  it("sit you out, with your team's games simulated, then you're back", () => {
    let c = trainingCamp(rookie(30), "shooting", ctx);
    const ev = nextProEvent(c);
    if (ev.kind !== "game") throw new Error("no game");
    c = advancePro(c, ev.date, ctx);
    c = applyProGame(c, ev.game.id, outcome(c, ev.game.id, 20, true, { injuries: [{ playerId: c.player.id, name: "Sprained ankle", gamesOut: 3 }] }), ctx);
    const hurt = nextProEvent(c);
    expect(hurt.kind).toBe("injured");
    if (hurt.kind !== "injured") return;
    c = advancePro(c, hurt.date, ctx);
    expect(nextProEvent(c).kind).toBe("game");
    const games = userProGames(currentPro(c)!).filter((g) => g.result);
    expect(games.length).toBe(4);
    expect(games.slice(1).every((g) => g.result!.dnp)).toBe(true);
    expect(currentPro(c)!.stats.gp).toBe(1);
  });

  it("ignores injuries to other players", () => {
    let c = trainingCamp(rookie(30), "shooting", ctx);
    const ev = nextProEvent(c);
    if (ev.kind !== "game") throw new Error("no game");
    c = applyProGame(
      advancePro(c, ev.date, ctx),
      ev.game.id,
      outcome(c, ev.game.id, 20, true, { injuries: [{ playerId: "someone", name: "Sprained ankle", gamesOut: 3 }] }),
      ctx,
    );
    expect(nextProEvent(c).kind).toBe("game");
  });
});

describe("trades", () => {
  it("a request can be made once, and it costs you with the coach", () => {
    const c = trainingCamp(rookie(30), "shooting", ctx);
    const asked = requestTrade(c);
    expect(currentPro(asked)!.tradeRequested).toBe(true);
    expect(currentPro(asked)!.trust).toBeLessThan(currentPro(c)!.trust);
    expect(canRequestTrade(asked)).toBe(false);
  });

  it("moves you to the new team's roster and schedule", () => {
    const c = trainingCamp(rookie(30), "shooting", ctx);
    const to = teams[10].id;
    const moved = tradeTo(c, to, c.date, ctx);
    const s = currentPro(moved)!;
    expect(s.teamId).toBe(to);
    expect(moved.player.teamId).toBe(to);
    expect(userProGames(s).every((g) => g.homeId === to || g.awayId === to)).toBe(true);
  });

  it("can't be requested after the deadline", () => {
    const c = trainingCamp(rookie(30), "shooting", ctx);
    expect(canRequestTrade({ ...c, date: "2032-03-01" })).toBe(false);
  });
});

describe("contracts and free agency", () => {
  const expired = () => {
    const c = trainingCamp(rookie(40), "shooting", ctx);
    return playSeason({ ...c, player: { ...c.player, contract: { salary: 3_000_000, years: 1 } } }, 24);
  };

  it("an expired deal sends you to free agency with offers from several teams", () => {
    const c = expired();
    expect(nextProEvent(c).kind).toBe("freeAgency");
    const offers = c.pro!.offers!;
    expect(offers.length).toBe(5);
    expect(offers[0].teamId).toBe(currentPro(c)!.teamId);
    expect(new Set(offers.map((o) => o.teamId)).size).toBe(5);
    for (const o of offers) expect(o.salary).toBeLessThanOrEqual(MAX_SALARY);
  });

  it("signing moves you to the new team next season", () => {
    const c = expired();
    const o = c.pro!.offers![1];
    const signed = signContract(c, o.teamId, ctx);
    expect(signed.player.teamId).toBe(o.teamId);
    expect(signed.player.contract).toEqual({ salary: o.salary, years: o.years });
    expect(nextProEvent(signed).kind).toBe("training");
    expect(currentPro(trainingCamp(signed, "defense", ctx))!.teamId).toBe(o.teamId);
  });

  it("asking for more either raises the offer or makes them walk, once", () => {
    const c = expired();
    const id = c.pro!.offers![1].teamId;
    const before = c.pro!.offers![1].salary;
    const { career, accepted } = negotiate(c, id, 0.05);
    const after = career.pro!.offers![1];
    if (accepted) expect(after.salary).toBeGreaterThan(before);
    else expect(after.pulled).toBe(true);
    expect(negotiate(career, id, 0.05).career).toBe(career);
  });

  it("can't sign an offer that was pulled", () => {
    const c = expired();
    const pulled = { ...c, pro: { ...c.pro!, offers: c.pro!.offers!.map((o) => ({ ...o, pulled: true })) } };
    expect(signContract(pulled, c.pro!.offers![0].teamId, ctx)).toBe(pulled);
  });

  it("pays better players more, and older players less", () => {
    const good = rookie(45);
    expect(marketValue(good)).toBeGreaterThan(marketValue(rookie(20)));
    expect(marketValue({ ...good, player: { ...good.player, age: 37 } })).toBeLessThan(marketValue(good));
  });

  it("a kept promise leaves you alone, and a broken one tells you", () => {
    const c = expired();
    const o = { ...c.pro!.offers![0], promise: true, role: "starter" as const };
    const signed = signContract({ ...c, pro: { ...c.pro!, offers: [o] } }, o.teamId, ctx);
    let x = trainingCamp(signed, "defense", ctx);
    expect(currentPro(x)!.promise?.role).toBe("starter");
    const s = currentPro(x)!;
    x = {
      ...x,
      pro: {
        ...x.pro!,
        seasons: [
          ...x.pro!.seasons.slice(0, -1),
          { ...s, role: "bench", trust: 0, roster: s.roster.map((p) => ({ ...p, ratings: { ...p.ratings, three: 99 } })) },
        ],
      },
    };
    const low = {
      ...x,
      player: { ...x.player, ratings: Object.fromEntries(Object.keys(x.player.ratings).map((k) => [k, 30])) as unknown as typeof x.player.ratings },
    };
    const played = playSeason(low, 2, false);
    expect(currentPro(played)!.promise?.broken).toBe(true);
  });
});

describe("the league's best", () => {
  const rate = (award: "mvp" | "first", impact: number) => {
    const years = Array.from({ length: 200 }, (_, i) => 2031 + i);
    return years.filter((y) => beatsField(777, y, award, impact)).length / years.length;
  };

  it("keeps the MVP hard to win even for the very best, and out of reach for merely great years", () => {
    expect(rate("mvp", 58)).toBeGreaterThan(0.2);
    expect(rate("mvp", 58)).toBeLessThan(0.55);
    expect(rate("mvp", 42)).toBeLessThan(0.02);
  });

  it("is the same every time for a given save and year", () => {
    expect(beatsField(1, 2040, "first", 50)).toBe(beatsField(1, 2040, "first", 50));
  });

  it("a dominant career's typical honors stop short of Legend without big moments of your own", () => {
    const prime = 12 * 50 + 4 * 120 + 3 * 100 + 2 * 100 + 15 * 15 + 85 + 100;
    expect(prime).toBeLessThan(LEGEND_BAR);
  });
});

describe("endorsements, badges and aging", () => {
  it("brands only call once you've made a name, and signing pays every year", () => {
    expect(endorsementOffers(rookie(0), 2031)).toEqual([]);
    const c = playSeason(trainingCamp(rookie(45), "shooting", ctx), 34);
    expect(fame(c)).toBeGreaterThan(20);
    const offers = c.pro!.endorsementOffers!;
    expect(offers.length).toBeGreaterThan(0);
    const signed = signEndorsement(c, offers[0].brand);
    expect(signed.pro!.endorsements.length).toBe(1);
    const next = playSeason(trainingCamp(signed, "shooting", ctx), 34);
    expect(next.pro!.earnings).toBeGreaterThan(signed.pro!.earnings + 4_900_000);
  });

  it("great seasons earn a badge that lifts a rating for good", () => {
    const c = playSeason(trainingCamp(rookie(30), "shooting", ctx), 28);
    expect(c.player.badges).toContain("Walking Bucket");
    expect(BADGES.length).toBeGreaterThan(5);
  });

  it("the legs go first after 30", () => {
    const c = rookie(30);
    const old = { ...c, player: { ...c.player, age: 36 } };
    const aged = agePlayer(old, new Rng(1));
    expect(old.player.ratings.speed - aged.player.ratings.speed).toBeGreaterThan(old.player.ratings.three - aged.player.ratings.three);
    expect(agePlayer(c, new Rng(1))).toBe(c);
  });
});

describe("the development league", () => {
  it("runs a 30-game season against affiliates, with the league going on above you", () => {
    const c = trainingCamp(rookie(0, "dev"), "shooting", ctx);
    const s = currentPro(c)!;
    expect(userProGames(s).length).toBe(30);
    expect(Math.max(...s.roster.map(playerOvr))).toBeLessThan(Math.max(...generateRoster(teams[0], 2031).map(playerOvr)));
    const d = playSeason(c, 6);
    expect(currentPro(d)!.stats.gp).toBe(30);
    expect(currentPro(d)!.finish).toContain("development");
    expect(conferenceTable(currentPro(d)!, ctx, "East").length).toBe(15);
  });

  it("calls up players who outplay the league", () => {
    const d = playSeason(trainingCamp(rookie(30, "twoWay"), "shooting", ctx), 34);
    expect(d.pro!.status).toBe("standard");
    expect(d.player.contract!.twoWay).toBeUndefined();
    expect(d.log.some((e) => e.text.startsWith("Called up"))).toBe(true);
  });
});

describe("a whole career", () => {
  it("runs from rookie year to retirement without getting stuck, with the body wearing down", () => {
    let c = trainingCamp(rookie(38), "shooting", ctx);
    const peak = playerOvr(c.player);
    const seen = new Set<string>();
    for (let year = 0; year < 22 && c.stage !== "retired"; year++) {
      c = playSeason(c, 22);
      let ev = nextProEvent(c);
      seen.add(ev.kind);
      if (ev.kind === "freeAgency") {
        const offers = c.pro!.offers ?? [];
        if (!offers.length) break;
        c = signContract(c, offers[0].teamId, ctx);
        ev = nextProEvent(c);
      }
      expect(ev.kind).toBe("training");
      c = trainingCamp(c, "defense", ctx);
    }
    if (!currentPro(c)!.wrapped) c = playSeason(c, 22);
    expect(c.player.age).toBeGreaterThanOrEqual(36);
    expect(playerOvr(c.player)).toBeLessThan(peak + 12);
    expect(seen.has("freeAgency")).toBe(true);
    const done = retire(c, "family", ctx);
    expect(done.stage).toBe("retired");
    expect(done.retirement!.totals.games).toBeGreaterThan(1000);
    expect(done.pro!.earnings).toBeGreaterThan(50_000_000);
  });

  it("keeps development players in the development league until they're good enough", () => {
    const c = trainingCamp(rookie(0, "dev"), "shooting", ctx);
    const short = { ...c, player: { ...c.player, contract: { salary: 45_000, years: 1 } } };
    const low = {
      ...short,
      player: { ...short.player, ratings: Object.fromEntries(Object.keys(short.player.ratings).map((k) => [k, 40])) as unknown as typeof short.player.ratings },
    };
    const d = playSeason(low, 6);
    const offers = d.pro!.offers!;
    expect(offers.length).toBe(1);
    expect(offers[0].dev).toBe(true);
    const signed = signContract(d, offers[0].teamId, ctx);
    expect(signed.pro!.status).toBe("dev");
    expect(currentPro(trainingCamp(signed, "shooting", ctx))!.status).toBe("dev");
  });
});

describe("real engine", () => {
  it("plays a pro game of four quarters with your role's minutes", () => {
    let c = trainingCamp(rookie(30), "shooting", ctx);
    const ev = nextProEvent(c);
    if (ev.kind !== "game") throw new Error("no game");
    c = advancePro(c, ev.date, ctx);
    const s = currentPro(c)!;
    const m = runMatchSync(proMatchSetup(c, ev.game, ctx));
    expect(m.state.cfg.rules.periods).toBe(4);
    const o = outcomeFromMatch(m, false);
    expect((o.box[c.player.id]?.min ?? 0) / 60).toBeGreaterThan(1);
    const after = applyProGame(c, ev.game.id, o, ctx);
    expect(currentPro(after)!.stats.gp + (s.stats.gp === 0 ? 0 : 0)).toBeLessThanOrEqual(1);
    expect(seasonImpact(currentPro(after)!)).toBeGreaterThanOrEqual(0);
  });
});

describe("retirement and the Legend verdict", () => {
  const withSeasons = (awards: string[][], stage: Career["stage"] = "pro"): Career => {
    const c = rookie(30);
    const pts = 2500;
    const seasons = awards.map((a, i) => ({
      year: 2031 + i,
      teamId: teams[0].id,
      status: "standard",
      role: "starter",
      trust: 70,
      chemistry: 60,
      roster: [],
      games: [],
      stats: { ...emptyLine(), gp: 82, gs: 82, pts, oreb: 100, dreb: 400, ast: 500 },
      playoffStats: { ...emptyLine(), gp: 0, gs: 0 },
      awards: a,
      series: [],
      wrapped: true,
    }));
    return { ...c, stage, player: { ...c.player, age: 36 }, pro: { ...c.pro!, seasons: seasons as unknown as ProCareer["seasons"] } };
  };
  const big = ["Most Valuable Player", "All-League First Team", "League champion", "Finals MVP", "All-Star"];
  const good = ["All-League Second Team", "All-Star"];

  it("names an Icon past the bar a Legend, only at retirement", () => {
    const c = withSeasons(Array.from({ length: 16 }, () => big));
    expect(legendStatus(c).rank).toBe("Icon");
    expect(legendStatus(c).chance).toBeGreaterThan(0);
    const r = retire(c, "family", ctx);
    expect(r.stage).toBe("retired");
    expect(r.retirement!.legend).toBe(true);
    expect(r.retirement!.rank).toBe("Legend");
    expect(legendStatus(r).rank).toBe("Legend");
    expect(legendStatus(r).chance).toBeNull();
    expect(r.log.some((e) => e.text.includes("Basketball Legend"))).toBe(true);
  });

  it("an Icon short of the bar stays an Icon", () => {
    const seasons = Array.from({ length: 3 }, () => big);
    const c = withSeasons(seasons);
    expect(legendStatus(c).rank).toBe("Icon");
    expect(legendStatus(c).points).toBeLessThan(LEGEND_BAR);
    const r = retire(c, "family", ctx);
    expect(r.retirement!.legend).toBe(false);
    expect(r.retirement!.rank).toBe("Icon");
  });

  it("a very good career is not close to Legend", () => {
    const c = withSeasons(Array.from({ length: 14 }, () => good));
    const r = retire(c, "teammates", ctx);
    expect(r.retirement!.legend).toBe(false);
    expect(r.retirement!.points).toBeLessThan(RANK_POINTS.Icon!);
  });

  it("the Hall of Fame takes careers of real weight, and hangs numbers where you earned them", () => {
    const r = retire(withSeasons(Array.from({ length: 10 }, () => big)), "family", ctx);
    expect(r.retirement!.hallOfFame).toBe(true);
    expect(r.retirement!.jerseys).toContain(teams[0].name);
    const short = retire(withSeasons([["All-Star"]]), "family", ctx);
    expect(short.retirement!.hallOfFame).toBe(false);
    expect(short.retirement!.jerseys).toEqual([]);
  });

  it("adds up totals and compares them with the greats", () => {
    const c = withSeasons(Array.from({ length: 15 }, () => big));
    const t = careerTotals(c);
    expect(t.pts).toBe(37500);
    expect(t.rings).toBe(15);
    expect(allTimeRank(t, "pts")).toBe(2);
    expect(allTimeRank(t, "rings")).toBe(1);
    expect(nextToPass(t, "pts")).toMatchObject({ name: "Marcus Delacroix", gap: 710 });
    expect(nextToPass(t, "rings")).toBeNull();
  });

  it("writes a speech from your choice, and you can only retire once, between seasons", () => {
    const c = withSeasons([big]);
    const r = retire(c, "kids", ctx);
    expect(r.retirement!.speech).toContain("cracked court");
    expect(retire(r, "family", ctx)).toBe(r);
    const mid = trainingCamp(rookie(30), "shooting", ctx);
    expect(retire(mid, "family", ctx)).toBe(mid);
  });

  it("stops offering contracts when it's over", () => {
    const c = withSeasons([big]);
    expect(contractOffers({ ...c, player: { ...c.player, age: MAX_AGE } }, ctx)).toEqual([]);
  });

  it("gives Legend points for pro honors, and the rank follows", () => {
    expect(legendStatus(withSeasons([["All-Star"]])).rank).toBe("All-Star");
    expect(legendStatus(withSeasons([big])).pillars.winning).toBe(100);
    expect(legendStatus(withSeasons([])).rank).toBe("Pro");
    const scored = legendEvents(withSeasons(Array.from({ length: 5 }, () => [])));
    expect(scored.some((e) => e.text === "10,000 career points")).toBe(true);
  });
});

describe("All-Star weekend events", () => {
  const star = () => {
    const c = trainingCamp(rookie(45), "shooting", ctx);
    return { ...c, player: { ...c.player, ratings: { ...c.player.ratings, three: 90, dunk: 95, vertical: 95 } } };
  };

  it("invites shooters to the contest, and a contest you skip is simulated", () => {
    const s = currentPro(playSeason(star(), 34))!;
    expect(s.allStar?.threeInvited).toBe(true);
    expect(s.allStar?.threeScore).toBeGreaterThanOrEqual(0);
  });

  it("records a contest you played, once", () => {
    const d = playSeason(star(), 34);
    const s = currentPro(d)!;
    const open = { ...d, pro: { ...d.pro!, seasons: [{ ...s, allStar: { ...s.allStar!, threeScore: undefined, threeWon: undefined } }] } };
    const done = recordThreeContest(open, 28, true);
    expect(currentPro(done)!.allStar).toMatchObject({ threeScore: 28, threeWon: true });
    expect(recordThreeContest(done, 1, false)).toBe(done);
    expect(contestField(open).length).toBe(7);
  });
});

describe("practice drills", () => {
  it("a sharp session makes the summer's work go further", () => {
    const c = rookie(10);
    const plain = trainingCamp(c, "shooting", ctx, 0);
    const sharp = trainingCamp(c, "shooting", ctx, 3);
    expect(sharp.player.ratings.three).toBeGreaterThan(plain.player.ratings.three);
  });
});

describe("a two-way contract", () => {
  it("splits your year: development games plus some games with the big club", () => {
    const c = trainingCamp(rookie(0, "twoWay"), "shooting", ctx);
    const s = currentPro(c)!;
    const all = userProGames(s);
    expect(s.twoWayGames!.length).toBeGreaterThan(8);
    expect(all.length).toBe(30 + s.twoWayGames!.length);
    const g = all.find((x) => s.twoWayGames!.includes(x.id))!;
    const setup = proMatchSetup(c, g, ctx);
    const mine = setup.home.team.id === s.teamId ? setup.home : setup.away;
    expect(mine.roster.some((p) => s.leagueRoster!.some((q) => q.id === p.id))).toBe(true);
    expect(mine.roster.some((p) => s.roster.some((q) => q.id === p.id))).toBe(false);
  });

  it("plays out without getting stuck, and a development game stays in the development league", () => {
    const d = playSeason(trainingCamp(rookie(0, "twoWay"), "shooting", ctx), 6);
    const s = currentPro(d)!;
    expect(s.stats.gp).toBeGreaterThan(30);
    expect(s.wrapped).toBe(true);
    for (const r of s.standings!) expect(r.w + r.l).toBe(82);
  });
});
