import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runMatchSync } from "@/career/hs/play";
import { generateRoster, teamTalentTarget } from "@/engine/player";
import type { Player, Team, TeamTactics } from "@/engine/types";
import { exportAIMemory } from "../sim/ai";
import { Match, type MatchSetup } from "../sim/match";
import { PLAYS, SYSTEMS, routeSpot, type PlayId, type SystemId } from "../sim/playbook";
import { focusAgent } from "../sim/plays";
import { emptyLine, type StatLine } from "../sim/stats";

const teams = [...(JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams].sort(
  (a, b) => teamTalentTarget(a) - teamTalentTarget(b),
);
const [home, away] = [teams[14], teams[15]];
const rh = generateRoster(home, 1),
  ra = generateRoster(away, 2);
const setup = (tactics: Partial<TeamTactics>, seed: number): MatchSetup => ({
  league: "pro",
  quarterMinutes: 6,
  seed,
  home: { team: home, roster: rh, tactics },
  away: { team: away, roster: ra },
});

const GAMES = 24;
function measure(tactics: Partial<TeamTactics>) {
  const t = emptyLine();
  const by: Record<string, StatLine> = {};
  for (let i = 0; i < GAMES; i++) {
    const m = runMatchSync(setup(tactics, 900 + i));
    for (const p of rh) {
      const l = m.state.box[p.id];
      if (!l) continue;
      by[p.id] ??= emptyLine();
      for (const k of Object.keys(l) as (keyof StatLine)[]) {
        t[k] += l[k];
        by[p.id][k] += l[k];
      }
    }
  }
  const shots = Object.values(by).reduce((s, l) => s + l.fga, 0);
  const bigs = rh.filter((p: Player) => p.pos === "C" || p.pos === "PF").reduce((s, p) => s + (by[p.id]?.fga ?? 0), 0);
  return { t, bigShare: bigs / shots, topShare: Math.max(...Object.values(by).map((l) => l.fga)) / shots };
}
const base = measure({});
const runs = new Map<SystemId, ReturnType<typeof measure>>();
const run = (system: SystemId) => {
  if (!runs.has(system)) runs.set(system, measure({ system, plays: SYSTEMS[system].plays }));
  return runs.get(system)!;
};

describe("systems change how a team plays", () => {
  it("post-up goes to the bigs more", () => {
    expect(run("postUp").bigShare).toBeGreaterThan(base.bigShare * 1.05);
  });
  it("pace and space takes more threes", () => {
    expect(run("paceSpace").t.tpa).toBeGreaterThan(base.t.tpa * 1.08);
  });
  it("iso-star creates its own shots", () => {
    const r = run("isoStar");
    expect(r.t.ast / r.t.fgm).toBeLessThan((base.t.ast / base.t.fgm) * 0.93);
  });
  it("motion assists more of its baskets", () => {
    const r = run("motion");
    expect(r.t.ast / r.t.fgm).toBeGreaterThan((base.t.ast / base.t.fgm) * 1.05);
  });
  it("pick-and-roll runs more screens", () => {
    const screens = (tactics: Partial<TeamTactics>) => {
      let n = 0;
      const m = new Match({ ...setup(tactics, 7), fast: true });
      for (const a of m.state.agents) a.human = null;
      for (let i = 0; i < 12_000 && m.state.phase !== "final"; i++) {
        m.step(1 / 30);
        const h = m.handler();
        if (h?.team === 0 && exportAIMemory(m)[h.idx]?.plan === "pnr") n++;
      }
      return n;
    };
    expect(screens({ system: "pickRoll", plays: SYSTEMS.pickRoll.plays })).toBeGreaterThan(screens({}) * 1.3);
  });
});

// Balance takes far more games than a normal run can afford: a 24-game sample swings about 10%. SOAK=1 runs it.
describe.runIf(process.env.SOAK)("no system is a trap or a cheat code", () => {
  const GAMES_EACH = 100;
  function winsWith(tactics: Partial<TeamTactics>) {
    let wins = 0;
    for (let i = 0; i < GAMES_EACH; i++) {
      const [h, a] = [teams[(i * 3) % 30], teams[(i * 3 + 7) % 30]];
      const g = runMatchSync({
        league: "pro",
        quarterMinutes: 6,
        seed: 4000 + i,
        home: { team: h, roster: generateRoster(h, i), tactics },
        away: { team: a, roster: generateRoster(a, i + 500) },
      });
      if (g.state.teams[0].score > g.state.teams[1].score) wins++;
    }
    return wins;
  }
  for (const id of Object.keys(SYSTEMS) as SystemId[])
    it(`${id} wins a fair share`, { timeout: 300_000 }, () => {
      const wins = winsWith({ system: id, plays: SYSTEMS[id].plays });
      expect(wins).toBeGreaterThan(35);
      expect(wins).toBeLessThan(62);
    });
});

describe("plays", () => {
  it("has real plays in every system, and six or fewer", () => {
    for (const s of Object.values(SYSTEMS)) {
      expect(s.plays.length).toBeGreaterThan(0);
      expect(s.plays.length).toBeLessThanOrEqual(6);
      for (const id of s.plays) expect(PLAYS[id].id).toBe(id);
    }
  });

  it("sends every route to a spot inside the court, at both ends", () => {
    const m = new Match(setup({}, 1));
    const c = m.state.cfg.court;
    for (const id of Object.keys(PLAYS) as PlayId[])
      for (const side of [1, -1] as const) {
        const spot = routeSpot(PLAYS[id], side, side * (c.halfL - c.rimFromBaseline));
        if (!spot) continue;
        expect(Math.abs(spot.x)).toBeLessThan(c.halfL);
        expect(Math.abs(spot.z)).toBeLessThan(c.halfW);
      }
  });

  it("falls back to normal offense when nobody on the floor fits", () => {
    const guards = rh.map((p): Player => ({ ...p, pos: "PG", secondaryPos: undefined }));
    const m = new Match({
      ...setup({ system: "postUp", plays: ["postEntry"] }, 3),
      home: { team: home, roster: guards, tactics: { system: "postUp", plays: ["postEntry"] } },
      fast: true,
    });
    expect(focusAgent(m, 0, PLAYS.postEntry)).toBeNull();
    m.state.teams[0].playCall = "postEntry";
    for (const a of m.state.agents) a.human = null;
    let i = 0;
    while (m.state.phase !== "final" && i++ < 150_000) m.step(1 / 30);
    expect(m.state.phase).toBe("final");
    expect(m.state.teams[0].score).toBeGreaterThan(0);
  });

  it("finishes when a called play's focus player leaves the floor", () => {
    const m = new Match({ ...setup({ system: "isoStar", plays: ["clearout"] }, 4), fast: true });
    for (const a of m.state.agents) a.human = null;
    for (let i = 0; i < 400; i++) m.step(1 / 30);
    m.state.teams[0].playCall = "clearout";
    const star = focusAgent(m, 0, PLAYS.clearout)!;
    const bench = rh.find((p) => !m.state.teams[0].onCourt.includes(p.id))!;
    m.substitute(0, star.player.id, bench.id);
    let i = 0;
    while (m.state.phase !== "final" && i++ < 150_000) m.step(1 / 30);
    expect(m.state.phase).toBe("final");
  });

  it("stops holding the ball for a play that has run out of time", () => {
    const m = new Match({ ...setup({ system: "motion", plays: ["floppy"] }, 5), fast: true });
    for (const a of m.state.agents) a.human = null;
    const seen = new Set<string | null>();
    let i = 0;
    while (m.state.phase !== "final" && i++ < 20_000) {
      m.step(1 / 30);
      seen.add(m.state.teams[0].playCall);
    }
    expect(seen).toContain("floppy");
    expect(seen).toContain(null);
  });
});

describe("calling plays", () => {
  const coached = (plays: PlayId[]) => new Match({ ...setup({ system: "motion", plays }, 8), fast: true });

  it("calls a play in the book", () => {
    const m = coached(["floppy", "backdoor"]);
    expect(m.callPlay(0, "floppy")).toBe(true);
    expect(m.state.teams[0].playCall).toBe("floppy");
  });

  it("refuses a play that isn't in the book", () => {
    const m = coached(["floppy"]);
    expect(m.callPlay(0, "clearout")).toBe(false);
    expect(m.state.teams[0].playCall).toBeNull();
  });

  it("cycles through the book with the call button, and wraps", () => {
    const m = coached(["floppy", "backdoor"]);
    const press = () => {
      m.nextPlay(0);
      return m.state.teams[0].playCall;
    };
    expect([press(), press(), press()]).toEqual(["floppy", "backdoor", "floppy"]);
  });

  it("still calls a pick-and-roll with no system", () => {
    const m = new Match({ ...setup({}, 8), fast: true });
    m.nextPlay(0);
    expect(m.state.teams[0].playCall).toBe("pnr");
  });

  it("announces the play", () => {
    const m = coached(["floppy"]);
    m.callPlay(0, "floppy");
    expect(m.state.events.some((e) => e.t === "play" && e.team === 0 && e.name === "Floppy")).toBe(true);
  });
});

describe("older saved games", () => {
  it("resume with no system", () => {
    const m = runMatchSync({ ...setup({}, 6), quarterMinutes: 1 });
    const live = new Match({ ...setup({}, 6), fast: true });
    for (let i = 0; i < 300; i++) live.step(1 / 30);
    const old = JSON.parse(live.serialize());
    delete old.state.teams[0].tactics.system;
    delete old.state.teams[0].tactics.plays;
    delete old.state.teams[0].playUntil;
    const back = Match.restore({ ...setup({}, 6), fast: true }, JSON.stringify(old));
    for (let i = 0; i < 500; i++) back.step(1 / 30);
    expect(back.state.time).toBeGreaterThan(live.state.time);
    expect(m.state.phase).toBe("final");
  });
});
