import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Rng } from "@/engine/rng";
import { playerOvr } from "@/engine/player";
import type { Conference, Player, Team } from "@/engine/types";
import { canRedshirt, declareChance, pitch, projection, setRedshirt } from "../college/eligibility";
import { SCHOLARSHIPS, openScholarships, recruitAction } from "../college/recruiting";
import { advanceOffseason, canAdvance } from "../core/offseason";
import { simDay } from "../core/season";
import { simOffseason } from "../auto";
import { createFranchise } from "../create";
import { HALL_BARS, hallScore } from "../history/hall";
import { leagueModule } from "../leagues";
import type { Franchise, RetiredPlayer } from "../types";

const data = JSON.parse(readFileSync("src/data/generated/college.json", "utf8")) as { teams: Team[]; conferences: Conference[] };
const teams = data.teams;
const d1 = teams.filter((t) => t.tier === "D1");
const team = [...d1].sort((a, b) => b.prestige - a.prestige)[20];
const make = (seed = "off") => createFranchise({ league: "college", team, teams, conferences: data.conferences, seed, now: 1 });
function simSeason(f: Franchise) {
  for (let i = 0; i < 260 && f.phase !== "offseason"; i++) f = simDay(f, teams, { includeUser: true }).franchise;
  return f;
}
/** Advances one step, the way the Continue button does. */
const next = (f: Franchise) => advanceOffseason(f, teams);
const until = (f: Franchise, step: string) => {
  for (let i = 0; i < 8 && f.offseason?.step !== step; i++) f = next(f);
  return f;
};
const ended = simSeason(make());
const year = ended.season.year;
const used = (p: Player) => p.file!.eligibility!.used;

describe("the college offseason", () => {
  it("walks review, declarations, portal, signing, progress and camp", () => {
    let f = ended;
    const seen: string[] = [];
    const dates: Record<string, string> = {};
    for (let i = 0; i < 8 && f.offseason; i++) {
      seen.push(f.offseason.step);
      dates[f.offseason.step] = f.date;
      f = next(f);
    }
    expect(seen).toEqual(["review", "declarations", "portal", "signing", "progress", "camp"]);
    expect(dates.declarations).toBe(`${year + 1}-04-20`);
    expect(dates.signing).toBe(`${year + 1}-05-01`);
    expect(dates.camp).toBe(`${year + 1}-10-01`);
    expect(f.phase).toBe("regular");
    expect(f.season.year).toBe(year + 1);
    expect(f.season.outside!.games.length).toBeGreaterThan(9000);
    expect(f.college!.classYear).toBe(year + 2);
  });

  it("a redshirt keeps a year of eligibility, once per career, and only with 4 or fewer games played", () => {
    const fresh = make("rs");
    const id = fresh.rosters[fresh.teamId].find((x) => used(fresh.players[x]) === 0)!;
    expect(canRedshirt(fresh, id)).toBe(true);
    const rs = setRedshirt(fresh, id, true);
    expect(rs.players[id].file!.eligibility).toMatchObject({ used: 0, redshirted: true, year: fresh.season.year });
    // a redshirt sits
    const week = (() => {
      let f = rs;
      for (let i = 0; i < 20; i++) f = simDay(f, teams, { includeUser: true }).franchise;
      return f;
    })();
    expect(week.season.stats[id]).toBeUndefined();
    const played = { ...fresh, season: { ...fresh.season, stats: { [id]: { ...fresh.season.stats[id], gp: 5 } as never } } };
    expect(canRedshirt(played, id)).toBe(false);
    const later = { ...rs, season: { ...rs.season, year: rs.season.year + 1 } };
    expect(canRedshirt(later, id)).toBe(false);
    // the redshirt year doesn't count
    let f = simSeason(rs);
    f = until(f, "camp");
    if (f.players[id]) expect(used(f.players[id])).toBe(0);
  });

  it("players leave after four seasons played, and a redshirted player can play a fifth as GR", () => {
    const seniors = ended.rosters[ended.teamId].filter((id) => used(ended.players[id]) === 3);
    const vet = seniors[0];
    const redshirted = {
      ...ended,
      players: {
        ...ended.players,
        [vet]: { ...ended.players[vet], file: { ...ended.players[vet].file!, eligibility: { used: 2, redshirted: true, year: year - 2 } } },
      },
    };
    const after = until(redshirted, "camp");
    for (const id of seniors.slice(1)) expect(after.rosters[after.teamId]).not.toContain(id);
    if (!after.college!.declared.some((d) => d.id === vet) && after.players[vet]?.teamId) {
      expect(after.players[vet].classYear).toBe("GR");
      expect(used(after.players[vet])).toBe(3);
    }
  });

  it("projected players declare more often as they get older, and a pitch helps starters most", () => {
    const star = Object.values(ended.players).find((p) => projection(p) === "first round" || projection(p) === "lottery")!;
    const at = (n: number) => ({ ...star, file: { ...star.file!, eligibility: { used: n, redshirted: false } } });
    expect(declareChance(at(2), ended)).toBeGreaterThan(declareChance(at(0), ended));
    const nobody = Object.values(ended.players).find((p) => projection(p) === null)!;
    expect(declareChance(nobody, ended)).toBe(0);
    // over many tries, pitches keep starters more often than bench players
    const declared = until(ended, "declarations");
    const mine = declared.college!.declared.map((d) => d.id).filter((id) => declared.rosters[declared.teamId].includes(id));
    for (const id of mine) {
      const once = pitch(declared, id);
      expect(once.college!.pitched).toContain(id);
      expect(pitch(once, id)).toBe(once);
    }
  });

  it("declared players leave at progress with news of their projection", () => {
    const declared = until(ended, "declarations");
    const leaving = declared.college!.declared;
    expect(leaving.length).toBeGreaterThan(0);
    const done = until(declared, "camp");
    for (const d of leaving) expect(Object.values(done.rosters).some((ids) => ids.includes(d.id))).toBe(false);
    expect(done.news.some((n) => n.kind === "draft" && /declared/.test(n.text))).toBe(true);
  });

  it("signed recruits arrive as freshmen with no eligibility used", () => {
    const signed = until(ended, "progress");
    const coming = until(ended, "signing").college!.recruits.filter((r) => r.signed && r.kind === "hs");
    expect(coming.length).toBeGreaterThan(0);
    for (const r of coming.slice(0, 50)) {
      const p = signed.players[r.id];
      expect(p.teamId).toBe(r.committed);
      expect(signed.rosters[r.committed!]).toContain(r.id);
      expect(p.classYear).toBe("FR");
      expect(p.file!.eligibility).toEqual({ used: 0, redshirted: false });
    }
    expect(signed.college!.recruits.filter((r) => r.kind === "hs")).toHaveLength(0);
  });

  it("camp fills short rosters with walk-ons, who use no scholarship", () => {
    const camp = until(ended, "camp");
    for (const t of d1) {
      const ids = camp.rosters[t.id];
      expect(ids.length, t.id).toBeGreaterThanOrEqual(13);
      expect(ids.length, t.id).toBeLessThanOrEqual(15);
      const funded = ids.filter((id) => !camp.players[id].file!.walkOn).length;
      expect(funded, t.id).toBeLessThanOrEqual(SCHOLARSHIPS.D1);
    }
    const walkOns = Object.values(camp.players).filter((p) => p.file?.walkOn && p.id.startsWith("w"));
    expect(walkOns.length).toBeGreaterThan(0);
  });

  it("a declaration or transfer that leaves more commitments than scholarships is caught at the portal step", () => {
    let f = until(ended, "portal");
    // a recruit commits to every open spot, then a declared player decides to stay
    const open = openScholarships(f, f.teamId);
    const extra = f.college!.recruits.filter((r) => !r.committed && r.kind === "hs").slice(0, open + 1);
    f = {
      ...f,
      college: {
        ...f.college!,
        recruits: f.college!.recruits.map((r) => (extra.includes(r) ? { ...r, committed: f.teamId, offers: { ...r.offers, [f.teamId]: 0 } } : r)),
      },
    };
    const check = canAdvance(f);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toMatch(/commit/);
    // pulling one commitment fixes it
    const pulled = recruitAction(f, extra[0].id, "pullOffer", teams);
    expect("error" in pulled).toBe(false);
    expect(canAdvance(pulled as Franchise).ok).toBe(true);
    // with auto roster on, it's fixed for the user
    const auto = { ...f, settings: { ...f.settings, auto: { ...f.settings.auto, roster: true } } };
    expect(next(auto).offseason?.step).toBe("signing");
  });

  it("with everything off and only Continue pressed, the offseason finishes", () => {
    const off = {
      ...ended,
      settings: { ...ended.settings, auto: Object.fromEntries(Object.keys(ended.settings.auto).map((k) => [k, false])) as Franchise["settings"]["auto"] },
    };
    let f = off;
    for (let i = 0; i < 12 && f.offseason; i++) {
      const can = canAdvance(f);
      if (!can.ok) {
        // the only stop is a short roster at camp, which walk-ons fix
        expect(f.offseason.step).toBe("camp");
        f = leagueModule("college").fixRoster(f);
      }
      f = next(f);
    }
    expect(f.phase).toBe("regular");
  });

  it("with auto recruiting on, the user's program recruits, pitches and signs like an AI program", () => {
    const auto = make("auto");
    const on = { ...auto, settings: { ...auto.settings, auto: { ...auto.settings.auto, recruiting: true } } };
    let f = on;
    for (let i = 0; i < 60; i++) f = simDay(f, teams, { includeUser: true }).franchise;
    const spent = f.college!.recruits.filter((r) => (r.interest[f.teamId] ?? 0) > 0).length;
    expect(spent).toBeGreaterThan(0);
    const season = simSeason(f);
    const done = simOffseason(season, teams);
    expect(done.phase).toBe("regular");
    expect(done.history.length).toBe(1);
    const declared = until(season, "declarations");
    const mine = declared.college!.declared.filter((d) => declared.rosters[declared.teamId].includes(d.id));
    if (mine.length) expect(simOffseason(declared, teams).college).toBeDefined();
  });

  it("college greats reach the Hall at the college bar", () => {
    expect(HALL_BARS.college).toBeLessThan(HALL_BARS.pro);
    const great: RetiredPlayer = {
      id: "g",
      name: "Great",
      pos: "PG",
      year,
      age: 22,
      peak: 80,
      lastTeamId: team.id,
      career: { seasons: 4, gp: 128, min: 0, pts: 2600, reb: 600, ast: 700, stl: 0, blk: 0, bestSeasonPts: 800 },
      awards: 6,
      titles: 1,
    };
    expect(hallScore(great)).toBeGreaterThanOrEqual(HALL_BARS.college);
    expect(hallScore(great)).toBeLessThan(HALL_BARS.pro);
  });
});

describe("growth by league", () => {
  it("college players grow about 3 a year", async () => {
    const { progressPlayer } = await import("../core/progress");
    const young = Object.values(ended.players).filter((p) => p.age <= 21 && p.teamId);
    const gain = young.reduce((s, p) => s + playerOvr(progressPlayer(p, new Rng(p.id), 0, 1, "college")) - playerOvr(p), 0) / young.length;
    expect(gain).toBeGreaterThan(2);
    expect(gain).toBeLessThan(5);
  });
});
