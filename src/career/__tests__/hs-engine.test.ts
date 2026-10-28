// A full high school season where every one of your games runs through the real game engine.
import { describe, expect, it } from "vitest";
import { archetypesFor, randomAppearance } from "@/engine/player";
import { Rng } from "@/engine/rng";
import type { Team } from "@/engine/types";
import hs from "@/data/generated/hs.json";
import { DEFAULT_SETTINGS, createCareer, defaultBody } from "../create";
import { hsCalendar } from "../calendar";
import { outcomeFromMatch, runMatchSync } from "../hs/play";
import {
  advanceTo,
  applyTryout,
  applyUserGame,
  averages,
  currentSeason,
  finishSeason,
  hsContext,
  nextEvent,
  placeAtTryout,
  startSeason,
  userGames,
  userMatchSetup,
} from "../hs/season";

const teams = hs.teams as unknown as Team[];
const ctx = hsContext(teams);

describe("a real-engine season", () => {
  it("plays every game of a JV season with real box scores and finishes the year", () => {
    let c = createCareer(
      {
        firstName: "Engine",
        lastName: "Test",
        pos: "PG",
        archetype: archetypesFor("PG")[0],
        body: defaultBody("PG"),
        appearance: randomAppearance(new Rng(8)),
        jersey: 2,
        hometown: "Phoenix, AZ",
        schoolId: "hs-brophy-prep",
        allocation: { ballHandle: 10, passVision: 10, passAccuracy: 10, speed: 8, three: 7 },
        settings: DEFAULT_SETTINGS,
        startYear: 2026,
      },
      2024,
    );
    c = startSeason(c, 2026, ctx);
    c = advanceTo(c, hsCalendar(2026).tryouts, ctx);
    c = applyTryout(c, { ...placeAtTryout(c, ctx), level: "jv" });
    let played = 0;
    for (let guard = 0; guard < 40; guard++) {
      const ev = nextEvent(c);
      if (ev.kind !== "game") break;
      c = advanceTo(c, ev.date, ctx);
      const game = currentSeason(c)!.games.find((g) => g.id === ev.game.id)!;
      const m = runMatchSync(userMatchSetup(c, game, ctx));
      expect(m.state.phase).toBe("final");
      c = advanceTo(applyUserGame(c, game.id, outcomeFromMatch(m, false), ctx), game.date, ctx);
      played++;
    }
    const s = currentSeason(c)!;
    expect(played).toBeGreaterThan(10);
    const mine = userGames(s).concat(s.games.filter((g) => g.result?.box && g.level !== s.level));
    for (const g of mine.filter((x) => x.result?.box)) {
      const r = g.result!;
      expect(r.home).not.toBe(r.away);
      // your team's box adds up to your team's score
      const ours = g.homeId === s.schoolId ? r.home : r.away;
      expect(Object.values(r.box!).reduce((a, l) => a + l.pts, 0)).toBe(ours);
    }
    const levelsPlayed = (["frso", "jv", "varsity"] as const).filter((l) => s.stats[l]?.gp);
    expect(levelsPlayed.length).toBeGreaterThan(0);
    for (const l of levelsPlayed) expect(averages(s.stats[l])!.mpg).toBeGreaterThan(3);
    expect(nextEvent(c).kind).toBe("seasonEnd");
    c = finishSeason(advanceTo(c, hsCalendar(2026).seasonEnd, ctx), ctx);
    expect(currentSeason(c)!.grade).toBe(10);
  });
});
