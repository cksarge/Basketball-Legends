// Dev harness: compare defensive schemes over a few games.   npx tsx scripts/dev/defense-compare.ts [games] [league]
import fs from "node:fs";
import { Match } from "../../src/game/sim/match";
import { generateRoster } from "../../src/engine/player";
import { teamTotals, fmtPct } from "../../src/game/sim/stats";
import type { TeamTactics } from "../../src/engine/types";

const games = Number(process.argv[2] ?? 6);
const league = (process.argv[3] ?? "pro") as "pro" | "college" | "hs";
const teams = JSON.parse(fs.readFileSync(`src/data/generated/${league}.json`, "utf8")).teams;
for (const def of ["man", "zone23", "zone32", "press"] as TeamTactics["defense"][]) {
  let stl = 0,
    tov = 0,
    pts = 0,
    bc = 0,
    fgm = 0,
    fga = 0,
    tpa = 0,
    fta = 0,
    oreb = 0;
  for (let g = 0; g < games; g++) {
    const [h, a] = [teams[g % teams.length], teams[(g + 10) % teams.length]];
    const m = new Match({
      league,
      home: { team: h, roster: generateRoster(h), tactics: { defense: def } },
      away: { team: a, roster: generateRoster(a) },
      fast: true,
      seed: g + 1,
    });
    let n = 0;
    while (m.state.phase !== "final" && n < 60 * 60 * 200) {
      m.step(1 / 60);
      n++;
    }
    const opp = teamTotals(
      m.state.box,
      m.state.teams[1].roster.map((p) => p.id),
    );
    stl += teamTotals(
      m.state.box,
      m.state.teams[0].roster.map((p) => p.id),
    ).stl;
    tov += opp.tov;
    pts += opp.pts;
    fgm += opp.fgm;
    fga += opp.fga;
    tpa += opp.tpa;
    fta += opp.fta;
    oreb += opp.oreb;
    bc += m.state.events.filter((e) => e.t === "violation" && (e.kind === "eightSeconds" || e.kind === "tenSeconds") && e.team === 1).length;
  }
  console.log(
    `${def.padEnd(7)} opp PTS ${(pts / games).toFixed(1)}  FG ${fmtPct(fgm, fga)} (${(fga / games).toFixed(0)} FGA)  FTA ${(fta / games).toFixed(1)}  OREB ${(oreb / games).toFixed(1)}  3PA ${(tpa / games).toFixed(1)}  TOV ${(tov / games).toFixed(1)}  STL ${(stl / games).toFixed(1)}  half-court violations ${(bc / games).toFixed(1)}`,
  );
}
