import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { courtFor } from "@/game/court";
import type { Team } from "@/engine/types";
import { ALL_VARIANTS, pickVariant, variant, venueClearance, venueInterior, venueStretch } from "@/game3d/arena/variants";

const team = (over: Partial<Team>): Team =>
  ({
    id: "t1",
    league: "hs",
    name: "Town",
    nickname: "Hawks",
    abbrev: "TWN",
    city: "Town",
    state: "AZ",
    colors: { primary: "#aa2233", secondary: "#ffffff", accent: "#ffcc00" },
    logo: {},
    conferenceId: "c",
    prestige: 0.5,
    arena: { name: "Town Gym", capacity: 1500 },
    ...over,
  }) as Team;

describe("venues", () => {
  it("sizes high school gyms by capacity", () => {
    expect(pickVariant("gym", team({ arena: { name: "", capacity: 600 } }))).toBe("gym_small");
    expect(pickVariant("gym", team({ arena: { name: "", capacity: 4000 } }))).toBe("gym_modern");
    expect(["gym_classic", "gym_modern"]).toContain(pickVariant("gym", team({})));
  });

  it("puts big college programs in the campus arena and small ones in a fieldhouse", () => {
    expect(pickVariant("college", team({ league: "college", arena: { name: "", capacity: 15000 } }))).toBe("college_arena");
    expect(pickVariant("college", team({ league: "college", arena: { name: "", capacity: 2000 } }))).toBe("college_fieldhouse");
  });

  it("is stable per team", () => {
    const t = team({ id: "pro-x", league: "pro" });
    expect(pickVariant("pro", t)).toBe(pickVariant("pro", t));
  });

  it("ships a model and seat map for every venue", () => {
    for (const id of ALL_VARIANTS) {
      for (const f of [`${id}.glb`, `${id}.seats.json`]) expect(fs.existsSync(path.join("public/models/arenas", f)), f).toBe(true);
    }
  });

  it("keeps the broadcast camera above the crowd and inside the building", () => {
    for (const id of ALL_VARIANTS) {
      const v = variant(id);
      for (const league of ["hs", "pro"] as const) {
        const court = courtFor(league);
        // floor and apron are always clear
        expect(venueClearance(v, court, 0, 2, court.halfW + 1)).toBe(0);
        // the stretched building still covers the court
        expect(venueInterior(v, court).x).toBeGreaterThan(court.halfL + 2);
        expect(venueStretch(v, court)).toBeGreaterThan(0.85);
      }
    }
    // front rows of a bowl need head room; the top rows need more
    const pro = variant("pro_bowl");
    const court = courtFor("pro");
    const front = venueClearance(pro, court, 0, 3, court.halfW + 2.2 + 2.0);
    const back = venueClearance(pro, court, 0, 3, court.halfW + 2.2 + 15);
    expect(front).toBeGreaterThan(1.7);
    expect(back).toBeGreaterThan(front);
  });
});
