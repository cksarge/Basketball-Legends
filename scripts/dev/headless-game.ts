// Dev harness: simulate full real-time matches headlessly and print stats.
//   npx tsx scripts/dev/headless-game.ts [games] [league]
import fs from "node:fs";
import { Match } from "../../src/game/sim/match";
import { generateRoster } from "../../src/engine/player";
import type { Team } from "../../src/engine/types";
import { teamTotals, fmtPct } from "../../src/game/sim/stats";

const games = Number(process.argv[2] ?? 3);
const league = (process.argv[3] ?? "pro") as "pro" | "college" | "hs";
const data = JSON.parse(fs.readFileSync(`src/data/generated/${league}.json`, "utf8")) as { teams: Team[] };
const agg = { pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, tov: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, pf: 0, poss: 0 };
const t0 = Date.now();
for (let g = 0; g < games; g++) {
  const h = data.teams[(g * 7) % data.teams.length],
    a = data.teams[(g * 7 + 3) % data.teams.length];
  const m = new Match({ league, home: { team: h, roster: generateRoster(h) }, away: { team: a, roster: generateRoster(a) }, fast: true, seed: g + 1 });
  let steps = 0;
  while (m.state.phase !== "final" && steps < 60 * 60 * 200) {
    m.step(1 / 60);
    steps++;
  }
  const s = m.state;
  const lines = s.teams.map((t) =>
    teamTotals(
      s.box,
      t.roster.map((p) => p.id),
    ),
  );
  console.log(`${h.name} ${s.teams[0].score} - ${s.teams[1].score} ${a.name}  (periods ${s.period}, steps ${steps}, poss ${s.possessions.join("/")})`);
  for (const [i, l] of lines.entries()) {
    console.log(
      `   ${i ? "away" : "home"} FG ${l.fgm}/${l.fga} ${fmtPct(l.fgm, l.fga)}  3P ${l.tpm}/${l.tpa} ${fmtPct(l.tpm, l.tpa)}  FT ${l.ftm}/${l.fta}  REB ${l.oreb}+${l.dreb}  AST ${l.ast} STL ${l.stl} BLK ${l.blk} TOV ${l.tov} PF ${l.pf}`,
    );
    for (const k of Object.keys(agg) as (keyof typeof agg)[]) if (k !== "poss") agg[k] += (l as unknown as Record<string, number>)[k] ?? 0;
  }
  agg.poss += s.possessions[0] + s.possessions[1];
  const tos = s.events
    .filter((e) => e.t === "turnover" || e.t === "violation")
    .map((e) => (e.t === "violation" ? e.kind : e.t === "turnover" ? e.reason : ""))
    .reduce((acc, k) => ((acc[k] = (acc[k] ?? 0) + 1), acc), {} as Record<string, number>);
  console.log("   TO/violations:", JSON.stringify(tos));
}
const n = games * 2;
console.log(
  `\nper team: PTS ${(agg.pts / n).toFixed(1)}  FG ${fmtPct(agg.fgm, agg.fga)} (${(agg.fga / n).toFixed(1)} FGA)  3P ${fmtPct(agg.tpm, agg.tpa)} (${(agg.tpa / n).toFixed(1)} 3PA)  FT ${fmtPct(agg.ftm, agg.fta)} (${(agg.fta / n).toFixed(1)})  TOV ${(agg.tov / n).toFixed(1)}  OREB ${(agg.oreb / n).toFixed(1)} DREB ${(agg.dreb / n).toFixed(1)}  AST ${(agg.ast / n).toFixed(1)} STL ${(agg.stl / n).toFixed(1)} BLK ${(agg.blk / n).toFixed(1)} PF ${(agg.pf / n).toFixed(1)}  POSS ${(agg.poss / n).toFixed(1)}`,
);
console.log(`elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);
