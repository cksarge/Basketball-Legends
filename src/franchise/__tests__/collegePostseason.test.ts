import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collegeCalendar } from "@/career/calendar";
import type { Bracket } from "@/career/types";
import type { Conference, Team } from "@/engine/types";
import { simDay } from "../core/season";
import { createFranchise } from "../create";
import { defaultLeagueSettings } from "../settings";
import type { Franchise, LeagueSettings } from "../types";

const data = JSON.parse(readFileSync("src/data/generated/college.json", "utf8")) as { teams: Team[]; conferences: Conference[] };
const teams = data.teams;
const byTier = (tier: string) => teams.filter((t) => t.tier === tier);
const make = (team: Team, seed: string, patch: Partial<LeagueSettings["playoffFormat"]> = {}) => {
  const base = defaultLeagueSettings("college");
  return createFranchise({
    league: "college",
    team,
    teams,
    conferences: data.conferences,
    seed,
    now: 1,
    settings: { league: { ...base, playoffFormat: { ...base.playoffFormat, ...patch } } },
  });
};
function simSeason(f: Franchise) {
  for (let i = 0; i < 260 && f.phase !== "offseason"; i++) f = simDay(f, teams, { includeUser: true }).franchise;
  return f;
}
const d1 = simSeason(make(byTier("D1")[0], "post"));
const bracket = (f: Franchise, id: string) => f.season.brackets.find((b) => b.id === id);
const conferenceBrackets = (bs: Bracket[]) => bs.filter((b) => b.id.startsWith("conf-"));
const winnerOf = (f: Franchise, id: string) => {
  const g = f.season.games.find((x) => x.id === id)!;
  return g.result!.home > g.result!.away ? g.homeId : g.awayId;
};

describe("the college postseason", () => {
  it("every conference with 2 or more teams holds a tournament of up to 8", () => {
    const conferences = new Set(byTier("D1").map((t) => t.conferenceId));
    const held = conferenceBrackets(d1.season.brackets);
    expect(held).toHaveLength(conferences.size);
    for (const b of held) {
      expect(b.seeds.length).toBeGreaterThanOrEqual(2);
      expect(b.seeds.length).toBeLessThanOrEqual(8);
      expect(b.champion).toBeDefined();
      expect(b.name).toMatch(/Tournament$/);
      expect(b.name).not.toBe("Conference Tournament");
    }
  });

  it("tournament champions get automatic bids, and the field is 68 with four opening-round games", () => {
    const national = bracket(d1, "national")!;
    expect(national.seeds).toHaveLength(68);
    expect(national.playIn).toBe(true);
    expect(national.rounds[0]).toHaveLength(4);
    for (const b of conferenceBrackets(d1.season.brackets)) expect(national.seeds).toContain(b.champion);
  });

  it("a 64-team field has no opening round", () => {
    const f = simSeason(make(byTier("D1")[3], "sixty-four", { nationalField: 64 }));
    const national = bracket(f, "national")!;
    expect(national.seeds).toHaveLength(64);
    expect(national.playIn).toBe(false);
    expect(national.rounds[0]).toHaveLength(32);
  });

  it("with conference tournaments off, regular-season leaders get the automatic bids", () => {
    const f = simSeason(make(byTier("D1")[5], "no-tournaments", { conferenceTournaments: false }));
    expect(f.season.games.filter((g) => g.label?.includes("Tournament") && !g.label.includes("National"))).toHaveLength(0);
    const leaders = conferenceBrackets(f.season.brackets);
    expect(leaders.length).toBeGreaterThan(20);
    for (const b of leaders) {
      expect(b.rounds).toEqual([]);
      expect(bracket(f, "national")!.seeds).toContain(b.champion);
    }
  });

  it("the invitational takes the next 32 in Division I only", () => {
    const inv = bracket(d1, "invitational")!;
    expect(inv.seeds).toHaveLength(32);
    expect(inv.seeds.some((id) => bracket(d1, "national")!.seeds.includes(id))).toBe(false);
    const d2 = simSeason(make(byTier("D2")[0], "d2"));
    expect(bracket(d2, "invitational")).toBeUndefined();
    expect(bracket(d2, "national")!.seeds).toHaveLength(64);
  });

  it("the season ends when the national final is played, with one champion", () => {
    const national = bracket(d1, "national")!;
    const final = national.rounds.at(-1)!;
    expect(final).toHaveLength(1);
    expect(d1.phase).toBe("offseason");
    expect(d1.season.championId).toBe(national.champion);
    expect(winnerOf(d1, final[0])).toBe(d1.season.championId);
    expect(d1.date).toBe(d1.season.games.find((g) => g.id === final[0])!.date);
    expect(d1.season.games.find((g) => g.id === final[0])!.date).toBe(collegeCalendar(d1.season.year).national.at(-1));
  });

  it("outside divisions crown their own champions on the same calendar", () => {
    const outside = d1.season.outside!;
    const nationals = outside.brackets.filter((b) => b.id.startsWith("national"));
    expect(nationals.map((b) => b.id).sort()).toEqual(["national:D2", "national:D3"]);
    for (const b of nationals) expect(b.champion).toBeDefined();
    expect(outside.games.every((g) => g.result)).toBe(true);
    const ids = outside.games.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("college awards name real players in the division, once each", () => {
    const awards = d1.season.awards;
    const labels = awards.map((a) => a.label);
    expect(labels).toContain("Player of the Year");
    expect(labels).toContain("Defensive Player of the Year");
    expect(labels).toContain("Freshman of the Year");
    expect(labels.filter((l) => l === "All-American First Team")).toHaveLength(5);
    expect(labels.filter((l) => l.endsWith("Player of the Year") && l !== "Player of the Year" && l !== "Defensive Player of the Year")).toHaveLength(
      new Set(byTier("D1").map((t) => t.conferenceId)).size,
    );
    for (const a of awards) {
      expect(d1.players[a.playerId], a.label).toBeDefined();
      expect(d1.rosters[a.teamId]).toContain(a.playerId);
    }
    const ids = awards.map((a) => `${a.id}:${a.playerId}`);
    expect(new Set(ids).size).toBe(ids.length);
    const fresh = awards.find((a) => a.label === "Freshman of the Year")!;
    expect(d1.players[fresh.playerId].classYear).toBe("FR");
  });

  it("a full Division I season reaches the offseason with no open games", () => {
    expect(d1.offseason?.step).toBe("review");
    expect(d1.season.games.every((g) => g.result)).toBe(true);
  });
});
