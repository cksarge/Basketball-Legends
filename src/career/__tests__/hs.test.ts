import { describe, expect, it } from "vitest";
import { archetypesFor, playerOvr, randomAppearance } from "@/engine/player";
import { Rng } from "@/engine/rng";
import type { Team } from "@/engine/types";
import hs from "@/data/generated/hs.json";
import { addDays, datesOn, daysBetween, hsCalendar, iso, onOrAfter, schoolYearOf, weekday } from "../calendar";
import { DEFAULT_SETTINGS, createCareer, defaultBody } from "../create";
import { HOLIDAY_GAMES, REGULAR_TARGET, generateVarsitySchedule, roundRobin, teamGames } from "../hs/schedule";
import { LEVEL_SIZE, estimatedStrength, levelRoster, rollRosters, rosterStrength, schoolLevels } from "../hs/rosters";
import { HOME_EDGE, MARGIN_PER_POINT, homeWinProb, powerRatings, ranked, simScore, standings } from "../hs/sim";
import { OPEN_SIZE, advanceBracket, createBrackets, roundName, winnerOf } from "../hs/playoffs";
import {
  XP_PER_POINT,
  advanceTo,
  applyShowcaseGame,
  goToCamp,
  prepareShowcase,
  showcaseSetup,
  startNextYear,
  takeFinals,
  setFocus,
  rerank,
  applyTryout,
  applyUserGame,
  checkLevelMove,
  currentSeason,
  develop,
  finishSeason,
  hsContext,
  levelCutoff,
  nextEvent,
  placeAtTryout,
  spendPoint,
  startSeason,
  upgradeCost,
  userGames,
  userMatchSetup,
  withUser,
  type UserGameOutcome,
} from "../hs/season";
import type { Career, ScheduledGame } from "../types";
import { ELIGIBLE_GPA, finalsQuiz, gpaLabel, practiceMultiplier, semesterGpa } from "../hs/academics";
import { MAX_EXPOSURE, nationalRank, rankCareer, starsFor, stateRank } from "../hs/rankings";
import { CAMPS, campsFor, showcaseExposure } from "../hs/summer";
import { emptyLine } from "@/game/sim/stats";

const teams = hs.teams as unknown as Team[];
const ctx = hsContext(teams);
const byId = ctx.byId;
const brophy = byId.get("hs-brophy-prep")!;
const smallSchool = teams.find((t) => !(t.levels ?? []).includes("jv") && !(t.levels ?? []).includes("frso"))!;
const schedule2026 = generateVarsitySchedule(teams, 2026);

function career(schoolId = brophy.id, alloc = {}): Career {
  return createCareer(
    {
      firstName: "Test",
      lastName: "Player",
      pos: "SG",
      archetype: archetypesFor("SG")[0],
      body: defaultBody("SG"),
      appearance: randomAppearance(new Rng(3)),
      jersey: 4,
      hometown: "Phoenix, AZ",
      schoolId,
      allocation: alloc,
      settings: DEFAULT_SETTINGS,
      startYear: 2026,
    },
    777,
  );
}

/** A quick fake outcome for one of your games (no real engine needed). */
function outcome(c: Career, g: ScheduledGame, pts: number, win = true): UserGameOutcome {
  const s = currentSeason(c)!;
  const home = g.homeId === s.schoolId;
  return {
    homeScore: home === win ? 60 : 50,
    awayScore: home === win ? 50 : 60,
    overtimes: 0,
    box: { [c.player.id]: { ...emptyLine(), min: 20 * 60, pts, fgm: Math.floor(pts / 2), fga: pts, dreb: 4, ast: 3 } },
    played: false,
    playerOfGame: null,
  };
}

describe("calendar", () => {
  it("does day math without time zone drift", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(daysBetween("2026-11-01", "2026-12-01")).toBe(30);
    expect(weekday("2026-10-28")).toBe(3); // a Wednesday
    expect(onOrAfter("2026-10-28", 1)).toBe("2026-11-02");
    expect(datesOn("2026-11-02", "2026-11-08", [2, 5])).toEqual(["2026-11-03", "2026-11-06"]);
    expect(iso(2026, 13, 1)).toBe("2027-01-01");
  });

  it("lays out a season in order: tryouts, games, holidays, region play, playoffs", () => {
    const c = hsCalendar(2026);
    const order = [c.tryouts, c.firstGame, c.holidayStart, c.regionStart, c.lastRegular, c.playIn, ...c.playoffRounds, c.seasonEnd];
    expect([...order].sort()).toEqual(order);
    expect(weekday(c.tryouts)).toBe(1);
    expect(schoolYearOf("2027-02-01")).toBe(2026);
    expect(schoolYearOf("2026-08-01")).toBe(2026);
  });
});

describe("round robin and schedules", () => {
  it("round robin pairs everyone exactly once", () => {
    for (const n of [3, 6, 7, 10]) {
      const items = Array.from({ length: n }, (_, i) => i);
      const pairs = roundRobin(items).flat();
      expect(pairs).toHaveLength((n * (n - 1)) / 2);
      expect(new Set(pairs.map(([a, b]) => [a, b].sort().join("-"))).size).toBe(pairs.length);
    }
  });

  it("every school gets a full season with no double bookings", () => {
    for (const t of teams) {
      const g = teamGames(schedule2026, t.id);
      expect(new Set(g.map((x) => x.date)).size).toBe(g.length);
      expect(g.filter((x) => x.kind !== "tournament").length).toBeGreaterThanOrEqual(REGULAR_TARGET - 2);
      expect(g.filter((x) => x.kind === "tournament").length).toBeLessThanOrEqual(HOLIDAY_GAMES);
    }
  });

  it("region games are only between region members and fall in region season", () => {
    const cal = hsCalendar(2026);
    for (const g of schedule2026.filter((x) => x.kind === "region")) {
      expect(byId.get(g.homeId)!.conferenceId).toBe(byId.get(g.awayId)!.conferenceId);
      expect(g.date >= cal.regionStart && g.date <= cal.lastRegular).toBe(true);
    }
    for (const g of schedule2026.filter((x) => x.kind === "nonregion")) expect(byId.get(g.homeId)!.conferenceId).not.toBe(byId.get(g.awayId)!.conferenceId);
  });

  it("small regions play home and away; big ones once", () => {
    const counts = new Map<string, number>();
    for (const g of schedule2026.filter((x) => x.kind === "region" && x.homeId === brophy.id)) counts.set(g.awayId, (counts.get(g.awayId) ?? 0) + 1);
    const regionSize = teams.filter((t) => t.conferenceId === brophy.conferenceId).length;
    expect(regionSize).toBeLessThan(8);
    expect(teamGames(schedule2026, brophy.id).filter((x) => x.kind === "region")).toHaveLength((regionSize - 1) * 2);
  });

  it("is deterministic for a seed and different across seeds", () => {
    expect(generateVarsitySchedule(teams, 2026).map((g) => g.id + g.homeId)).toEqual(schedule2026.map((g) => g.id + g.homeId));
    expect(generateVarsitySchedule(teams, 2026, "other").map((g) => g.homeId)).not.toEqual(schedule2026.map((g) => g.homeId));
  });
});

describe("rosters", () => {
  it("levels follow the school's real teams", () => {
    expect(schoolLevels(brophy)).toEqual(["frso", "jv", "varsity"]);
    expect(schoolLevels(smallSchool)).toEqual(["varsity"]);
  });

  it("generates the same roster for the same school, level and year", () => {
    const sig = (r: ReturnType<typeof levelRoster>) => r.map((p) => `${p.firstName} ${p.lastName} ${playerOvr(p)} ${p.jersey}`);
    expect(sig(levelRoster(brophy, "jv", 2026))).toEqual(sig(levelRoster(brophy, "jv", 2026)));
    expect(levelRoster(brophy, "frso", 2026).every((p) => p.classYear === "FR" || p.classYear === "SO")).toBe(true);
    expect(levelRoster(brophy, "varsity", 2026)).toHaveLength(LEVEL_SIZE.varsity);
  });

  it("varsity is stronger than JV, which is stronger than FR/SO", () => {
    const v = rosterStrength(levelRoster(brophy, "varsity", 2026));
    const j = rosterStrength(levelRoster(brophy, "jv", 2026));
    const f = rosterStrength(levelRoster(brophy, "frso", 2026));
    expect(v).toBeGreaterThan(j);
    expect(j).toBeGreaterThan(f);
  });

  it("the strength estimate tracks real rosters", () => {
    let err = 0;
    const sample = teams.slice(0, 60);
    for (const t of sample) err += estimatedStrength(t, "varsity", 2026) - rosterStrength(levelRoster(t, "varsity", 2026));
    expect(Math.abs(err / sample.length)).toBeLessThan(1.5);
  });

  it("rolling to the next year graduates seniors and moves everyone up a class", () => {
    const prev = Object.fromEntries(schoolLevels(brophy).map((l) => [l, levelRoster(brophy, l, 2026)]));
    const next = rollRosters(brophy, prev, 2027);
    const all = Object.values(next).flat();
    const prevSeniors = new Set(
      Object.values(prev)
        .flat()
        .filter((p) => p.classYear === "SR")
        .map((p) => p.id),
    );
    expect(all.some((p) => prevSeniors.has(p.id))).toBe(false);
    const juniors = Object.values(prev)
      .flat()
      .filter((p) => p.classYear === "JR");
    for (const j of juniors) {
      const now = all.find((p) => p.id === j.id);
      if (now) expect(now.classYear).toBe("SR");
    }
    for (const l of schoolLevels(brophy)) expect(next[l]!.length).toBe(LEVEL_SIZE[l]);
    expect(next.frso!.every((p) => p.classYear === "FR" || p.classYear === "SO")).toBe(true);
  });

  it("adds your player to a roster without duplicate numbers", () => {
    const r = levelRoster(brophy, "jv", 2026);
    const user = { ...r[0], id: "me", jersey: r[3].jersey };
    const withMe = withUser(r, user);
    expect(withMe).toHaveLength(r.length + 1);
    expect(new Set(withMe.map((p) => p.jersey)).size).toBe(withMe.length);
  });
});

describe("score model and standings", () => {
  it("home edge and strength gap move the win chance the right way", () => {
    expect(homeWinProb(0)).toBeGreaterThan(0.5);
    expect(homeWinProb(0, true)).toBeCloseTo(0.5, 5);
    expect(homeWinProb(5)).toBeGreaterThan(homeWinProb(0));
    expect(homeWinProb(-10)).toBeLessThan(0.25);
  });

  it("simulated scores match the fitted model on average and never tie", () => {
    const rng = new Rng(9);
    let margin = 0;
    for (let i = 0; i < 4000; i++) {
      const r = simScore(55, 50, rng);
      expect(r.home).not.toBe(r.away);
      expect(r.home).toBeGreaterThan(15);
      margin += r.home - r.away;
    }
    expect(Math.abs(margin / 4000 - (HOME_EDGE + MARGIN_PER_POINT * 5))).toBeLessThan(1);
  });

  it("standings count wins, region records and streaks", () => {
    const g = (id: string, h: string, a: string, hs_: number, as_: number, kind: ScheduledGame["kind"] = "region"): ScheduledGame => ({
      id,
      date: `2027-01-0${id}`,
      level: "varsity",
      homeId: h,
      awayId: a,
      kind,
      result: { home: hs_, away: as_, played: false, overtimes: 0 },
    });
    const games = [g("1", "a", "b", 60, 50), g("2", "b", "a", 55, 50), g("3", "a", "c", 70, 40, "nonregion"), g("4", "c", "a", 40, 42)];
    const t = standings(games, ["a", "b", "c"]);
    expect(t.get("a")).toMatchObject({ w: 3, l: 1, rw: 2, rl: 1, streak: 2 });
    expect(t.get("b")).toMatchObject({ w: 1, l: 1 });
    expect(ranked(games, ["a", "b", "c"])[0]).toBe("a");
    expect(powerRatings(games, ["a", "b", "c"]).get("c")).toBeLessThan(powerRatings(games, ["a", "b", "c"]).get("a")!);
  });
});

describe("playoffs", () => {
  const rng = new Rng(4);
  const played = schedule2026.map((g) => ({
    ...g,
    result: simScore(estimatedStrength(byId.get(g.homeId)!, "varsity", 2026), estimatedStrength(byId.get(g.awayId)!, "varsity", 2026), rng),
  }));
  const brackets = createBrackets(teams, played);

  it("builds an Open Division and a bracket per class, with no team in two brackets", () => {
    expect(brackets.map((b) => b.id)).toEqual(["open", "6a", "5a", "4a", "3a", "2a", "1a"]);
    expect(brackets[0].seeds).toHaveLength(OPEN_SIZE);
    const all = brackets.flatMap((b) => b.seeds);
    expect(new Set(all).size).toBe(all.length);
    for (const id of brackets[0].seeds) expect(["6A", "5A", "4A"]).toContain(byId.get(id)!.tier);
    expect(brackets.find((b) => b.id === "2a")!.playIn).toBe(true);
    expect(brackets.find((b) => b.id === "2a")!.seeds).toHaveLength(24);
  });

  it("plays every bracket down to one champion, better seeds hosting", () => {
    const games = new Map<string, ScheduledGame>();
    const r = new Rng(5);
    for (const b of brackets.map((x) => ({ ...x, rounds: [] as string[][] }))) {
      for (let guard = 0; guard < 8 && !b.champion; guard++) {
        const fresh = advanceBracket(b, games, 2026);
        for (const g of fresh) {
          expect(b.seeds.indexOf(g.homeId)).toBeLessThan(b.seeds.indexOf(g.awayId));
          games.set(g.id, { ...g, result: simScore(50, 50, r, g.neutral) });
        }
      }
      expect(b.champion).toBeDefined();
      const last = games.get(b.rounds.at(-1)![0])!;
      expect(last.label).toContain("State Championship");
      expect(last.neutral).toBe(true);
      expect(winnerOf(last)).toBe(b.champion);
      expect(b.rounds).toHaveLength(b.playIn ? 5 : 4);
    }
  });

  it("names rounds by teams left", () => {
    expect(roundName(16)).toBe("First round");
    expect(roundName(8)).toBe("Quarterfinal");
    expect(roundName(4)).toBe("Semifinal");
    expect(roundName(2)).toBe("State Championship");
  });
});

describe("season flow", () => {
  it("starts with tryouts and places a raw freshman on a lower level", () => {
    let c = startSeason(career(), 2026, ctx);
    expect(nextEvent(c).kind).toBe("tryout");
    c = advanceTo(c, hsCalendar(2026).tryouts, ctx);
    const t = placeAtTryout(c, ctx, 0);
    expect(["frso", "jv"]).toContain(t.level);
    c = applyTryout(c, t);
    expect(currentSeason(c)!.level).toBe(t.level);
    expect(nextEvent(c).kind).toBe("game");
  });

  it("seniors always make varsity and varsity-only schools start you there", () => {
    let c = startSeason(career(smallSchool.id), 2026, ctx);
    expect(placeAtTryout(c, ctx).level).toBe("varsity");
    c = startSeason(career(), 2026, ctx);
    const s = currentSeason(c)!;
    const senior = { ...c, hs: { ...c.hs, seasons: [{ ...s, grade: 12 as const }] } };
    expect(placeAtTryout(senior, ctx).level).toBe("varsity");
  });

  it("a great tryout from a strong player can make varsity as a freshman", () => {
    let c = startSeason(career(), 2026, ctx);
    const s = currentSeason(c)!;
    const bar = levelCutoff(s.rosters.varsity!);
    const ratings = Object.fromEntries(Object.keys(c.player.ratings).map((k) => [k, 90])) as unknown as Career["player"]["ratings"];
    c = { ...c, player: { ...c.player, ratings } };
    expect(playerOvr(c.player)).toBeGreaterThan(bar);
    expect(placeAtTryout(c, ctx, 4).level).toBe("varsity");
  });

  it("advancing never skips one of your games and sims everything before it", () => {
    let c = startSeason(career(), 2026, ctx);
    c = applyTryout(advanceTo(c, hsCalendar(2026).tryouts, ctx), placeAtTryout(c, ctx));
    const first = userGames(currentSeason(c)!)[0];
    c = advanceTo(c, "2027-03-01", ctx);
    expect(c.date).toBe(first.date);
    const s = currentSeason(c)!;
    expect(s.games.find((g) => g.id === first.id)!.result).toBeUndefined();
    expect(s.games.filter((g) => g.date < first.date).every((g) => g.result)).toBe(true);
  });

  it("records your game, adds to your totals and earns XP", () => {
    let c = startSeason(career(), 2026, ctx);
    c = applyTryout(advanceTo(c, hsCalendar(2026).tryouts, ctx), placeAtTryout(c, ctx));
    const g = userGames(currentSeason(c)!)[0];
    c = advanceTo(c, g.date, ctx);
    const xpBefore = c.player.xp + c.player.skillPoints * XP_PER_POINT;
    c = applyUserGame(c, g.id, outcome(c, g, 18), ctx);
    const s = currentSeason(c)!;
    expect(s.games.find((x) => x.id === g.id)!.result!.userLine!.pts).toBe(18);
    expect(s.stats[s.level]!.gp).toBe(1);
    expect(s.stats[s.level]!.pts).toBe(18);
    expect(c.player.xp + c.player.skillPoints * XP_PER_POINT).toBeGreaterThan(xpBefore);
    // applying twice does nothing
    expect(applyUserGame(c, g.id, outcome(c, g, 40), ctx)).toBe(c);
  });

  it("calls you up after a hot stretch if you're good enough", () => {
    let c = startSeason(career(), 2026, ctx);
    c = applyTryout(advanceTo(c, hsCalendar(2026).tryouts, ctx), { date: c.date, score: 50, level: "frso", note: "" });
    const s = currentSeason(c)!;
    const bar = levelCutoff(s.rosters.jv!);
    const ratings = Object.fromEntries(Object.keys(c.player.ratings).map((k) => [k, Math.min(99, bar + 12)])) as unknown as Career["player"]["ratings"];
    c = { ...c, player: { ...c.player, ratings } };
    for (const g of userGames(currentSeason(c)!).slice(0, 3)) {
      c = advanceTo(c, g.date, ctx);
      c = applyUserGame(c, g.id, outcome(c, g, 28), ctx);
    }
    expect(currentSeason(c)!.level).toBe("jv");
    expect(currentSeason(c)!.moves[0]).toMatchObject({ from: "frso", to: "jv" });
    expect(c.inbox.some((m) => m.subject.includes("moving up"))).toBe(true);
    expect(checkLevelMove(c, ctx)).toBe(c);
  });

  it("natural development grows ratings toward caps over time, never past them", () => {
    const c = career();
    const later = develop({ ...c, player: { ...c.player, devDate: "2026-08-01" } }, "2027-08-01");
    expect(playerOvr(later.player)).toBeGreaterThan(playerOvr(c.player) + 3);
    for (const k of Object.keys(c.player.ratings) as (keyof typeof c.player.ratings)[]) expect(later.player.ratings[k]).toBeLessThanOrEqual(c.player.caps[k]);
    expect(develop(c, "2026-08-10")).toBe(c); // under four weeks: nothing yet
  });

  it("skill points raise a rating, costing more near the cap", () => {
    expect(upgradeCost(50, 90)).toBe(1);
    expect(upgradeCost(80, 90)).toBe(2);
    expect(upgradeCost(87, 90)).toBe(3);
    expect(upgradeCost(90, 90)).toBe(Infinity);
    const c = { ...career(), player: { ...career().player, skillPoints: 1 } };
    const after = spendPoint(c, "three");
    expect(after.player.ratings.three).toBe(c.player.ratings.three + 1);
    expect(after.player.skillPoints).toBe(0);
    expect(spendPoint(after, "three")).toBe(after);
  });

  it("builds the 3D match with you on your level's roster and locked control", () => {
    let c = startSeason(career(), 2026, ctx);
    c = applyTryout(advanceTo(c, hsCalendar(2026).tryouts, ctx), placeAtTryout(c, ctx));
    const g = userGames(currentSeason(c)!)[0];
    const setup = userMatchSetup(c, g, ctx);
    const mine = setup.home.team.id === brophy.id ? setup.home : setup.away;
    expect(mine.roster.some((p) => p.id === c.player.id)).toBe(true);
    expect(setup.lockPlayerId).toBe(c.player.id);
    expect(setup.level).toBe(currentSeason(c)!.level);
  });

  it("finishing a season trims it, keeps the region table, then summer leads to next year a grade older", () => {
    let c = startSeason(career(), 2026, ctx);
    c = applyTryout(advanceTo(c, hsCalendar(2026).tryouts, ctx), placeAtTryout(c, ctx));
    for (let guard = 0; guard < 60; guard++) {
      const ev = nextEvent(c);
      if (ev.kind === "game") {
        c = advanceTo(c, ev.date, ctx);
        c = applyUserGame(c, ev.game.id, outcome(c, ev.game, 12, guard % 2 === 0), ctx);
      } else if (ev.kind === "finals") c = takeFinals(advanceTo(c, ev.date, ctx), ev.semester, 0.5);
      else break;
    }
    expect(nextEvent(c).kind).toBe("seasonEnd");
    c = advanceTo(c, hsCalendar(2026).seasonEnd, ctx);
    const done = currentSeason(c)!;
    expect(done.playoffs!.every((b) => b.champion)).toBe(true);
    c = finishSeason(c, ctx);
    const prev = currentSeason(c)!;
    expect(prev.wrapped).toBe(true);
    expect(prev.regionTable!.length).toBeGreaterThan(1);
    expect(prev.games.every((g) => g.homeId === brophy.id || g.awayId === brophy.id || g.kind === "playoff")).toBe(true);
    expect(prev.ranking).toBeDefined();
    expect(finishSeason(c, ctx)).toBe(c);
    // spring finals, camp, AAU, then the new school year
    expect(nextEvent(c)).toMatchObject({ kind: "finals", semester: "spring" });
    c = takeFinals(c, "spring", 0.5);
    expect(nextEvent(c).kind).toBe("camp");
    c = goToCamp(c, "shooting");
    const sc = nextEvent(c);
    expect(sc.kind === "showcase" && !sc.game).toBe(true);
    c = prepareShowcase(c);
    for (let i = 0; i < 3; i++) {
      const ev = nextEvent(c);
      if (ev.kind !== "showcase" || !ev.game) throw new Error("expected a showcase game");
      const setup = showcaseSetup(c, ev.game);
      const mine = setup.home.roster.some((p) => p.id === c.player.id) ? setup.home : setup.away;
      expect(mine.roster.some((p) => p.id === c.player.id)).toBe(true);
      c = applyShowcaseGame(c, ev.game.id, { ...outcome(c, ev.game, 20), homeScore: 70, awayScore: 60 });
    }
    expect(nextEvent(c).kind).toBe("nextYear");
    c = startNextYear(c, ctx);
    expect(c.hs.seasons).toHaveLength(2);
    expect(currentSeason(c)!.grade).toBe(10);
    expect(c.player.age).toBe(15);
    expect(c.player.classYear).toBe("SO");
    expect(nextEvent(c).kind).toBe("tryout");
    expect(JSON.stringify(c).length).toBeLessThan(900_000);
  });
});

describe("academics", () => {
  it("GPA rises with aptitude, time on school and the exam", () => {
    const r = () => new Rng(1);
    expect(semesterGpa(0.85, 0.5, 0.5, r())).toBeGreaterThan(semesterGpa(0.3, 0.5, 0.5, r()));
    expect(semesterGpa(0.6, 0.9, 0.5, r())).toBeGreaterThan(semesterGpa(0.6, 0.1, 0.5, r()));
    expect(semesterGpa(0.6, 0.5, 1, r())).toBeGreaterThan(semesterGpa(0.6, 0.5, 0, r()));
    for (let i = 0; i < 50; i++) {
      const g = semesterGpa(Math.random(), Math.random(), Math.random(), new Rng(i));
      expect(g).toBeGreaterThanOrEqual(0.5);
      expect(g).toBeLessThanOrEqual(4);
    }
    expect(practiceMultiplier(0)).toBeGreaterThan(practiceMultiplier(1));
    expect(gpaLabel(1.5)).toBe("Academically ineligible");
  });

  it("the finals quiz has eight answerable questions", () => {
    const q = finalsQuiz("seed", 9);
    expect(q).toHaveLength(8);
    for (const x of q) {
      expect(x.choices).toHaveLength(4);
      expect(new Set(x.choices).size).toBe(4);
      expect(x.answer).toBeGreaterThanOrEqual(0);
      expect(x.answer).toBeLessThan(4);
    }
    const math = q.find((x) => x.prompt.includes("×"));
    if (math) {
      const [a, b] = math.prompt.replace(/^.*: /, "").replace(" = ?", "").split(" × ").map(Number);
      expect(Number(math.choices[math.answer])).toBe(a * b);
    }
    expect(finalsQuiz("seed", 9)).toEqual(q);
  });

  it("a failing fall GPA makes you sit out the rest of the season", () => {
    let c = startSeason({ ...career(), player: { ...career().player, academics: 0 } }, 2026, ctx);
    c = setFocus(c, 0);
    c = applyTryout(advanceTo(c, hsCalendar(2026).tryouts, ctx), placeAtTryout(c, ctx));
    for (let guard = 0; guard < 30; guard++) {
      const ev = nextEvent(c);
      if (ev.kind === "game") c = applyUserGame(advanceTo(c, ev.date, ctx), ev.game.id, outcome(c, ev.game, 10), ctx);
      else break;
    }
    const ev = nextEvent(c);
    expect(ev).toMatchObject({ kind: "finals", semester: "fall" });
    c = takeFinals(advanceTo(c, ev.date, ctx), "fall", 0);
    const s = currentSeason(c)!;
    expect(s.grades.fall!).toBeLessThan(ELIGIBLE_GPA);
    expect(s.ineligibleFrom).toBe(hsCalendar(2026).fallGrades);
    // no more games to play: the rest are simulated without you
    expect(nextEvent(c).kind).toBe("seasonEnd");
    c = advanceTo(c, hsCalendar(2026).seasonEnd, ctx);
    const after = currentSeason(c)!.games.filter(
      (g) => g.level === s.level && (g.homeId === s.schoolId || g.awayId === s.schoolId) && g.date >= s.ineligibleFrom!,
    );
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((g) => g.result?.dnp)).toBe(true);
  });
});

describe("recruiting rankings", () => {
  it("higher scores rank higher, with stars by rank", () => {
    expect(nationalRank(84)).toBe(1);
    expect(nationalRank(70)!).toBeLessThan(nationalRank(65)!);
    expect(nationalRank(40)).toBeNull();
    expect(starsFor(10)).toBe(5);
    expect(starsFor(200)).toBe(4);
    expect(starsFor(1000)).toBe(3);
    expect(starsFor(2000)).toBe(2);
    expect(starsFor(null)).toBe(0);
    expect(stateRank(500)!).toBeLessThan(500);
  });

  it("a better player with more exposure ranks higher", () => {
    let c = startSeason(career(), 2026, ctx);
    const base = rankCareer(c, "2027-03-01");
    const better = rankCareer(
      {
        ...c,
        player: {
          ...c.player,
          ratings: Object.fromEntries(Object.entries(c.player.ratings).map(([k, v]) => [k, v + 10])) as unknown as Career["player"]["ratings"],
        },
      },
      "2027-03-01",
    );
    expect(better.score).toBeGreaterThan(base.score);
    expect(rankCareer(c, "2027-03-01", 3).score).toBeGreaterThan(base.score);
    expect(rankCareer(c, "2027-03-01", 99).exposure).toBe(MAX_EXPOSURE);
    c = rerank(c, "2027-03-01", 1);
    expect(currentSeason(c)!.ranking).toBeDefined();
  });
});

describe("summer", () => {
  it("camps raise their skills but never past a cap, and the elite camp is invite-only", () => {
    let c = startSeason(career(), 2026, ctx);
    const camps = campsFor(c);
    expect(camps.find((x) => x.id === "elite")!.invited).toBe(false);
    expect(camps.filter((x) => x.invited).length).toBe(CAMPS.length - 1);
    const before = c.player.ratings.three;
    c = goToCamp(c, "shooting");
    expect(c.player.ratings.three).toBe(Math.min(c.player.caps.three, before + 3));
    expect(currentSeason(c)!.summer!.camp!.id).toBe("shooting");
    const capped = goToCamp({ ...c, player: { ...c.player, ratings: { ...c.player.ratings, three: c.player.caps.three } } }, "shooting");
    expect(capped.player.ratings.three).toBe(c.player.caps.three);
  });

  it("showcase games are three neutral-site games with your club, and good games earn exposure", () => {
    let c = startSeason(career(), 2026, ctx);
    c = prepareShowcase(c);
    const games = currentSeason(c)!.summer!.showcase!;
    expect(games).toHaveLength(3);
    expect(games.every((g) => g.neutral && g.kind === "scrimmage")).toBe(true);
    expect(prepareShowcase(c)).toBe(c);
    expect(showcaseExposure(25, true)).toBeGreaterThan(showcaseExposure(5, true));
    expect(showcaseExposure(25, false)).toBeLessThan(showcaseExposure(25, true));
    const r0 = rankCareer(c, "2027-07-01").exposure;
    c = applyShowcaseGame(c, games[0].id, { ...outcome(c, games[0], 30), homeScore: 80, awayScore: 70 });
    expect(currentSeason(c)!.ranking!.exposure).toBeGreaterThan(r0);
    expect(currentSeason(c)!.summer!.showcase![0].result!.userLine!.pts).toBe(30);
  });
});
