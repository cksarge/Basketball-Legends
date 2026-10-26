import fs from "node:fs";
import { Match } from "../../src/game/sim/match";
import { generateRoster } from "../../src/engine/player";
import type { Team } from "../../src/engine/types";
const data = JSON.parse(fs.readFileSync(`src/data/generated/pro.json`, "utf8")) as { teams: Team[] };
const h = data.teams[0], a = data.teams[3];
const m = new Match({ league: "pro", home: { team: h, roster: generateRoster(h) }, away: { team: a, roster: generateRoster(a) }, fast: true, seed: 1 });
const out: Record<string, number> = {}; let cur: { minD: number; kind: string; phase: string; errant: boolean; dist: number } | null = null;
const sailed: string[] = [];
for (let i = 0; i < 60 * 60 * 40 && m.state.phase !== "final"; i++) {
  m.step(1 / 60);
  const s = m.state;
  if (s.ball.mode === "pass" && s.ball.pass) {
    const p = s.ball.pass; const b = s.ball.phys;
    if (!cur) cur = { minD: 99, kind: p.kind, phase: s.phase, errant: p.to < 0, dist: p.to >= 0 ? Math.hypot(s.agents[p.from].pos.x - s.agents[p.to].pos.x, s.agents[p.from].pos.z - s.agents[p.to].pos.z) : 0 };
    if (p.to >= 0) { const r = s.agents[p.to]; cur.minD = Math.min(cur.minD, Math.hypot(r.pos.x - b.pos.x, r.pos.z - b.pos.z)); }
  } else if (cur) {
    const k = s.ball.mode === "loose" ? `loose:${s.ball.looseCause}${cur.errant ? ":errant" : ""}` : s.ball.owner !== null ? "caught" : s.ball.mode;
    out[k] = (out[k] ?? 0) + 1;
    if (k.startsWith("loose:sailed") && sailed.length < 8) sailed.push(`${cur.phase} ${cur.kind} minD=${cur.minD.toFixed(2)} dist=${cur.dist.toFixed(1)} errant=${cur.errant}`);
    cur = null;
  }
}
console.log(out); console.log(sailed.join("\n"));
