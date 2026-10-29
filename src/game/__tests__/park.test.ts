import { describe, expect, it } from "vitest";
import pro from "@/data/generated/pro.json";
import { Match } from "../sim/match";
import { generateRoster } from "@/engine/player";
import type { Team } from "@/engine/types";
import type { ParkRules } from "../sim/state";
import { isThree, rimPos } from "../court";

const teams = (pro as { teams: Team[] }).teams;

function parkMatch(rules: Partial<ParkRules> & { n?: number }, seed = 3, fast = true) {
  const n = rules.n ?? 3;
  const r: ParkRules = { game: "team", halfCourt: true, scoring: "ones", target: 15, winBy: 2, makeItTakeIt: false, ...rules };
  const a = generateRoster(teams[seed]),
    b = generateRoster(teams[seed + 7]);
  return new Match({
    league: "pro",
    home: { team: teams[seed], roster: r.game === "21" ? a.slice(0, 1) : a.slice(0, n) },
    away: { team: teams[seed + 7], roster: r.game === "21" ? b.slice(0, n - 1) : b.slice(0, n) },
    seed,
    fast,
    park: r,
  });
}

const run = (m: Match, minutes = 40) => {
  for (let i = 0; i < 60 * 60 * minutes && m.state.phase !== "final"; i++) m.step(1 / 60);
  return m;
};
const parkEvents = (m: Match, kind: string) => m.state.events.filter((e) => e.t === "park" && e.kind === kind);

describe("park games", () => {
  it("every team size, half and full court, plays to the target and ends cleanly", () => {
    for (const n of [1, 2, 3, 4, 5])
      for (const halfCourt of [true, false]) {
        const m = run(parkMatch({ n, halfCourt, target: 11 }, n + (halfCourt ? 0 : 10)));
        const [h, a] = m.state.teams.map((t) => t.score);
        expect(m.state.phase).toBe("final");
        expect(Math.max(h, a)).toBeGreaterThanOrEqual(11);
        expect(Math.abs(h - a)).toBeGreaterThanOrEqual(2);
        expect(m.state.agents).toHaveLength(n * 2);
        expect(m.watchdogTrips).toBe(0);
        // no officials, no free throws, no clock
        expect(m.state.crew).toBeNull();
        expect(m.state.events.some((e) => e.t === "freeThrow")).toBe(false);
        expect(m.state.clock).toBeGreaterThan(1e8);
      }
  });

  it("1s and 2s: baskets are worth 1 inside the arc and 2 beyond; 2s and 3s: 2 and 3", () => {
    for (const scoring of ["ones", "twos"] as const) {
      const m = run(parkMatch({ scoring, target: 21 }, 5));
      const pts = new Set(m.state.events.filter((e) => e.t === "make").map((e) => (e as { points: number }).points));
      for (const p of pts) expect(scoring === "ones" ? [1, 2] : [2, 3]).toContain(p);
    }
  });

  it("win by 1 can end on a one-point lead; win by 2 never does", () => {
    let oneOk = false;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const m = run(parkMatch({ winBy: 1, target: 7, n: 1 }, seed));
      const [h, a] = m.state.teams.map((t) => t.score);
      expect(Math.max(h, a)).toBe(7);
      if (Math.abs(h - a) === 1) oneOk = true;
      const m2 = run(parkMatch({ winBy: 2, target: 7, n: 1 }, seed));
      const [h2, a2] = m2.state.teams.map((t) => t.score);
      expect(Math.abs(h2 - a2)).toBeGreaterThanOrEqual(2);
    }
    expect(oneOk).toBe(true);
  });

  it("make it, take it: the scoring team checks the ball next; otherwise the other team does", () => {
    for (const makeItTakeIt of [true, false]) {
      const m = run(parkMatch({ makeItTakeIt, target: 11 }, 9));
      // over a full game, every basket is followed by a check
      expect(parkEvents(m, "check").length).toBeGreaterThan(m.state.events.filter((e) => e.t === "make").length * 0.8);
      // direct check of the rule: score a basket by hand and look at who gets the ball
      const m2 = parkMatch({ makeItTakeIt, target: 11 }, 9);
      for (let i = 0; i < 60 * 4 && m2.state.phase !== "live"; i++) m2.step(1 / 60);
      const scorer = m2.state.offense;
      const s = m2.state;
      const shooter = s.agents.find((a) => a.team === scorer)!;
      s.ball.shot = {
        shooter: shooter.idx,
        team: scorer,
        kind: "layup",
        points: 1,
        willMake: true,
        contest: 0,
        quality: NaN,
        fouled: false,
        fromX: 12,
        fromZ: 0,
        blocked: false,
        assistFrom: null,
        releaseTime: s.time,
        side: 1,
      };
      (m2 as unknown as { shotMade(): void }).shotMade();
      expect(s.teams[scorer].score).toBe(1);
      expect(s.inbound?.check).toBe(true);
      expect(s.inbound?.team).toBe(makeItTakeIt ? scorer : scorer === 0 ? 1 : 0);
    }
  });

  it("half court: after a change of possession the ball has to go back past the arc, or the basket doesn't count", () => {
    const m = parkMatch({}, 4);
    for (let i = 0; i < 60 * 4 && m.state.phase !== "live"; i++) m.step(1 / 60);
    const s = m.state;
    const def = s.agents.find((a) => a.team !== s.offense)!;
    const rim = rimPos(s.cfg.court, m.attackSide(def.team));
    def.pos = { x: rim.x - 1, z: 0 };
    m.giveBall(def); // a steal under the basket
    expect(s.offense).toBe(def.team);
    expect(s.park!.cleared).toBe(false);
    const before = s.teams[def.team].score;
    s.ball.shot = {
      shooter: def.idx,
      team: def.team,
      kind: "layup",
      points: 1,
      willMake: true,
      contest: 0,
      quality: NaN,
      fouled: false,
      fromX: rim.x - 1,
      fromZ: 0,
      blocked: false,
      assistFrom: null,
      releaseTime: s.time,
      side: 1,
    };
    (m as unknown as { shotMade(): void }).shotMade();
    expect(s.teams[def.team].score).toBe(before);
    expect(parkEvents(m, "noClear")).toHaveLength(1);
    // and the other side checks it
    expect(s.inbound?.team).toBe(def.team === 0 ? 1 : 0);
  });

  it("dribbling past the arc clears the ball", () => {
    const m = parkMatch({}, 4);
    for (let i = 0; i < 60 * 4 && m.state.phase !== "live"; i++) m.step(1 / 60);
    const s = m.state;
    const def = s.agents.find((a) => a.team !== s.offense)!;
    const side = m.attackSide(def.team);
    const rim = rimPos(s.cfg.court, side);
    def.pos = { x: rim.x - 1, z: 0 };
    m.giveBall(def);
    expect(s.park!.cleared).toBe(false);
    def.pos = { x: rim.x - side * (s.cfg.court.threeRadius + 1), z: 0 };
    expect(isThree(s.cfg.court, side, def.pos.x, def.pos.z)).toBe(true);
    m.step(1 / 60);
    expect(s.park!.cleared || s.ball.owner !== def.idx).toBe(true);
  });

  it("check ball: a bounce pass to the defender, a beat holding it, and back to the handler before play is live", () => {
    for (const game of ["team", "21"] as const) {
      const m = parkMatch({ game, n: game === "21" ? 3 : 2 }, 5, false);
      const s = m.state;
      const seen: string[] = [];
      let defHeld = false,
        offense = -1;
      for (let i = 0; i < 60 * 20 && parkEvents(m, "check").length === 0; i++) {
        m.step(1 / 60);
        const stage = s.inbound?.checkStage;
        if (stage && seen[seen.length - 1] !== stage) seen.push(stage);
        if (stage === "hold") {
          const def = s.agents[s.ball.owner!];
          defHeld = def.team !== s.inbound!.team;
          // holding it for the check is not a change of possession
          if (offense < 0) offense = s.offense;
          expect(s.offense).toBe(offense);
        }
        if (stage) expect(s.phase).toBe("deadball");
      }
      expect(seen).toEqual(["toDef", "hold", "back"]);
      expect(defHeld).toBe(true);
      const ev = parkEvents(m, "check")[0] as { player: number; team: number };
      expect(s.phase).toBe("live");
      expect(s.ball.owner).toBe(ev.player);
      expect(s.agents[ev.player].team).toBe(ev.team);
    }
  });

  it("called fouls: no free throws, the fouled player checks it back; a charge goes the other way", () => {
    const m = parkMatch({}, 6);
    for (let i = 0; i < 60 * 4 && m.state.phase !== "live"; i++) m.step(1 / 60);
    const s = m.state;
    const off = s.agents.find((a) => a.team === s.offense)!;
    const def = s.agents.find((a) => a.team !== s.offense)!;
    m.foul(def, off, "reach", false);
    expect(s.phase).toBe("deadball");
    expect(s.freeThrows).toBeNull();
    expect(s.inbound).toMatchObject({ check: true, team: off.team, inbounder: off.idx });
    expect(s.box[def.player.id].pf).toBe(1);
    expect(parkEvents(m, "foulCall")).toHaveLength(1);
    // fouls never foul anyone out at the park
    for (let k = 0; k < 8; k++) m.foul(def, off, "reach", false);
    expect(s.events.some((e) => e.t === "foulOut")).toBe(false);
    // a charge: the defender's side gets it
    const m2 = parkMatch({}, 6);
    for (let i = 0; i < 60 * 4 && m2.state.phase !== "live"; i++) m2.step(1 / 60);
    const s2 = m2.state;
    const o2 = s2.agents.find((a) => a.team === s2.offense)!;
    const d2 = s2.agents.find((a) => a.team !== s2.offense)!;
    m2.foul(o2, d2, "charge", false);
    expect(s2.inbound?.team).toBe(d2.team);
  });

  it("no timeouts, substitutions or officials at the park", () => {
    const m = parkMatch({}, 2);
    expect(m.callTimeout(0)).toBe(false);
    expect(m.state.teams[0].timeouts).toBe(0);
    expect(m.state.crew).toBeNull();
    run(m);
    expect(m.state.events.some((e) => e.t === "sub" || e.t === "timeout")).toBe(false);
  });

  it("full court: after a basket the other team inbounds from under the basket (or the scorers, make it take it)", () => {
    for (const makeItTakeIt of [false, true]) {
      const m = parkMatch({ halfCourt: false, makeItTakeIt }, 8);
      for (let i = 0; i < 60 * 6 && m.state.phase !== "live"; i++) m.step(1 / 60);
      const s = m.state;
      const scorer = s.offense;
      const shooter = s.agents.find((a) => a.team === scorer)!;
      s.ball.shot = {
        shooter: shooter.idx,
        team: scorer,
        kind: "jumper",
        points: 1,
        willMake: true,
        contest: 0,
        quality: NaN,
        fouled: false,
        fromX: 9,
        fromZ: 0,
        blocked: false,
        assistFrom: null,
        releaseTime: s.time,
        side: 1,
      };
      (m as unknown as { shotMade(): void }).shotMade();
      expect(s.inbound?.check).toBeFalsy();
      expect(s.inbound?.afterScore).toBe(true);
      expect(s.inbound?.team).toBe(makeItTakeIt ? scorer : scorer === 0 ? 1 : 0);
    }
  });

  it("the AI keeps possessions moving with no shot clock (a hidden possession timer)", () => {
    const m = run(parkMatch({ n: 5, halfCourt: false, scoring: "twos", target: 21 }, 12));
    const fga = Object.values(m.state.box).reduce((t, l) => t + l.fga, 0);
    expect(fga).toBeGreaterThan(20);
    // a pickup game lasts minutes, not an hour
    expect(m.state.time / 60).toBeLessThan(25);
  });
});

describe("21", () => {
  it("everyone plays for themselves: whoever gets the ball is alone against the rest", () => {
    const m = parkMatch({ game: "21", n: 4, target: 21 }, 3);
    for (let i = 0; i < 60 * 4 && m.state.phase !== "live"; i++) m.step(1 / 60);
    const s = m.state;
    expect(s.agents.filter((a) => a.team === 0)).toHaveLength(1);
    const other = s.agents.find((a) => a.team === 1)!;
    m.giveBall(other);
    expect(other.team).toBe(0);
    expect(s.agents.filter((a) => a.team === 0)).toEqual([other]);
    expect(s.teams[0].onCourt).toEqual([other.player.id]);
    expect(s.park!.cleared).toBe(false);
  });

  it("a basket earns free throws until a miss, going over drops you back, and exactly the target wins", () => {
    const m = parkMatch({ game: "21", n: 3, target: 21 }, 5);
    for (let i = 0; i < 60 * 4 && m.state.phase !== "live"; i++) m.step(1 / 60);
    const s = m.state;
    const a = s.agents.find((x) => x.team === 0)!;
    s.park!.cleared = true;
    s.ball.shot = {
      shooter: a.idx,
      team: 0,
      kind: "layup",
      points: 1,
      willMake: true,
      contest: 0,
      quality: NaN,
      fouled: false,
      fromX: 12,
      fromZ: 0,
      blocked: false,
      assistFrom: null,
      releaseTime: s.time,
      side: 1,
    };
    (m as unknown as { shotMade(): void }).shotMade();
    expect(s.park!.points[a.player.id]).toBe(1);
    expect(s.phase).toBe("freethrows");
    expect(s.freeThrows?.total).toBe(3);
    // going over: 20 + 2 = 22 -> back to 13
    const add = (m as unknown as { add21(a: unknown, p: number): boolean }).add21.bind(m);
    s.park!.points[a.player.id] = 20;
    expect(add(a, 2)).toBe(false);
    expect(s.park!.points[a.player.id]).toBe(13);
    expect(parkEvents(m, "bust")).toHaveLength(1);
    s.park!.points[a.player.id] = 19;
    expect(add(a, 2)).toBe(true);
    expect(s.phase).toBe("final");
    expect(s.park!.winnerId).toBe(a.player.id);
  });

  it("full games of 21 finish with one winner at exactly the target", () => {
    for (const seed of [1, 2, 3]) {
      const m = run(parkMatch({ game: "21", n: 4, target: 15 }, seed));
      expect(m.state.phase).toBe("final");
      const pts = m.state.park!.points;
      expect(pts[m.state.park!.winnerId!]).toBe(15);
      expect(Object.values(pts).filter((p) => p === 15)).toHaveLength(1);
      expect(m.watchdogTrips).toBe(0);
    }
  });
});
