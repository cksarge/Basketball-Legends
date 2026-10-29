import { describe, expect, it } from "vitest";
import pro from "@/data/generated/pro.json";
import { Match } from "../sim/match";
import { generateRoster, playerOvr } from "@/engine/player";
import { Rng } from "@/engine/rng";
import type { Player, Team } from "@/engine/types";
import type { AgentIntent } from "../sim/state";
import {
  BALLS_PER_RACK,
  contestScore,
  CONTEST_SECONDS,
  describeSpot,
  HorseDrill,
  isMoney,
  rackSpots,
  RACKS,
  simulateContestRound,
  ThreePointDrill,
} from "../sim/drill";
import { PARKS, parkById } from "../park/parks";
import { parkRegulars, REGULARS_PER_PARK, regularOutfit } from "../park/regulars";
import { crewById, newLine, nextMatchup, recordGame, simScore, simUntilYou, youAreUp, type Crew } from "../park/line";
import { buildPark, castSize, crewStrength, lineGame, pickCast, rulesFor, startLine, YOU_CREW } from "../park/session";
import { DEFAULT_SETUP, type ParkSetup } from "@/state/parkStore";

const teams = (pro as { teams: Team[] }).teams;

function drillMatch(roster: Player[], human: boolean) {
  return new Match({
    league: "hs",
    home: { team: teams[1], roster, human, humans: human ? [0] : [] },
    away: { team: teams[1], roster: [] },
    seed: 1,
    practice: true,
    shotMeter: true,
    lockPlayerId: human ? roster[0].id : undefined,
  });
}

describe("HORSE", () => {
  it("AI games play to a single winner, with everyone else spelling the word", () => {
    for (const seed of [1, 2, 3]) {
      const m = drillMatch(generateRoster(teams[seed]).slice(0, 3), false);
      const d = new HorseDrill(m, "HORSE", seed);
      m.drill = d;
      for (let i = 0; i < 60 * 60 * 20 && !d.done; i++) m.step(1 / 60);
      expect(d.done).toBe(true);
      expect(d.winner).not.toBeNull();
      const losers = d.players.filter((_, i) => i !== d.winner);
      expect(losers.every((p) => p.out && p.letters === 5)).toBe(true);
      expect(d.players[d.winner!].letters).toBeLessThan(5);
    }
  });

  it("PIG is a shorter game", () => {
    const m = drillMatch(generateRoster(teams[4]).slice(0, 2), false);
    const d = new HorseDrill(m, "PIG", 4);
    m.drill = d;
    for (let i = 0; i < 60 * 60 * 20 && !d.done; i++) m.step(1 / 60);
    expect(d.done).toBe(true);
    expect(d.players.find((p) => p.out)!.letters).toBe(3);
    expect(d.lettersOf(d.players.find((p) => p.out)!)).toBe("PIG");
  });

  it("the drill moves its AI shooters, never the human", () => {
    const roster = generateRoster(teams[2]).slice(0, 3);
    const m = drillMatch(roster, true);
    const d = new HorseDrill(m, "HORSE", 1);
    expect(d.controls(m.state.agents[0])).toBe(false);
    expect(d.controls(m.state.agents[1])).toBe(true);
    // the human shoots first
    expect(d.turn).toBe(0);
  });

  it("describes where a shot was taken", () => {
    const m = drillMatch(generateRoster(teams[2]).slice(0, 1), false);
    const c = m.state.cfg.court;
    const rimX = c.halfL - c.rimFromBaseline;
    expect(describeSpot(m, rimX - 0.5, 0, "layup")).toBe("layup");
    expect(describeSpot(m, rimX - (c.ftLineFromBaseline - c.rimFromBaseline), 0, "jumper")).toBe("free throw");
    expect(describeSpot(m, rimX - (c.threeRadius + 0.5), 0, "jumper")).toBe("top of the key three");
    expect(describeSpot(m, rimX - 0.3, c.cornerThree + 0.3, "jumper")).toBe("left corner three");
  });
});

describe("3-point contest", () => {
  const scripted = (m: Match, d: ThreePointDrill) => {
    const spots = rackSpots(m);
    const a = m.state.agents[0];
    for (let i = 0; i < 60 * 80 && !d.done; i++) {
      const it: AgentIntent = { moveX: 0, moveZ: 0, sprint: true };
      const s = m.state;
      if (s.ball.owner === a.idx && !m.isBusy(a)) it.act = { type: "shoot", phase: "press" };
      else if (a.action.kind === "jumper" && (a.action.data.releasedAt as number) < 0 && a.action.t >= (a.action.data.ideal as number))
        it.act = { type: "shoot", phase: "release" };
      else if (s.ball.owner !== a.idx) {
        const sp = spots[Math.min(RACKS - 1, d.rack)];
        const dx = sp.x - a.pos.x,
          dz = sp.z - a.pos.z,
          dd = Math.hypot(dx, dz);
        if (dd > 0.4) {
          it.moveX = dx / dd;
          it.moveZ = dz / dd;
        }
      }
      m.step(1 / 60, [it]);
    }
  };

  it("a round is 25 balls on five racks around the arc, and a quick shooter finishes inside 60 seconds", () => {
    const m = drillMatch(generateRoster(teams[3]).slice(0, 1), true);
    const d = new ThreePointDrill(m);
    m.drill = d;
    expect(d.spots).toHaveLength(RACKS);
    const c = m.state.cfg.court;
    for (const sp of d.spots) expect(Math.hypot(sp.x - (c.halfL - c.rimFromBaseline), sp.z)).toBeGreaterThan(c.cornerThree);
    scripted(m, d);
    expect(d.done).toBe(true);
    expect(d.shots).toHaveLength(RACKS * BALLS_PER_RACK);
    expect(d.timeLeft).toBeGreaterThan(0);
    // perfect timing nearly always goes in
    expect(d.score).toBeGreaterThan(22);
    expect(d.score).toBeLessThanOrEqual(30);
  });

  it("the buzzer ends the round", () => {
    const m = drillMatch(generateRoster(teams[3]).slice(0, 1), true);
    const d = new ThreePointDrill(m);
    m.drill = d;
    // stand still: no balls get shot, the clock runs out
    for (let i = 0; i < 60 * (CONTEST_SECONDS + 6) && !d.done; i++) m.step(1 / 60, [{ moveX: 0, moveZ: 0, sprint: false }]);
    expect(d.done).toBe(true);
    expect(d.timeLeft).toBe(0);
  });

  it("money balls are worth two, and better shooters score more", () => {
    expect(isMoney(4)).toBe(true);
    expect(isMoney(3)).toBe(false);
    expect(
      contestScore([
        { rack: 0, ball: 4, made: true, money: true },
        { rack: 0, ball: 0, made: true, money: false },
        { rack: 0, ball: 1, made: false, money: false },
      ]),
    ).toBe(3);
    const roster = generateRoster(teams[5]);
    const shooter = { ...roster[0], ratings: { ...roster[0].ratings, three: 92 } };
    const brick = { ...roster[0], ratings: { ...roster[0].ratings, three: 40 } };
    let a = 0,
      b = 0;
    for (let i = 0; i < 30; i++) {
      a += contestScore(simulateContestRound(shooter, `s${i}`));
      b += contestScore(simulateContestRound(brick, `s${i}`));
    }
    expect(a / 30).toBeGreaterThan(b / 30 + 5);
    expect(a / 30).toBeLessThanOrEqual(30);
  });
});

describe("parks and regulars", () => {
  it("five original parks, each with its own surface and setting", () => {
    expect(PARKS).toHaveLength(5);
    expect(new Set(PARKS.map((p) => p.setting)).size).toBe(5);
    expect(parkById("nope").id).toBe(PARKS[0].id);
  });

  it("the same regulars are at a park every time, with stable ids, nicknames and street clothes", () => {
    for (const park of PARKS) {
      const a = parkRegulars(park);
      expect(a).toHaveLength(REGULARS_PER_PARK);
      expect(new Set(a.map((r) => r.player.id)).size).toBe(REGULARS_PER_PARK);
      expect(new Set(a.map((r) => r.nickname)).size).toBe(REGULARS_PER_PARK);
      expect(parkRegulars(park)).toBe(a);
      expect(a[0].player.id).toMatch(new RegExp(`^park-${park.id}-`));
      // best first, and the park's level shows
      expect(playerOvr(a[0].player)).toBeGreaterThanOrEqual(playerOvr(a.at(-1)!.player));
      expect(regularOutfit(a[0].player.id)).toEqual(regularOutfit(a[0].player.id));
    }
    const easy = parkRegulars(parkById("maple-street"));
    const hard = parkRegulars(parkById("rooftop-ninth"));
    const avg = (rs: typeof easy) => rs.reduce((t, r) => t + playerOvr(r.player), 0) / rs.length;
    expect(avg(hard)).toBeGreaterThan(avg(easy) + 5);
  });
});

describe("next game up", () => {
  const crews: Crew[] = ["you", "a", "b", "c"].map((id) => ({ id, name: id, playerIds: [] }));

  it("you call next against the crew holding the court; winners stay, losers go to the back", () => {
    let l = newLine(crews, "you");
    expect(nextMatchup(l)).toEqual(["a", "you"]);
    expect(youAreUp(l)).toBe(true);
    l = recordGame(l, { home: "a", away: "you", homeScore: 11, awayScore: 15, played: true });
    expect(l.holder).toBe("you");
    expect(l.queue).toEqual(["b", "c", "a"]);
    expect(l.streak).toBe(1);
    l = recordGame(l, { home: "you", away: "b", homeScore: 9, awayScore: 15, played: true });
    expect(l.holder).toBe("b");
    expect(l.queue).toEqual(["c", "a", "you"]);
    expect(l.streak).toBe(0);
    expect(l.best).toBe(1);
  });

  it("games ahead of you are simulated until you're up again", () => {
    let l = newLine(crews, "you");
    l = recordGame(l, { home: "a", away: "you", homeScore: 15, awayScore: 3, played: true });
    expect(youAreUp(l)).toBe(false);
    l = simUntilYou(l, () => 50, { game: "team", halfCourt: true, scoring: "ones", target: 15, winBy: 2, makeItTakeIt: false }, "t");
    expect(youAreUp(l)).toBe(true);
    expect(l.history.filter((g) => !g.played).length).toBeGreaterThan(0);
  });

  it("simulated scores follow the rules: the winner reaches the target and leads by two", () => {
    const rng = new Rng("score");
    for (let i = 0; i < 200; i++) {
      const [a, b] = simScore(
        rng.range(40, 70),
        rng.range(40, 70),
        { game: "team", halfCourt: true, scoring: "ones", target: 15, winBy: 2, makeItTakeIt: false },
        rng,
      );
      expect(Math.max(a, b)).toBeGreaterThanOrEqual(15);
      expect(Math.abs(a - b)).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("setting up a park game", () => {
  const regs = parkRegulars(PARKS[0]);
  const setup = (p: Partial<ParkSetup>): ParkSetup => ({ ...DEFAULT_SETUP, ...p });

  it("fills every spot from the regulars with no one picked twice", () => {
    for (const mode of ["pickup", "line", "21", "horse", "three"] as const)
      for (const teamSize of [1, 3, 5]) {
        const s = setup({ mode, teamSize });
        const cast = pickCast(s, regs, 7);
        const n = castSize(s);
        expect(cast.mates).toHaveLength(n.mates);
        expect(cast.opps).toHaveLength(n.opps);
        const ids = [cast.you, ...cast.mates, ...cast.opps, ...cast.crews.flat()].map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
      }
  });

  it("builds the right game for each mode", () => {
    const pickup = buildPark(setup({ mode: "pickup", teamSize: 2 }), pickCast(setup({ mode: "pickup", teamSize: 2 }), regs, 1), "keyboard", 5).pending;
    expect(pickup).toMatchObject({ mode: "park", arena: "park", returnTo: "/park/" });
    expect(pickup.home.roster).toHaveLength(2);
    expect(pickup.away.roster).toHaveLength(2);
    expect(pickup.park?.rules).toEqual(rulesFor(setup({ mode: "pickup", teamSize: 2 })));
    expect(pickup.practice).toBeFalsy();

    const s21 = setup({ mode: "21", players21: 5, target: 21 });
    const g21 = buildPark(s21, pickCast(s21, regs, 1), "keyboard", 5).pending;
    expect(g21.home.roster).toHaveLength(1);
    expect(g21.away.roster).toHaveLength(4);
    expect(g21.lockPlayerId).toBe(g21.home.roster[0].id);
    expect(g21.park?.rules).toMatchObject({ game: "21", halfCourt: true, target: 21 });

    const horse = buildPark(setup({ mode: "horse", horseOpponents: 3 }), pickCast(setup({ mode: "horse", horseOpponents: 3 }), regs, 1), "keyboard", 5).pending;
    expect(horse.practice).toBe(true);
    expect(horse.home.roster).toHaveLength(4);
    expect(horse.park?.word).toBe("HORSE");

    const three = buildPark(setup({ mode: "three", rivals: 4 }), pickCast(setup({ mode: "three", rivals: 4 }), regs, 1), "keyboard", 5).pending;
    expect(three.practice).toBe(true);
    expect(three.home.roster).toHaveLength(1);
    expect(three.park?.rivals).toHaveLength(4);
  });

  it("a line game puts your crew against whoever is up", () => {
    const s = setup({ mode: "line", teamSize: 3, crews: 3 });
    const cast = pickCast(s, regs, 2);
    const { line, players } = startLine(s, cast);
    expect(line.crews).toHaveLength(1 + 1 + cast.crews.length);
    expect(crewById(line, YOU_CREW).playerIds).toContain(cast.you.id);
    const g = lineGame(PARKS[0].id, rulesFor(s), line, players, "keyboard", 1);
    expect(g.home.roster.map((p) => p.id)).toEqual(crewById(line, YOU_CREW).playerIds);
    expect(g.away.roster).toHaveLength(3);
    expect(crewStrength(line, players, YOU_CREW)).toBeGreaterThan(20);
  });
});
