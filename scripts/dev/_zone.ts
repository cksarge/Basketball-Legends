import fs from "node:fs";
import { Match } from "../../src/game/sim/match";
import { generateRoster } from "../../src/engine/player";
const teams = JSON.parse(fs.readFileSync("src/data/generated/pro.json", "utf8")).teams;
for (const def of ["man", "zone23"] as const) {
  const by: Record<string, { n: number; m: number; c: number }> = {};
  let fts = 0,
    poss = 0;
  for (let g = 0; g < 4; g++) {
    const [h, a] = [teams[g], teams[g + 10]];
    const m = new Match({
      league: "pro",
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
    for (const e of m.state.events) {
      if (e.t === "shot" && m.state.agents[e.shooter]?.team !== undefined) {
        const k = `${e.kind}${e.points === 3 ? "3" : ""}`;
        (by[k] ??= { n: 0, m: 0, c: 0 }).n++;
        by[k].c += e.contested;
      }
    }
    poss += m.state.possessions[1];
    fts += m.state.box && m.state.teams[1].roster.reduce((x, p) => x + m.state.box[p.id].fta, 0);
  }
  console.log(
    def,
    "away poss",
    poss / 4,
    "fta",
    fts / 4,
    Object.entries(by)
      .map(([k, v]) => `${k}:${(v.n / 4).toFixed(0)} c${(v.c / v.n).toFixed(2)}`)
      .join(" "),
  );
}
