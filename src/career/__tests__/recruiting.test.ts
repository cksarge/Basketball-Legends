import { describe, expect, it } from "vitest";
import { archetypesFor, randomAppearance } from "@/engine/player";
import { Rng } from "@/engine/rng";
import type { Team } from "@/engine/types";
import hs from "@/data/generated/hs.json";
import college from "@/data/generated/college.json";
import { DEFAULT_SETTINGS, createCareer, defaultBody } from "../create";
import { currentSeason, graduate, hsContext, nextEvent, startSeason } from "../hs/season";
import { D1_GPA } from "../hs/academics";
import { nationalRank, starsFor, stateRank } from "../hs/rankings";
import {
  MAX_OFFERS,
  MAX_TRACKED,
  TOP_BAR,
  VISITS_ALLOWED,
  VISIT_FOCUS,
  canReclassify,
  chooseCollege,
  commit,
  contactDate,
  cumulativeGpa,
  decommit,
  earlySigning,
  liveOffers,
  nilValue,
  officialVisit,
  programBar,
  programInterest,
  projectedRole,
  reclassify,
  refreshRecruiting,
  toggleFavorite,
  walkOnOptions,
} from "../recruiting";
import type { Career, Offer } from "../types";

const teams = hs.teams as unknown as Team[];
const colleges = college.teams as unknown as Team[];
const ctx = hsContext(teams, colleges, college.conferences);
const col = (id: string) => colleges.find((t) => t.id === id)!;
const blueBloods = colleges.filter((t) => t.tier === "D1" && t.prestige >= 0.95);
const lowD1 = colleges.filter((t) => t.tier === "D1" && t.prestige <= 0.25);
const azD1 = colleges.filter((t) => t.state === "AZ" && t.tier === "D1");
const SENIOR_FALL = 2029;

function base(): Career {
  return createCareer(
    {
      firstName: "Test",
      lastName: "Recruit",
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
}

/** A prospect in a given grade with a scouting score and GPA (every semester so far at that GPA). */
function prospect(score: number, gpa = 3.2, grade: 9 | 10 | 11 | 12 = 11, wrapped = false): Career {
  const c = startSeason(base(), 2026, ctx);
  const s = currentSeason(c)!;
  const national = nationalRank(score);
  const year = 2026 + grade - 9;
  return {
    ...c,
    date: `${year + 1}-06-20`,
    hs: {
      ...c.hs,
      seasons: [
        {
          ...s,
          grade,
          year,
          wrapped,
          tryout: { date: `${year}-11-05`, score: 90, level: "varsity", note: "" },
          games: [],
          grades: { fall: gpa, spring: gpa },
          ranking: { date: `${year + 1}-06-01`, score, national, stars: starsFor(national), state: stateRank(national), exposure: 1 },
        },
      ],
    },
  };
}

const withGpa = (c: Career, gpa: number): Career => ({
  ...c,
  hs: { ...c.hs, seasons: c.hs.seasons.map((s) => ({ ...s, grades: { fall: gpa, spring: gpa } })) },
});

/** Refreshes on several dates in a row (interest blends over time). */
function refreshMany(c: Career, dates: string[]) {
  for (const d of dates) c = refreshRecruiting(c, colleges, d);
  return c;
}
const summerDates = ["2028-06-20", "2028-07-01", "2028-07-15", "2028-08-01"];
const offersOf = (c: Career, status: Offer["status"] = "offered") => (c.recruiting?.offers ?? []).filter((o) => o.status === status);

describe("program levels", () => {
  it("blue bloods recruit higher than low majors, and D1 above D2 above D3", () => {
    const d2 = colleges.find((t) => t.tier === "D2")!;
    const d3 = colleges.find((t) => t.tier === "D3")!;
    expect(programBar(blueBloods[0])).toBeGreaterThan(programBar(lowD1[0]));
    expect(programBar(lowD1[0])).toBeGreaterThan(programBar({ ...d2, prestige: lowD1[0].prestige }));
    expect(programBar({ ...d2, prestige: 0.3 })).toBeGreaterThan(programBar({ ...d3, prestige: 0.3 }));
    expect(Math.max(...colleges.map(programBar))).toBeLessThanOrEqual(TOP_BAR);
  });

  it("a top-10 recruit interests blue bloods; a two-star doesn't", () => {
    const rng = new Rng(1);
    const star = prospect(80);
    const avg = (c: Career, ts: Team[]) => ts.reduce((a, t) => a + programInterest(c, t, rng), 0) / ts.length;
    expect(avg(star, blueBloods)).toBeGreaterThan(68);
    // low majors know they can't land a top recruit
    expect(avg(star, lowD1)).toBeLessThan(avg(star, blueBloods));
    const twoStar = prospect(60);
    expect(avg(twoStar, blueBloods)).toBeLessThan(10);
    expect(avg(twoStar, lowD1)).toBeGreaterThan(avg(twoStar, blueBloods));
  });

  it("Arizona programs get a home-state edge", () => {
    const c = prospect(66);
    const az = azD1[0];
    const twin = { ...az, state: "TX" };
    let diff = 0;
    for (let i = 0; i < 30; i++) diff += programInterest(c, az, new Rng(i)) - programInterest(c, twin, new Rng(i));
    expect(diff).toBeGreaterThan(0);
  });

  it("Division I can't recruit you under the 2.3 core GPA; D2 still can", () => {
    const c = prospect(70, D1_GPA - 0.2);
    expect(cumulativeGpa(c)).toBeCloseTo(D1_GPA - 0.2);
    expect(colleges.filter((t) => t.tier === "D1").every((t) => programInterest(c, t, new Rng(2)) === 0)).toBe(true);
    const d2 = colleges.filter((t) => t.tier === "D2");
    expect(d2.some((t) => programInterest(c, t, new Rng(2)) > 0)).toBe(true);
  });

  it("NIL values follow rank and division, and better players are pitched bigger roles", () => {
    const d3 = colleges.find((t) => t.tier === "D3")!;
    expect(nilValue(prospect(82), blueBloods[0])).toBeGreaterThan(nilValue(prospect(65), blueBloods[0]));
    expect(nilValue(prospect(82), d3)).toBe(0);
    const weak = prospect(60);
    const strong = {
      ...weak,
      player: { ...weak.player, ratings: Object.fromEntries(Object.entries(weak.player.ratings).map(([k, v]) => [k, v + 30])) },
    } as Career;
    const roles = ["Starter from day one", "Rotation player as a freshman", "Bench minutes, bigger role later", "Likely redshirt year"];
    expect(roles.indexOf(projectedRole(strong, blueBloods[0]))).toBeLessThan(roles.indexOf(projectedRole(weak, blueBloods[0])));
  });
});

describe("offers", () => {
  it("nothing happens before the NCAA contact date (June 15 after sophomore year)", () => {
    expect(contactDate(2026)).toBe("2028-06-15");
    const c = prospect(80, 3.2, 10);
    expect(refreshRecruiting(c, colleges, "2028-06-14")).toBe(c);
    expect(refreshRecruiting(c, colleges, "2028-06-15").recruiting).toBeDefined();
  });

  it("a top recruit hears from big programs, with offers announced in messages", () => {
    const c = refreshMany(prospect(80), summerDates);
    const offered = offersOf(c);
    expect(offered.length).toBeGreaterThanOrEqual(8);
    expect(offered.length).toBeLessThanOrEqual(MAX_OFFERS);
    expect(offersOf(c, "interested").length).toBeLessThanOrEqual(MAX_TRACKED);
    const prestige = offered.reduce((a, o) => a + col(o.teamId).prestige, 0) / offered.length;
    expect(prestige).toBeGreaterThan(0.75);
    expect(c.inbox.some((m) => m.subject.startsWith("Scholarship offer from"))).toBe(true);
    expect(c.log.some((e) => e.text.startsWith("Scholarship offer from"))).toBe(true);
    // never more than six offer messages at once
    const firstDay = refreshRecruiting(prospect(80), colleges, summerDates[0]);
    expect(firstDay.inbox.filter((m) => m.subject.startsWith("Scholarship offer from")).length).toBeLessThanOrEqual(6);
  });

  it("an unranked player gets small-college interest and no D1 offers", () => {
    const c = refreshMany(prospect(52), summerDates);
    expect(offersOf(c).every((o) => col(o.teamId).tier !== "D1")).toBe(true);
    expect((c.recruiting?.offers ?? []).length).toBeGreaterThan(0);
  });

  it("is deterministic for a career and date", () => {
    const a = refreshMany(prospect(72), summerDates);
    const b = refreshMany(prospect(72), summerDates);
    expect(a.recruiting!.offers.map((o) => [o.teamId, o.status, o.interest])).toEqual(b.recruiting!.offers.map((o) => [o.teamId, o.status, o.interest]));
  });

  it("D1 offers are pulled when grades drop (one message, naming the GPA) and come back when they recover", () => {
    let c = refreshMany(prospect(78), summerDates);
    const d1Offers = offersOf(c).filter((o) => col(o.teamId).tier === "D1");
    expect(d1Offers.length).toBeGreaterThan(0);
    const inboxBefore = c.inbox.length;
    c = refreshMany(withGpa(c, 1.9), ["2028-09-01", "2028-09-15", "2028-10-01"]);
    const pulled = offersOf(c, "withdrawn");
    expect(pulled.length).toBeGreaterThanOrEqual(d1Offers.length);
    const notes = c.inbox.slice(inboxBefore).filter((m) => m.subject.includes("withdrawn"));
    expect(notes.length).toBeLessThanOrEqual(3);
    expect(notes.some((m) => m.body.includes(D1_GPA.toFixed(1)))).toBe(true);
    c = refreshMany(withGpa(c, 3.4), ["2028-11-01", "2028-11-15", "2028-12-01", "2028-12-15", "2029-01-01"]);
    const back = offersOf(c).filter((o) => d1Offers.some((x) => x.teamId === o.teamId));
    expect(back.length).toBeGreaterThan(0);
  });

  it("favorites toggle on and off", () => {
    let c = refreshMany(prospect(75), summerDates);
    const id = c.recruiting!.offers[0].teamId;
    c = toggleFavorite(c, id);
    expect(c.recruiting!.offers[0].favorite).toBe(true);
    c = toggleFavorite(c, id);
    expect(c.recruiting!.offers[0].favorite).toBe(false);
  });
});

describe("commitment and signing", () => {
  const ready = () => refreshMany(prospect(78, 3.2, 12), ["2029-08-01", "2029-08-15", "2029-09-01"]);

  it("you can only commit to a real offer, and committing elsewhere moves the commitment", () => {
    let c = ready();
    const [a, b] = offersOf(c);
    const interested = c.recruiting!.offers.find((o) => o.status === "interested");
    if (interested) expect(commit(c, interested.teamId, colleges, "2029-09-02")).toBe(c);
    c = commit(c, a.teamId, colleges, "2029-09-02");
    expect(c.recruiting!.committedTo).toBe(a.teamId);
    expect(c.log.at(-1)!.text).toContain("Committed to");
    c = commit(c, b.teamId, colleges, "2029-09-03");
    expect(c.recruiting!.committedTo).toBe(b.teamId);
    expect(offersOf(c, "committed").map((o) => o.teamId)).toEqual([b.teamId]);
  });

  it("decommitting frees you up but costs some of the program's trust", () => {
    let c = ready();
    const o = offersOf(c)[0];
    c = commit(c, o.teamId, colleges, "2029-09-02");
    c = decommit(c, colleges, "2029-09-10");
    expect(c.recruiting!.committedTo).toBeUndefined();
    const after = c.recruiting!.offers.find((x) => x.teamId === o.teamId)!;
    expect(after.status).toBe("offered");
    expect(after.interest).toBe(Math.max(0, o.interest - 25));
  });

  it("a committed senior signs on the early signing day, and the letter is binding", () => {
    let c = ready();
    const [a, b] = offersOf(c);
    c = commit(c, a.teamId, colleges, "2029-09-02");
    c = refreshRecruiting(c, colleges, earlySigning(SENIOR_FALL));
    expect(c.recruiting!.signedDate).toBe(earlySigning(SENIOR_FALL));
    expect(liveOffers(c)[0].status === "signed" || liveOffers(c).some((o) => o.status === "signed")).toBe(true);
    expect(decommit(c, colleges, "2029-12-01")).toBe(c);
    expect(commit(c, b.teamId, colleges, "2029-12-01")).toBe(c);
    expect(chooseCollege(c, b.teamId, colleges, "2030-05-01")).toBe(c);
    // signing stops the recruiting churn
    expect(refreshRecruiting(c, colleges, "2030-01-01")).toBe(c);
  });
});

describe("official visits", () => {
  it("uses a visit, raises the program's interest, tells a story, and only once per program", () => {
    let c = refreshMany(prospect(76), summerDates);
    const o = c.recruiting!.offers[0];
    const { career, story } = officialVisit(c, o.teamId, "coach", colleges, "2028-09-01");
    expect(story.length).toBeGreaterThan(20);
    const after = career.recruiting!.offers.find((x) => x.teamId === o.teamId)!;
    expect(after.visited).toBe(true);
    expect(after.interest).toBe(Math.min(100, o.interest + 8));
    expect(career.recruiting!.visitsUsed).toBe(1);
    expect(officialVisit(career, o.teamId, "players", colleges, "2028-09-02").career).toBe(career);
    c = career;
  });

  it("every focus works, and you get five visits at most", () => {
    let c = refreshMany(prospect(80), summerDates);
    const ids = c.recruiting!.offers.map((o) => o.teamId);
    expect(ids.length).toBeGreaterThan(VISITS_ALLOWED);
    ids.slice(0, VISITS_ALLOWED).forEach((id, i) => {
      c = officialVisit(c, id, VISIT_FOCUS[i % VISIT_FOCUS.length].id, colleges, "2028-09-01").career;
    });
    expect(c.recruiting!.visitsUsed).toBe(VISITS_ALLOWED);
    const extra = officialVisit(c, ids[VISITS_ALLOWED], "facilities", colleges, "2028-09-01");
    expect(extra.career).toBe(c);
    expect(extra.story).toBe("");
  });
});

describe("reclassifying", () => {
  it("is for wrapped-up juniors who are four-star or better with a 3.0", () => {
    expect(canReclassify(prospect(76, 3.4, 11, true))).toBe(true);
    expect(canReclassify(prospect(76, 3.4, 11, false))).toBe(false);
    expect(canReclassify(prospect(60, 3.4, 11, true))).toBe(false);
    expect(canReclassify(prospect(76, 2.6, 11, true))).toBe(false);
    expect(canReclassify(prospect(76, 3.4, 10, true))).toBe(false);
  });

  it("makes junior year your last: graduation comes next instead of the summer", () => {
    const c = reclassify(prospect(76, 3.4, 11, true), "2028-03-10");
    expect(c.recruiting!.reclassified).toBe(true);
    expect(canReclassify(c)).toBe(false);
    expect(nextEvent(c).kind).toBe("graduated");
    expect(c.inbox.at(-1)!.subject).toBe("Reclassification approved");
  });
});

describe("choosing a college and graduating", () => {
  const senior = (score = 74, gpa = 3.2) => refreshMany(prospect(score, gpa, 12, true), ["2029-08-01", "2029-08-15", "2029-09-01", "2030-03-01"]);

  it("graduation waits until you've picked a college", () => {
    const c = senior();
    expect(graduate(c, ctx)).toBe(c);
  });

  it("signing with an offer at graduation signs the letter and lets you graduate", () => {
    let c = senior();
    const o = liveOffers(c)[0];
    c = chooseCollege(c, o.teamId, colleges, "2030-05-20");
    expect(c.recruiting!.college).toEqual({ teamId: o.teamId, walkOn: false, date: "2030-05-20" });
    expect(c.recruiting!.signedDate).toBe("2030-05-20");
    const g = graduate(c, ctx);
    expect(g.log.some((e) => e.text.startsWith("Graduated from"))).toBe(true);
    expect(g.inbox.at(-1)!.body).toContain(col(o.teamId).name);
  });

  it("walk-on spots skip your offers, include Arizona schools, and need the D1 GPA bar", () => {
    const c = senior(64);
    const options = walkOnOptions(c, colleges);
    const offered = new Set(liveOffers(c).map((o) => o.teamId));
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((t) => !offered.has(t.id))).toBe(true);
    expect(options.some((t) => t.state === "AZ")).toBe(true);
    const lowGrades = withGpa(c, 2.0);
    expect(walkOnOptions(lowGrades, colleges).every((t) => t.tier !== "D1")).toBe(true);
    const w = chooseCollege(c, options[0].id, colleges, "2030-05-20");
    expect(w.recruiting!.college!.walkOn).toBe(true);
    expect(w.recruiting!.signedDate).toBeUndefined();
    expect(w.log.at(-1)!.text).toContain("walk on");
    // a program that isn't an offer or a walk-on option can't be picked
    const random = colleges.find((t) => !offered.has(t.id) && !options.some((x) => x.id === t.id))!;
    expect(chooseCollege(c, random.id, colleges, "2030-05-20")).toBe(c);
  });

  it("you can change your mind before graduating, unless you've signed", () => {
    let c = senior(64);
    const options = walkOnOptions(c, colleges);
    c = chooseCollege(c, options[0].id, colleges, "2030-05-20");
    c = chooseCollege(c, options[1].id, colleges, "2030-05-21");
    expect(c.recruiting!.college!.teamId).toBe(options[1].id);
  });
});
