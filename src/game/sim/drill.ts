// Park shooting games that run on top of practice mode: HORSE and the 3-point contest.
// A drill decides who has the ball, moves its AI shooters, and keeps score; the match handles the shots.
import { Rng, clamp } from "@/engine/rng";
import type { Player } from "@/engine/types";
import { distToRim, isThree, rimPos } from "../court";
import { v2, type V2 } from "../vec";
import type { Match } from "./match";
import type { Agent, ShotKind } from "./state";

export interface Drill {
  kind: "horse" | "three";
  /** True when the drill moves this (AI) agent instead of the team AI. */
  controls(a: Agent): boolean;
  step(match: Match, dt: number): void;
  /** The game is over (results are final). */
  done: boolean;
}

/** Walks an AI player toward a point (arrives softly). Returns true once there. */
function steer(a: Agent, t: V2, face?: V2, precision = 0.25): boolean {
  const dx = t.x - a.pos.x,
    dz = t.z - a.pos.z;
  const d = Math.hypot(dx, dz);
  const there = d < precision;
  const k = there ? 0 : Math.min(1, d / 1.2);
  a.intent.moveX = there ? 0 : (dx / d) * k;
  a.intent.moveZ = there ? 0 : (dz / d) * k;
  a.intent.sprint = d > 4;
  a.intent.faceX = face?.x;
  a.intent.faceZ = face?.z;
  a.intent.act = undefined;
  return there;
}

const shotEvent = (match: Match, shooter: number) => {
  for (const e of match.state.frameEvents) {
    if ((e.t === "make" || e.t === "miss") && e.shooter === shooter) return e.t === "make";
  }
  return null;
};

// ------------------------------------------------------------------- HORSE

export interface HorseSpot {
  x: number;
  z: number;
  label: string;
}

/** Where a shot was taken, in words ("left corner three", "free throw", "layup"). */
export function describeSpot(match: Match, x: number, z: number, kind: ShotKind): string {
  const c = match.state.cfg.court;
  const side = match.attackSide(0);
  if (kind === "layup" || kind === "dunk") return kind === "dunk" ? "dunk" : "layup";
  const d = distToRim(c, side, x, z);
  const ft = Math.round(d / 0.3048);
  const three = isThree(c, side, x, z);
  const rim = rimPos(c, side);
  const along = (rim.x - x) * side; // distance out from the baseline direction
  const lr = z > 0 ? "left" : "right";
  const deg = (Math.atan2(Math.abs(z), along) * 180) / Math.PI;
  const zone = deg > 68 ? `${lr} corner` : deg > 50 ? `${lr} baseline` : deg > 22 ? `${lr} wing` : "top of the key";
  if (kind === "hook") return `${ft}-foot hook shot`;
  if (kind === "floater") return `${ft}-foot floater`;
  if (three) return `${zone} three`;
  if (Math.abs(z) < 0.9 && Math.abs(d - (c.ftLineFromBaseline - c.rimFromBaseline)) < 0.7) return "free throw";
  return `${ft}-foot ${kind === "fadeaway" ? "fadeaway" : "jumper"} from the ${zone}`;
}

export interface HorsePlayer {
  idx: number;
  letters: number;
  out: boolean;
}

/**
 * HORSE: the leader sets a shot anywhere; everyone still in has to make the same shot from the same spot
 * or take a letter. Miss your set shot and the next player leads. Spell the word and you're out.
 */
export class HorseDrill implements Drill {
  kind = "horse" as const;
  done = false;
  word: string;
  players: HorsePlayer[];
  leader = 0;
  turn = 0;
  mode: "set" | "match" = "set";
  setShot: (HorseSpot & { kind: ShotKind }) | null = null;
  followers: number[] = [];
  stage: "prep" | "shoot" | "flight" | "pause" = "prep";
  timer = 0;
  /** Latest line for the HUD. */
  message = "";
  winner: number | null = null;
  private plan: HorseSpot | null = null;
  private pressed = false;
  private shotAt: { x: number; z: number; kind: ShotKind } | null = null;
  private strayed = false;
  private rng: Rng;

  constructor(match: Match, word = "HORSE", seed = 1) {
    this.word = word;
    this.players = match.state.agents.map((a) => ({ idx: a.idx, letters: 0, out: false }));
    this.rng = new Rng(`horse:${seed}`);
    const human = this.players.findIndex((p) => match.state.agents[p.idx].human !== null);
    this.leader = this.turn = human >= 0 ? human : 0;
    this.message = `${match.name(this.players[this.turn].idx)} shoots first`;
  }

  controls(a: Agent) {
    return a.human === null && this.players.some((p) => p.idx === a.idx);
  }

  lettersOf(p: HorsePlayer) {
    return this.word.slice(0, p.letters);
  }

  private active() {
    return this.players.map((p, i) => i).filter((i) => !this.players[i].out);
  }

  private nextActive(from: number) {
    for (let k = 1; k <= this.players.length; k++) {
      const i = (from + k) % this.players.length;
      if (!this.players[i].out) return i;
    }
    return from;
  }

  /** The AI's set shot: what it shoots well, with a dash of showing off. */
  private pickSpot(match: Match, a: Agent): HorseSpot {
    const c = match.state.cfg.court;
    const side = match.attackSide(0);
    const rim = rimPos(c, side);
    const at = (deg: number, r: number) => {
      const rad = (deg * Math.PI) / 180;
      return { x: rim.x - side * Math.cos(rad) * r, z: Math.sin(rad) * r };
    };
    const R3 = c.threeRadius + 0.35;
    const corner = { x: rim.x - side * 0.5, z: c.cornerThree + 0.3 };
    const r = a.player.ratings;
    const spots: [HorseSpot, number][] = [
      [{ ...at(0, c.ftLineFromBaseline - c.rimFromBaseline), label: "free throw" }, 1.2 + r.freeThrow / 80],
      [{ ...at(40, 4.6), label: "left elbow" }, r.midRange / 60],
      [{ ...at(-40, 4.6), label: "right elbow" }, r.midRange / 60],
      [{ ...at(75, 4.2), label: "left baseline" }, r.midRange / 70],
      [{ ...at(-75, 4.2), label: "right baseline" }, r.midRange / 70],
      [{ ...at(0, R3), label: "top of the key three" }, r.three / 55],
      [{ ...at(45, R3), label: "left wing three" }, r.three / 60],
      [{ ...at(-45, R3), label: "right wing three" }, r.three / 60],
      [{ x: corner.x, z: corner.z, label: "left corner three" }, r.three / 65],
      [{ x: corner.x, z: -corner.z, label: "right corner three" }, r.three / 65],
      [{ ...at(60, 2.2), label: "short floater" }, r.closeShot / 90],
    ];
    return this.rng.weighted(
      spots.map((s) => s[0]),
      spots.map((s) => s[1]),
    );
  }

  step(match: Match, dt: number) {
    if (this.done) return;
    const s = match.state;
    const cur = this.players[this.turn];
    const a = s.agents[cur.idx];
    const c = s.cfg.court;
    const rim = rimPos(c, match.attackSide(0));
    // everyone waiting stands along the baseline out of the way
    this.players.forEach((p, i) => {
      const ag = s.agents[p.idx];
      if (i === this.turn || ag.human !== null) return;
      const k = this.players.filter((q, j) => j !== this.turn && j < i).length;
      steer(ag, v2(rim.x - match.attackSide(0) * (c.halfL - 0.6 + 1), (k % 2 ? -1 : 1) * (c.halfW - 0.9 - Math.floor(k / 2) * 1.2)), v2(rim.x, rim.z));
    });

    if (this.stage === "pause") {
      if (a.human === null) steer(a, a.pos);
      this.timer -= dt;
      if (this.timer <= 0) this.stage = "prep";
      return;
    }

    if (this.stage === "prep") {
      this.pressed = false;
      this.strayed = false;
      this.shotAt = null;
      if (this.mode === "match" && this.setShot) {
        a.pos = v2(this.setShot.x, this.setShot.z);
        a.vel = v2();
        this.plan = this.setShot;
      } else {
        this.plan = a.human === null ? this.pickSpot(match, a) : null;
      }
      a.facing = Math.atan2(rim.x - a.pos.x, rim.z - a.pos.z);
      s.ball.shot = null;
      match.giveBall(a);
      this.stage = "shoot";
      this.timer = 0;
      return;
    }

    if (this.stage === "shoot") {
      this.timer += dt;
      const shooting = s.ball.mode === "shot" && s.ball.shot?.shooter === a.idx;
      if (this.mode === "match" && this.setShot && a.human !== null && !shooting) {
        if (Math.hypot(a.pos.x - this.setShot.x, a.pos.z - this.setShot.z) > 1.2) this.strayed = true;
      }
      if (a.human === null && !shooting && this.plan) {
        const there = steer(a, v2(this.plan.x, this.plan.z), v2(rim.x, rim.z), 0.3);
        if ((there || this.timer > 6) && !this.pressed && s.ball.owner === a.idx && !match.isBusy(a)) {
          this.pressed = true;
          a.intent.act = { type: "shoot", phase: "press" };
          // a set layup: drive in for it
          if (this.plan.label === "layup") match.beginShot(a, "layup");
        }
      }
      if (shooting && s.ball.shot) {
        this.shotAt = { x: s.ball.shot.fromX, z: s.ball.shot.fromZ, kind: s.ball.shot.kind };
        this.stage = "flight";
      }
      // the ball got away (a fumble): run it back
      if (!shooting && s.ball.owner !== a.idx && s.ball.mode !== "shot" && this.timer > 1 && !match.isBusy(a)) this.stage = "prep";
      return;
    }

    if (this.stage === "flight") {
      if (a.human === null) steer(a, a.pos);
      const made = shotEvent(match, a.idx);
      if (made === null) return;
      this.resolve(match, made);
    }
  }

  private resolve(match: Match, made: boolean) {
    const name = (i: number) => match.name(this.players[i].idx);
    const cur = this.players[this.turn];
    this.stage = "pause";
    this.timer = 1.6;
    if (this.mode === "set") {
      if (made && this.shotAt) {
        const label = this.plan?.label && this.plan.label !== "layup" ? this.plan.label : describeSpot(match, this.shotAt.x, this.shotAt.z, this.shotAt.kind);
        this.setShot = { x: this.shotAt.x, z: this.shotAt.z, kind: this.shotAt.kind, label };
        this.followers = [];
        for (let i = this.nextActive(this.turn); i !== this.turn; i = this.nextActive(i)) this.followers.push(i);
        this.mode = "match";
        this.message = `${name(this.turn)} hits the ${label}. ${name(this.followers[0])} has to match it.`;
        this.turn = this.followers.shift()!;
      } else {
        this.leader = this.nextActive(this.turn);
        this.message = `${name(this.turn)} misses. ${name(this.leader)} sets the next shot.`;
        this.turn = this.leader;
      }
      return;
    }
    // matching
    const ok = made && !this.strayed;
    if (!ok) {
      cur.letters++;
      if (cur.letters >= this.word.length) cur.out = true;
    }
    const what = ok ? "matches it" : this.strayed ? "moved off the spot" : "misses";
    const letter = ok ? "" : cur.out ? ` That's ${this.word}: ${name(this.turn)} is out.` : ` Letter: ${this.lettersOf(cur)}.`;
    if (this.active().length === 1) {
      this.winner = this.active()[0];
      this.done = true;
      this.message = `${name(this.turn)} ${what}.${letter} ${name(this.winner)} wins!`;
      return;
    }
    if (this.followers.length) {
      this.turn = this.followers.shift()!;
      this.message = `${name(this.players.indexOf(cur))} ${what}.${letter} ${name(this.turn)} is up.`;
    } else {
      this.mode = "set";
      this.setShot = null;
      if (this.players[this.leader].out) this.leader = this.nextActive(this.leader);
      this.turn = this.leader;
      this.message = `${name(this.players.indexOf(cur))} ${what}.${letter} ${name(this.leader)} sets the next shot.`;
    }
  }
}

// ------------------------------------------------------------ 3-point contest

export const RACKS = 5;
export const BALLS_PER_RACK = 5;
export const CONTEST_SECONDS = 60;

export interface ContestShot {
  rack: number;
  ball: number;
  made: boolean;
  money: boolean;
}

/** Five racks around the arc: left corner, left wing, top, right wing, right corner. */
export function rackSpots(match: Match): V2[] {
  const c = match.state.cfg.court;
  const side = match.attackSide(0);
  const rim = rimPos(c, side);
  const R = c.threeRadius + 0.45;
  const at = (deg: number) => v2(rim.x - side * Math.cos((deg * Math.PI) / 180) * R, Math.sin((deg * Math.PI) / 180) * R);
  const corner = (z: number) => v2(rim.x - side * 0.45, z * (c.cornerThree + 0.4));
  return [corner(1), at(48), at(0), at(-48), corner(-1)];
}

/** The last ball on every rack is the money ball (two points). */
export const isMoney = (ball: number) => ball === BALLS_PER_RACK - 1;
export const contestScore = (shots: ContestShot[]) => shots.reduce((t, s) => t + (s.made ? (s.money ? 2 : 1) : 0), 0);

/**
 * The 3-point contest: 25 balls on five racks, 60 seconds. Walk up to the rack and the next ball comes to you;
 * each money ball is worth two.
 */
export class ThreePointDrill implements Drill {
  kind = "three" as const;
  done = false;
  rack = 0;
  ball = 0;
  timeLeft = CONTEST_SECONDS;
  countdown = 3;
  shots: ContestShot[] = [];
  spots: V2[];
  shooter: number;
  private inFlight = false;

  constructor(match: Match) {
    this.spots = rackSpots(match);
    const s = match.state;
    const h = s.agents.find((a) => a.human !== null) ?? s.agents[0];
    this.shooter = h.idx;
    h.pos = v2(this.spots[0].x, this.spots[0].z);
    s.ball.owner = null;
    s.ball.mode = "dead";
  }

  controls(a: Agent) {
    return a.human === null;
  }

  get score() {
    return contestScore(this.shots);
  }

  /** Balls still sitting on a rack (for the rack props): the one in your hands or in the air is off it. */
  ballsLeft(rack: number) {
    if (rack < this.rack) return 0;
    if (rack > this.rack) return BALLS_PER_RACK;
    return BALLS_PER_RACK - this.ball - (this.inFlight || this.holding ? 1 : 0);
  }

  private holding = false;

  step(match: Match, dt: number) {
    if (this.done) return;
    const s = match.state;
    const a = s.agents[this.shooter];
    // anyone else (AI rivals) waits along the sideline
    for (const o of s.agents) if (o !== a && o.human === null) steer(o, v2(-2 + o.idx * 1.1, -(s.cfg.court.halfW + 0.8)), v2(o.pos.x, 0));
    if (this.countdown > 0) {
      this.countdown -= dt;
      if (s.ball.owner !== a.idx) {
        s.ball.shot = null;
        match.giveBall(a);
      }
      return;
    }
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    const shooting = s.ball.mode === "shot" && s.ball.shot?.shooter === a.idx;
    if (shooting && !this.inFlight) {
      this.inFlight = true;
      this.holding = false;
    }
    if (this.inFlight) {
      const made = shotEvent(match, a.idx);
      if (made !== null) {
        this.shots.push({ rack: this.rack, ball: this.ball, made, money: isMoney(this.ball) });
        this.inFlight = false;
        this.ball++;
        if (this.ball >= BALLS_PER_RACK) {
          this.ball = 0;
          this.rack++;
        }
        if (this.rack >= RACKS) {
          this.done = true;
          return;
        }
      }
      return;
    }
    if (this.timeLeft <= 0) {
      // the buzzer: a ball already in the air still counts (handled above)
      this.done = true;
      return;
    }
    // the next ball comes off the rack once you're standing at it
    this.holding = s.ball.owner === a.idx;
    if (!this.holding) {
      const spot = this.spots[this.rack];
      if (Math.hypot(a.pos.x - spot.x, a.pos.z - spot.z) < 1.3 && !match.isBusy(a)) {
        s.ball.shot = null;
        match.giveBall(a);
        this.holding = true;
      }
    }
  }
}

/** A rival's round, simulated shot by shot (better shooters make more; legs tire on the last racks). */
export function simulateContestRound(p: Player, seed: string): ContestShot[] {
  const rng = new Rng(`contest:${seed}`);
  const shots: ContestShot[] = [];
  const base = clamp(0.3 + (p.ratings.three - 45) * 0.009, 0.15, 0.78);
  // slower releases run out of time on the last rack
  const time = 40 + (99 - p.ratings.three) * 0.18 + rng.range(0, 6);
  const cut = time > CONTEST_SECONDS ? Math.floor((CONTEST_SECONDS / time) * RACKS * BALLS_PER_RACK) : RACKS * BALLS_PER_RACK;
  for (let rack = 0; rack < RACKS; rack++)
    for (let ball = 0; ball < BALLS_PER_RACK; ball++) {
      if (rack * BALLS_PER_RACK + ball >= cut) continue;
      const tired = rack >= 3 ? 0.04 : 0;
      shots.push({ rack, ball, made: rng.chance(base - tired + rng.normal(0, 0.03)), money: isMoney(ball) });
    }
  return shots;
}
