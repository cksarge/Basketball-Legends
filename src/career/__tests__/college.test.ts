import { describe, expect, it } from "vitest";
import { archetypesFor, generateRoster, playerOvr, randomAppearance, teamTalentTarget } from "@/engine/player";
import { Rng } from "@/engine/rng";
import type { Team } from "@/engine/types";
import hs from "@/data/generated/hs.json";
import college from "@/data/generated/college.json";
import { emptyLine, type StatLine } from "@/game/sim/stats";
import { DEFAULT_SETTINGS, createCareer, defaultBody } from "../create";
import { collegeCalendar } from "../calendar";
import { hsContext, type UserGameOutcome } from "../hs/season";
import { rosterStrength } from "../hs/rosters";
import { outcomeFromMatch, runMatchSync } from "../hs/play";
import { generateCollegeSchedule, COLLEGE_TARGET } from "../college/schedule";
import { NATIONAL_ID, INVITATIONAL_ID, seedOrder } from "../college/postseason";
import {
  COLLEGE_STRENGTH_BIAS,
  ELIGIBILITY_YEARS,
  ROLE_MINUTES,
  advanceCollege,
  applyCollegeGame,
  canRedshirt,
  coachRole,
  collegeAwards,
  collegeMatchSetup,
  currentCollege,
  declareForDraft,
  draftStock,
  enterCollege,
  enterPortal,
  finishCollegeSeason,
  nextCollegeEvent,
  returnToSchool,
  rollCollegeRoster,
  setRedshirt,
  signNil,
  startNextCollegeYear,
  transferTo,
  undeclare,
  userCollegeGames,
  withdrawFromPortal,
  yearsUsed,
} from "../college/season";
import type { Career } from "../types";

const teams = hs.teams as unknown as Team[];
const colleges = college.teams as unknown as Team[];
const ctx = hsContext(teams, colleges, college.conferences);
const d1 = colleges.filter((t) => t.tier === "D1");
const d3 = colleges.filter((t) => t.tier === "D3");
const col = (id: string) => colleges.find((t) => t.id === id)!;
const blueBlood = d1.filter((t) => t.prestige >= 0.95)[0];
const midMajor = d1.find((t) => t.prestige > 0.4 && t.prestige < 0.5)!;

function base(teamId: string, walkOn = false, boost = 0): Career {
  const c = createCareer(
    {
      firstName: "Test",
      lastName: "Collegian",
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
  for (const k of Object.keys(ratings) as (keyof typeof ratings)[]) ratings[k] = Math.min(99, ratings[k] + boost);
  const caps = { ...c.player.caps };
  for (const k of Object.keys(caps) as (keyof typeof caps)[]) caps[k] = 99;
  return {
    ...c,
    date: "2030-05-28",
    player: { ...c.player, age: 18, ratings, caps },
    recruiting: { offers: [], visitsUsed: 0, visitsAllowed: 5, college: { teamId, walkOn, date: "2030-05-01" } },
  };
}

/** A line good for a game score around the given points. */
function line(pts: number, min = 30): StatLine {
  return { ...emptyLine(), min: min * 60, pts, fgm: Math.round(pts / 2.2), fga: Math.round(pts / 1.1), oreb: 1, dreb: 4, ast: 5, stl: 1, blk: 1 };
}
const outcome = (c: Career, gameId: string, pts: number, win: boolean, played = false): UserGameOutcome => {
  const s = currentCollege(c)!;
  const g = s.games.find((x) => x.id === gameId)!;
  const home = g.homeId === s.teamId;
  return { homeScore: home === win ? 80 : 70, awayScore: home === win ? 70 : 80, overtimes: 0, box: { [c.player.id]: line(pts) }, played, playerOfGame: null };
};

/** Plays every game of a season with a fixed line (winning or not), then wraps it up. */
function playSeason(c: Career, pts = 20, win = true): Career {
  let x = c;
  for (let i = 0; i < 60; i++) {
    const ev = nextCollegeEvent(x);
    if (ev.kind === "seasonEnd") {
      x = advanceCollege(x, ev.date, ctx);
      if (nextCollegeEvent(x).kind === "game") continue;
      return finishCollegeSeason(x, ctx);
    }
    if (ev.kind !== "game") return x;
    x = advanceCollege(x, ev.date, ctx);
    x = applyCollegeGame(x, ev.game.id, outcome(x, ev.game.id, pts, win), ctx);
  }
  throw new Error("season never ended");
}

describe("college calendar and schedules", () => {
  it("keeps the season in order", () => {
    const cal = collegeCalendar(2030);
    const order = [cal.firstGame, cal.conferenceStart, cal.lastRegular, ...cal.conferenceTournament, cal.selection, ...cal.national, cal.seasonEnd];
    expect([...order].sort()).toEqual(order);
    expect(cal.invitational.at(-1)! < cal.seasonEnd).toBe(true);
  });

  it.each(["D1", "D2", "D3"])("gives every %s team a full, valid schedule", (tier) => {
    const list = colleges.filter((t) => t.tier === tier);
    const games = generateCollegeSchedule(list, 2030, 1);
    const count = new Map<string, number>();
    const days = new Set<string>();
    for (const g of games) {
      expect(g.homeId).not.toBe(g.awayId);
      for (const t of [g.homeId, g.awayId]) {
        count.set(t, (count.get(t) ?? 0) + 1);
        expect(days.has(`${t}|${g.date}`)).toBe(false);
        days.add(`${t}|${g.date}`);
      }
    }
    const c = list.map((t) => count.get(t.id) ?? 0);
    expect(Math.min(...c)).toBeGreaterThanOrEqual(20);
    expect(Math.max(...c)).toBeLessThanOrEqual(COLLEGE_TARGET + 2);
  });

  it("is repeatable and plays conference games only inside the conference", () => {
    const a = generateCollegeSchedule(d1, 2030, 5);
    expect(generateCollegeSchedule(d1, 2030, 5)).toEqual(a);
    const conf = new Map(d1.map((t) => [t.id, t.conferenceId]));
    for (const g of a.filter((x) => x.kind === "region")) expect(conf.get(g.homeId)).toBe(conf.get(g.awayId));
    for (const g of a.filter((x) => x.kind === "nonregion")) expect(conf.get(g.homeId)).not.toBe(conf.get(g.awayId));
  });

  it("seeds a bracket so the top seeds meet last", () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect([...seedOrder(64)].sort((a, b) => a - b)).toEqual(Array.from({ length: 64 }, (_, i) => i + 1));
  });
});

describe("rosters and strength", () => {
  it("keeps the strength estimate close to real rosters", () => {
    const gaps = d1.slice(0, 80).map((t) => rosterStrength(generateRoster(t, 2030)) - teamTalentTarget(t));
    expect(Math.abs(gaps.reduce((a, b) => a + b, 0) / gaps.length - COLLEGE_STRENGTH_BIAS)).toBeLessThan(1.2);
  });

  it("carries a roster over: seniors leave, everyone else moves up a class", () => {
    const prev = generateRoster(blueBlood, 2030);
    const next = rollCollegeRoster(blueBlood, prev, 2031);
    expect(next.length).toBe(13);
    expect(next.filter((p) => prev.some((q) => q.id === p.id)).every((p) => p.classYear !== "FR")).toBe(true);
    for (const p of prev.filter((q) => q.classYear === "SR")) expect(next.some((q) => q.id === p.id)).toBe(false);
    expect(new Set(next.map((p) => p.id)).size).toBe(next.length);
  });
});

describe("enrolling and the coach", () => {
  it("moves a graduate into college with a team, a role and NIL offers", () => {
    const c = enterCollege(base(midMajor.id), ctx);
    const s = currentCollege(c)!;
    expect(c.stage).toBe("college");
    expect(c.player.teamId).toBe(midMajor.id);
    expect(c.player.age).toBe(19);
    expect(s.classYear).toBe("FR");
    expect(s.nil.length).toBeGreaterThanOrEqual(2);
    expect(userCollegeGames(s).length).toBeGreaterThan(20);
    expect(enterCollege(c, ctx)).toBe(c);
  });

  it("does nothing without a college picked", () => {
    const c = { ...base(midMajor.id), recruiting: undefined };
    expect(enterCollege(c, ctx)).toBe(c);
  });

  it("starts walk-ons with less trust", () => {
    const on = currentCollege(enterCollege(base(midMajor.id, false, 12), ctx))!;
    const off = currentCollege(enterCollege(base(midMajor.id, true, 12), ctx))!;
    expect(off.trust).toBeLessThan(on.trust);
  });

  it("role follows rank on the roster, and trust can move it", () => {
    const roster = generateRoster(midMajor, 2030);
    const sorted = roster.map(playerOvr).sort((a, b) => b - a);
    expect(coachRole(sorted[0] + 2, roster, 50)).toBe("starter");
    expect(coachRole(sorted[12] - 1, roster, 50)).toBe("bench");
    expect(coachRole(sorted[6], roster, 95)).toBe("starter");
    expect(coachRole(sorted[6], roster, 5)).not.toBe("starter");
  });

  it("trust rises with big games and falls with bad ones, and a role change is announced", () => {
    let c = enterCollege(base(midMajor.id, false, 6), ctx);
    const start = currentCollege(c)!.trust;
    let up = c;
    for (let i = 0; i < 12; i++) {
      const ev = nextCollegeEvent(up);
      if (ev.kind !== "game") break;
      up = applyCollegeGame(advanceCollege(up, ev.date, ctx), ev.game.id, outcome(up, ev.game.id, 34, true), ctx);
    }
    expect(currentCollege(up)!.trust).toBeGreaterThan(start);
    for (let i = 0; i < 12; i++) {
      const ev = nextCollegeEvent(c);
      if (ev.kind !== "game") break;
      c = applyCollegeGame(advanceCollege(c, ev.date, ctx), ev.game.id, outcome(c, ev.game.id, 0, false), ctx);
    }
    expect(currentCollege(c)!.trust).toBeLessThan(start);
  });

  it("the coach's plan reaches the game: starters and target minutes follow your role", () => {
    const c = enterCollege(base(midMajor.id, false, 25), ctx);
    const s = currentCollege(c)!;
    const g = userCollegeGames(s)[0];
    const setup = collegeMatchSetup(c, g, ctx);
    const mine = setup.home.team.id === s.teamId ? setup.home : setup.away;
    expect(s.role).toBe("starter");
    expect(mine.starters).toContain(c.player.id);
    expect(mine.rotation![c.player.id]).toBe(ROLE_MINUTES.starter);
    const benched = { ...c, college: { ...c.college!, seasons: [{ ...s, role: "bench" as const }] } };
    const b = collegeMatchSetup(benched, g, ctx);
    const side = b.home.team.id === s.teamId ? b.home : b.away;
    expect(side.starters).not.toContain(c.player.id);
    expect(side.rotation![c.player.id]).toBe(ROLE_MINUTES.bench);
  });
});

describe("a season", () => {
  const start = enterCollege(base(blueBlood.id, false, 25), ctx);
  const done = playSeason(start);
  const s = currentCollege(done)!;
  const brackets = s.brackets!;
  const national = brackets.find((b) => b.id === NATIONAL_ID)!;
  const invitational = brackets.find((b) => b.id === INVITATIONAL_ID)!;

  it("plays conference tournaments for every conference, and each crowns a champion", () => {
    const conf = brackets.filter((b) => b.id.startsWith("conf-"));
    expect(conf.length).toBe(new Set(d1.map((t) => t.conferenceId)).size);
    for (const b of conf) {
      expect(b.champion).toBeTruthy();
      expect([2, 4, 8]).toContain(b.seeds.length);
    }
  });

  it("selects 68 for the national tournament with every automatic bid, and 32 others for the invitational", () => {
    expect(national.seeds.length).toBe(68);
    expect(new Set(national.seeds).size).toBe(68);
    for (const b of brackets.filter((x) => x.id.startsWith("conf-"))) expect(national.seeds).toContain(b.champion);
    expect(invitational.seeds.length).toBe(32);
    for (const id of invitational.seeds) expect(national.seeds).not.toContain(id);
  });

  it("runs the national tournament to one champion: 4 opening games, then 63", () => {
    expect(national.champion).toBeTruthy();
    expect(national.rounds.map((r) => r.length)).toEqual([4, 32, 16, 8, 4, 2, 1]);
    expect(invitational.champion).toBeTruthy();
    expect(invitational.rounds.map((r) => r.length)).toEqual([16, 8, 4, 2, 1]);
  });

  it("no team plays twice in a day in the postseason", () => {
    const seen = new Set<string>();
    for (const g of s.games.filter((x) => x.kind === "playoff"))
      for (const t of [g.homeId, g.awayId]) {
        expect(seen.has(`${t}|${g.date}`)).toBe(false);
        seen.add(`${t}|${g.date}`);
      }
  });

  it("wraps up with honors, how the season ended, and a draft projection", () => {
    expect(s.wrapped).toBe(true);
    expect(s.finish).toBeTruthy();
    expect(s.stock?.pick).toBeGreaterThan(0);
    expect(s.teamRank).toBeGreaterThan(0);
    expect(s.conferenceTable!.length).toBeGreaterThan(1);
    expect(s.stats.gp).toBeGreaterThanOrEqual(20);
    expect(nextCollegeEvent(done).kind).toBe("decision");
  });

  it("a winning team gets strong simulated college scores", () => {
    const totals = s.games.filter((g) => g.kind === "playoff" && g.result).map((g) => g.result!.home + g.result!.away);
    const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
    expect(avg).toBeGreaterThan(115);
    expect(avg).toBeLessThan(165);
  });

  it("gives Divisions II and III a 64-team national tournament and no invitational", () => {
    const c = playSeason(enterCollege(base(d3[0].id, false, 10), ctx));
    const b = currentCollege(c)!.brackets!;
    const nat = b.find((x) => x.id === NATIONAL_ID)!;
    expect(nat.seeds.length).toBe(64);
    expect(nat.name).toContain("Division III");
    expect(nat.champion).toBeTruthy();
    expect(b.some((x) => x.id === INVITATIONAL_ID)).toBe(false);
  });
});

describe("honors and draft stock", () => {
  const start = enterCollege(base(blueBlood.id, false, 25), ctx);
  const season = (pts: number) => playSeason(start, pts);

  it("big numbers earn bigger honors", () => {
    const star = collegeAwards(season(32), ctx).length ? currentCollege(season(32))!.awards : [];
    expect(star.some((a) => a.includes("All-American"))).toBe(true);
    const role = currentCollege(season(8))!.awards;
    expect(role.some((a) => a.includes("All-American"))).toBe(false);
  });

  it("younger, better, more productive players project higher", () => {
    const a = draftStock(season(26));
    const b = draftStock(season(6));
    expect(a.score).toBeGreaterThan(b.score);
    const older = season(26);
    expect(draftStock({ ...older, player: { ...older.player, age: older.player.age + 3 } }).score).toBeLessThan(a.score);
  });
});

describe("after the season", () => {
  const done = playSeason(enterCollege(base(blueBlood.id, false, 25), ctx));

  it("returning starts a new season a class older with the same teammates", () => {
    const next = startNextCollegeYear(returnToSchool(done), ctx);
    const s = currentCollege(next)!;
    expect(s.classYear).toBe("SO");
    expect(s.teamId).toBe(blueBlood.id);
    expect(s.year).toBe(2031);
    expect(next.player.age).toBe(20);
    const before = currentCollege(done)!.roster;
    expect(s.roster.filter((p) => before.some((q) => q.id === p.id)).length).toBeGreaterThan(5);
    expect(next.college!.seasons.length).toBe(2);
  });

  it("the portal brings offers, and transferring moves you to the new program next year", () => {
    const c = enterPortal(done, ctx);
    const offers = currentCollege(c)!.portalOffers!;
    expect(offers.length).toBeGreaterThan(0);
    expect(nextCollegeEvent(c).kind).toBe("portal");
    const to = offers[0].teamId;
    const moved = transferTo(c, to, ctx);
    expect(nextCollegeEvent(moved).kind).toBe("nextYear");
    const next = startNextCollegeYear(moved, ctx);
    expect(currentCollege(next)!.teamId).toBe(to);
    expect(next.player.teamId).toBe(to);
    expect(next.college!.transferTo).toBeUndefined();
  });

  it("can't transfer to a program that didn't offer", () => {
    const c = enterPortal(done, ctx);
    const other = d1.find((t) => !currentCollege(c)!.portalOffers!.some((o) => o.teamId === t.id) && t.id !== blueBlood.id)!;
    expect(transferTo(c, other.id, ctx)).toBe(c);
  });

  it("withdrawing from the portal costs some of the coach's trust", () => {
    const stay = startNextCollegeYear(returnToSchool(done), ctx);
    const back = startNextCollegeYear(withdrawFromPortal(enterPortal(done, ctx)), ctx);
    expect(currentCollege(back)!.trust).toBeLessThan(currentCollege(stay)!.trust);
    expect(back.college!.withdrewPortal).toBeUndefined();
  });

  it("declaring can be taken back while you have eligibility", () => {
    const c = declareForDraft(done);
    expect(nextCollegeEvent(c).kind).toBe("declared");
    expect(c.log.at(-1)!.text).toContain("Declared");
    expect(nextCollegeEvent(undeclare(c)).kind).toBe("decision");
  });

  it("four seasons use up your eligibility", () => {
    let c = done;
    for (let i = 1; i < ELIGIBILITY_YEARS; i++) c = playSeason(startNextCollegeYear(returnToSchool(c), ctx));
    expect(yearsUsed(c)).toBe(4);
    expect(currentCollege(c)!.classYear).toBe("SR");
    expect(returnToSchool(c)).toBe(c);
    expect(enterPortal(c, ctx)).toBe(c);
    expect(nextCollegeEvent(declareForDraft(c)).kind).toBe("declared");
    expect(undeclare(declareForDraft(c)).college!.declared).toBeDefined();
  });
});

describe("redshirting", () => {
  const start = enterCollege(base(blueBlood.id, false, -6), ctx);

  it("sits you out without using a year, and you only get one", () => {
    expect(currentCollege(start)!.role).not.toBe("starter");
    expect(canRedshirt(start)).toBe(true);
    const c = setRedshirt(start, true);
    expect(nextCollegeEvent(c).kind).toBe("seasonEnd");
    const done = playSeason(c);
    const s = currentCollege(done)!;
    expect(s.stats.gp).toBe(0);
    expect(s.awards).toEqual([]);
    expect(userCollegeGames(s).every((g) => g.result?.dnp)).toBe(true);
    expect(yearsUsed(done)).toBe(0);
    const next = startNextCollegeYear(returnToSchool(done), ctx);
    expect(currentCollege(next)!.classYear).toBe("FR");
    expect(canRedshirt(next)).toBe(false);
  });

  it("isn't offered to a starter", () => {
    expect(canRedshirt(enterCollege(base(blueBlood.id, false, 25), ctx))).toBe(false);
  });
});

describe("NIL", () => {
  it("signing pays you once, and a national deal costs a little trust", () => {
    const c = enterCollege(base(blueBlood.id, false, 25), ctx);
    const s = currentCollege(c)!;
    const local = s.nil.find((d) => d.kind === "local")!;
    const signed = signNil(c, local.id);
    expect(signed.college!.earnings).toBe(local.amount);
    expect(signNil(signed, local.id).college!.earnings).toBe(local.amount);
    const big = { ...c, college: { ...c.college!, seasons: [{ ...s, nil: [{ ...local, id: "n", kind: "national" as const }] }] } };
    expect(currentCollege(signNil(big, "n"))!.trust).toBe(s.trust - 2);
  });
});

describe("real engine", () => {
  it("gets an end-of-the-bench player into games for about the minutes the coach planned", () => {
    let c = enterCollege(base(blueBlood.id, false, -22), ctx);
    expect(currentCollege(c)!.role).toBe("bench");
    const minutes: number[] = [];
    for (let i = 0; i < 4; i++) {
      const ev = nextCollegeEvent(c);
      if (ev.kind !== "game") throw new Error("no game");
      c = advanceCollege(c, ev.date, ctx);
      const o = outcomeFromMatch(runMatchSync(collegeMatchSetup(c, ev.game, ctx)), false);
      minutes.push((o.box[c.player.id]?.min ?? 0) / 60);
      c = applyCollegeGame(c, ev.game.id, o, ctx);
    }
    expect(Math.min(...minutes)).toBeGreaterThan(1);
    const avg = minutes.reduce((a, b) => a + b, 0) / minutes.length;
    expect(avg).toBeGreaterThan(ROLE_MINUTES.bench * 0.5);
    expect(avg).toBeLessThan(ROLE_MINUTES.bench * 2.5);
  });

  it("plays one of your games: a college game of two halves, with your minutes near the coach's plan", () => {
    let c = enterCollege(base(midMajor.id, false, 16), ctx);
    const ev = nextCollegeEvent(c);
    if (ev.kind !== "game") throw new Error("no game");
    c = advanceCollege(c, ev.date, ctx);
    const s = currentCollege(c)!;
    const m = runMatchSync(collegeMatchSetup(c, ev.game, ctx));
    expect(m.state.cfg.rules.periods).toBe(2);
    const o = outcomeFromMatch(m, false);
    const min = (o.box[c.player.id]?.min ?? 0) / 60;
    expect(min).toBeGreaterThan(ROLE_MINUTES[s.role] * 0.4);
    expect(min).toBeLessThan(ROLE_MINUTES[s.role] * 1.6 + 6);
    const after = applyCollegeGame(c, ev.game.id, o, ctx);
    expect(currentCollege(after)!.stats.gp).toBe(1);
    expect(col(s.teamId).tier).toBe("D1");
  });
});
