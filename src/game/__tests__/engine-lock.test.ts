// The default game AI must not change: these games have to play out exactly as they did before coaching features.
// With WRITE_LOCK=1 this writes engine-lock.json instead of checking it. The last bits of floating-point math differ
// between CPU types, so a lock only holds on the machine type that recorded it, and other machines skip these tests.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runMatchSync } from "@/career/hs/play";
import { generateRoster } from "@/engine/player";
import type { LeagueId, Team, TeamTactics } from "@/engine/types";

const FILE = path.join(import.meta.dirname, "engine-lock.json");
const MACHINE = `${process.platform}-${process.arch}`;
const league = (id: LeagueId) => (JSON.parse(readFileSync(`src/data/generated/${id}.json`, "utf8")) as { teams: Team[] }).teams;
const CASES: { name: string; id: LeagueId; defense: TeamTactics["defense"]; seed: number }[] = [
  { name: "pro man", id: "pro", defense: "man", seed: 11 },
  { name: "pro zone", id: "pro", defense: "zone23", seed: 12 },
  { name: "college man", id: "college", defense: "man", seed: 13 },
  { name: "college press", id: "college", defense: "press", seed: 14 },
  { name: "hs man", id: "hs", defense: "man", seed: 15 },
  { name: "hs zone", id: "hs", defense: "zone32", seed: 16 },
];

function play(c: (typeof CASES)[number]) {
  const [a, b] = league(c.id);
  const m = runMatchSync({
    league: c.id,
    quarterMinutes: 3,
    seed: c.seed,
    home: { team: a, roster: generateRoster(a, 1), tactics: { defense: c.defense } },
    away: { team: b, roster: generateRoster(b, 2) },
  });
  return { home: m.state.teams[0].score, away: m.state.teams[1].score, possessions: m.state.possessions };
}

describe("the default engine", () => {
  if (process.env.WRITE_LOCK) {
    it("records the lock", () =>
      writeFileSync(FILE, `${JSON.stringify({ machine: MACHINE, games: Object.fromEntries(CASES.map((c) => [c.name, play(c)])) }, null, 2)}\n`));
    return;
  }
  const lock = JSON.parse(readFileSync(FILE, "utf8"));
  for (const c of CASES) it.skipIf(lock.machine !== MACHINE)(`plays ${c.name} exactly as before`, () => expect(play(c)).toEqual(lock.games[c.name]));
});
