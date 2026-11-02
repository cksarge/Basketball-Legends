import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Team } from "@/engine/types";
import { emptyLine } from "@/game/sim/stats";
import { createFranchise } from "../create";
import { addSeason, archiveSeason } from "../history/career";
import type { Franchise, SeasonLine } from "../types";

const teams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const f = createFranchise({ league: "pro", team: teams[0], teams, seed: "career", now: 1 });
const id = f.rosters[teams[1].id][0];
const line = (pts: number, gp = 60): SeasonLine => ({ ...emptyLine(), gp, gs: gp, pts, ast: 100, stl: 10, blk: 5 });

describe("career totals", () => {
  it("a season adds up in a player's career totals", () => {
    let p = addSeason(f.players[id], line(1200), f);
    p = addSeason(p, line(1500, 70), f);
    expect(p.file?.career).toMatchObject({ seasons: 2, gp: 130, pts: 2700, ast: 200, stl: 20, blk: 10, bestSeasonPts: 1500 });
  });

  it("a traded player's totals include both teams", () => {
    const moved = { ...f.players[id], teamId: teams[2].id };
    expect(addSeason(moved, line(900), f).file?.career?.pts).toBe(900);
  });

  it("a player with no games adds no season", () => {
    expect(addSeason(f.players[id], undefined, f).file?.career).toBeUndefined();
    expect(addSeason(f.players[id], line(0, 0), f).file?.career).toBeUndefined();
  });

  it("awards and titles count once each", () => {
    const won: Franchise = {
      ...f,
      season: {
        ...f.season,
        championId: teams[1].id,
        championRoster: [id],
        awards: [
          { id: "mvp", label: "MVP", playerId: id, teamId: teams[1].id },
          { id: "finalsMvp", label: "Finals MVP", playerId: id, teamId: teams[1].id },
          { id: "dpoy", label: "DPOY", playerId: "someone", teamId: teams[1].id },
        ],
      },
    };
    const p = addSeason(f.players[id], line(1000), won);
    expect(p.file).toMatchObject({ awards: 2, titles: 1 });
  });

  it("a season's games can be dropped when it's archived", () => {
    const s = { ...f.season, stats: { [id]: line(10) }, awards: [{ id: "mvp", label: "MVP", playerId: id, teamId: teams[1].id }] };
    const old = archiveSeason(s);
    expect(old.games).toEqual([]);
    expect(old.stats).toEqual(s.stats);
    expect(old.awards).toEqual(s.awards);
    expect(old.year).toBe(s.year);
  });
});
