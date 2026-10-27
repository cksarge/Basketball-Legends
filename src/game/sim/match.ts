// Real-time match simulation. Deterministic given seed + inputs (host authoritative).
// Rendering never mutates this; it reads Match.state each frame.
import { aimAt, type BallEvent, newBallPhys, solveArc, solveTime, stepBall } from "../ball";
import { courtFor, distToRim, ftSpot, inBounds, inLane, isThree, rimPos } from "../court";
import { angDiff, approach, dist2, distToSeg2, len2, segT2, v2, v3, type V2 } from "../vec";
import { Rng, clamp } from "@/engine/rng";
import { overall } from "@/engine/player";
import { LEAGUE_RULES, type LeagueId, type Player, type RatingKey, type Team, type TeamTactics } from "@/engine/types";
import type { FoulKind, GameEvent, TurnoverReason, ViolationKind } from "./events";
import {
  type ActionKind, type Agent, type AgentIntent, type BallState, DEFAULT_SLIDERS, DIFFICULTY_LEVELS, type Difficulty,
  type DribbleMoveKind, type FreeThrowState, type InboundState, type MatchConfig, type Phase, type ShotKind,
  type TeamGameState, type TeamIdx,
} from "./state";
import { type BoxScore, emptyLine } from "./stats";
import { runAI } from "./ai";

export const AGENT_RADIUS = 0.32;
const DT_DECIDE = 0.2;

export interface MatchSetup {
  league: LeagueId;
  home: { team: Team; roster: Player[]; tactics?: Partial<TeamTactics>; human?: boolean; starters?: string[]; humans?: number[] };
  away: { team: Team; roster: Player[]; tactics?: Partial<TeamTactics>; human?: boolean; starters?: string[]; humans?: number[] };
  /** Career mode: the human always controls this player (no auto-switching). */
  lockPlayerId?: string;
  quarterMinutes?: number;
  difficulty?: Difficulty;
  shotMeter?: boolean;
  fatigue?: boolean;
  injuries?: boolean;
  fouls?: boolean;
  sliders?: Partial<MatchConfig["sliders"]>;
  seed?: number;
  fast?: boolean;
  boundaryAssist?: boolean;
  practice?: boolean;
}

export const DEFAULT_TACTICS: TeamTactics = { pace: 0.5, threeRate: 0.5, defense: "man", crashBoards: 0.4, doubleTeamStars: false };

export interface MatchState {
  cfg: MatchConfig;
  teams: [TeamGameState, TeamGameState];
  agents: Agent[];
  ball: BallState;
  phase: Phase;
  phaseTimer: number;
  period: number;
  clock: number; // seconds left in period
  shotClock: number;
  /** Team on offense (has or last had possession). */
  offense: TeamIdx;
  frontcourt: boolean; // offense has crossed half court this possession
  backcourtTimer: number;
  possessionArrow: TeamIdx;
  inbound: InboundState | null;
  freeThrows: FreeThrowState | null;
  box: BoxScore;
  events: GameEvent[];
  /** Events produced during the most recent step only. */
  frameEvents: GameEvent[];
  time: number; // total sim time
  lastScoreTime: number;
  run: { team: TeamIdx; pts: number };
  winner: TeamIdx | null;
  timeoutTeam: TeamIdx | null;
  /** Last 'decide' tick time for AI cadence. */
  aiClock: number;
  playByPlay: { period: number; clock: number; text: string; team: TeamIdx | null; score: [number, number] }[];
  /** Possession counters for pace stats. */
  possessions: [number, number];
  /** Pending and-one free throw after a made basket. */
  pendingAndOne: { shooter: number; team: TeamIdx } | null;
}

export class Match {
  state: MatchState;
  rng: Rng;
  /** Human controller indexes per team. */
  humanSlots: [number[], number[]] = [[], []];
  lockPlayerId: string | null = null;
  private ballEvents: BallEvent[] = [];

  constructor(setup: MatchSetup) {
    const rules = LEAGUE_RULES[setup.league];
    const court = courtFor(setup.league);
    const cfg: MatchConfig = {
      league: setup.league,
      rules,
      court,
      quarterMinutes: setup.quarterMinutes ?? rules.quarterMinutes,
      difficulty: setup.difficulty ?? "allstar",
      shotMeter: setup.shotMeter ?? true,
      fatigue: setup.fatigue ?? true,
      injuries: setup.injuries ?? false,
      fouls: setup.fouls ?? true,
      sliders: { ...DEFAULT_SLIDERS, ...(setup.sliders ?? {}) },
      seed: setup.seed ?? 1,
      fast: setup.fast ?? false,
      boundaryAssist: setup.boundaryAssist ?? true,
      practice: setup.practice ?? false,
    };
    this.rng = new Rng(cfg.seed);
    const mkTeam = (s: MatchSetup["home"], side: 1 | -1): TeamGameState => {
      const starters = s.starters && s.starters.length === 5 ? s.starters : pickStarters(s.roster);
      return {
        team: s.team, roster: s.roster, onCourt: starters, score: 0, periodScores: [], fouls: 0,
        timeouts: rules.periods === 2 ? 4 : 7, tactics: { ...DEFAULT_TACTICS, ...(s.tactics ?? {}) },
        attackSide: side, humanControlled: !!s.human, minutes: {}, rotation: defaultRotation(s.roster, starters, cfg),
        playCall: null,
      };
    };
    const teams: [TeamGameState, TeamGameState] = [mkTeam(setup.home, 1), mkTeam(setup.away, -1)];
    this.humanSlots = [setup.home.humans ?? (setup.home.human ? [0] : []), setup.away.humans ?? (setup.away.human ? [1] : [])];
    this.lockPlayerId = setup.lockPlayerId ?? null;
    const box: BoxScore = {};
    for (const t of teams) for (const p of t.roster) box[p.id] = emptyLine();

    this.state = {
      cfg, teams, agents: [], ball: {
        phys: newBallPhys(), mode: "dead", owner: null, lastTouch: 0, lastToucher: null, shot: null, pass: null,
        dribblePhase: 0, lastPasser: null, lastPassTime: -99,
      },
      phase: "pregame", phaseTimer: 0, period: 1, clock: cfg.quarterMinutes * 60, shotClock: rules.shotClock ?? 999,
      offense: 0, frontcourt: false, backcourtTimer: 0, possessionArrow: 0, inbound: null, freeThrows: null,
      box, events: [], frameEvents: [], time: 0, lastScoreTime: 0, run: { team: 0, pts: 0 }, winner: null,
      timeoutTeam: null, aiClock: 0, playByPlay: [], possessions: [0, 0], pendingAndOne: null,
    };
    this.buildAgents();
    if (cfg.practice) this.setupPractice();
    else this.setupJumpBall();
  }

  private practiceRetrieve = 0;

  /** Shootaround: offense spread out, the other team waits by its bench, ball to the human. */
  private setupPractice() {
    const s = this.state;
    const c = s.cfg.court;
    for (const a of s.agents) {
      a.vel = v2();
      a.action = act("idle");
      if (a.team === 1) {
        a.pos = v2(-6 + (a.idx - 5) * 1.3, c.halfW + 2.4);
        a.facing = Math.PI;
      } else {
        a.pos = this.spacingSpot(a.role, s.teams[0].attackSide);
        a.facing = s.teams[0].attackSide > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
    }
    s.phase = "live";
    s.offense = 0;
    s.frontcourt = true;
    const h = s.agents.find((a) => a.human !== null && a.team === 0) ?? s.agents[0];
    this.giveBall(h);
  }

  private stepPractice(dt: number) {
    const s = this.state;
    this.aiAndMove(dt);
    // keep the other team parked by the bench
    for (const a of this.agentsOf(1)) { a.vel = v2(); a.intent = { moveX: 0, moveZ: 0, sprint: false }; }
    this.stepBallLive(dt);
    if (s.phase !== "live") s.phase = "live";
    // return the ball to the human after a shot settles
    if (s.ball.owner === null && s.ball.mode !== "shot" && s.ball.mode !== "pass") {
      this.practiceRetrieve += dt;
      if (this.practiceRetrieve > 1.4) {
        this.practiceRetrieve = 0;
        const h = s.agents.find((a) => a.human !== null && a.team === 0) ?? s.agents[0];
        s.ball.shot = null;
        this.giveBall(h);
      }
    } else this.practiceRetrieve = 0;
    s.offense = 0;
    s.shotClock = s.cfg.rules.shotClock ?? 0;
  }

  // ------------------------------------------------------------------ setup
  private buildAgents() {
    const s = this.state;
    const prev = s.agents;
    s.agents = [];
    for (const ti of [0, 1] as TeamIdx[]) {
      const t = s.teams[ti];
      t.onCourt.forEach((pid, slot) => {
        const p = t.roster.find((r) => r.id === pid)!;
        const old = prev.find((a) => a.player.id === pid);
        s.agents.push(old ? { ...old, idx: ti * 5 + slot } : newAgent(ti * 5 + slot, ti, p));
      });
    }
    // humans: keep existing assignments, otherwise hand out this team's controller slots
    for (const ti of [0, 1] as TeamIdx[]) {
      const slots = this.humanSlots?.[ti] ?? [];
      const taken = new Set(s.agents.filter((a) => a.team === ti && a.human !== null).map((a) => a.human));
      for (const h of slots) {
        if (taken.has(h)) continue;
        let ag: Agent | undefined;
        if (this.lockPlayerId) ag = s.agents.find((a) => a.player.id === this.lockPlayerId && a.team === ti);
        if (!ag && this.lockPlayerId) continue; // career player is on the bench
        ag = ag ?? s.agents.find((a) => a.team === ti && a.human === null);
        if (ag) { ag.human = h; taken.add(h); }
      }
    }
    (s as MatchState & { lockHuman?: boolean }).lockHuman = !!this.lockPlayerId;
    this.assignRoles();
  }

  assignRoles() {
    const s = this.state;
    for (const ti of [0, 1] as TeamIdx[]) {
      const ags = s.agents.filter((a) => a.team === ti);
      const order: Agent["role"][] = ["ball", "wing", "slot", "corner", "post"];
      const byPos = [...ags].sort((a, b) => posRank(a.player.pos) - posRank(b.player.pos));
      byPos.forEach((a, i) => (a.role = order[i]));
    }
    // man-to-man assignments by position rank
    for (const ti of [0, 1] as TeamIdx[]) {
      const mine = s.agents.filter((a) => a.team === ti).sort((a, b) => posRank(a.player.pos) - posRank(b.player.pos));
      const theirs = s.agents.filter((a) => a.team !== ti).sort((a, b) => posRank(a.player.pos) - posRank(b.player.pos));
      mine.forEach((a, i) => (a.guarding = theirs[i].idx));
    }
  }

  private setupJumpBall() {
    const s = this.state;
    s.phase = "jumpball";
    s.phaseTimer = s.cfg.fast ? 0.3 : 2.5;
    const c = s.cfg.court;
    const jumpers = [0, 1].map((ti) => tallest(s.agents.filter((a) => a.team === ti)));
    for (const a of s.agents) {
      const side = s.teams[a.team].attackSide;
      const isJumper = jumpers.includes(a);
      if (isJumper) {
        a.pos = v2(-side * 0.45, 0);
      } else {
        const k = s.agents.filter((x) => x.team === a.team && !jumpers.includes(x)).indexOf(a);
        const spots = [v2(-side * 2.2, 2.6), v2(-side * 2.2, -2.6), v2(side * 2.6, 3.2), v2(side * 2.6, -3.2)];
        a.pos = spots[k] ?? v2(-side * 3, 0);
      }
      a.vel = v2();
      a.facing = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      a.action = act(isJumper ? "jumpball" : "idle");
    }
    s.ball.mode = "dead";
    s.ball.owner = null;
    s.ball.phys.pos = v3(0, 2.2, 0);
    s.ball.phys.vel = v3();
    void c;
  }

  // ---------------------------------------------------------------- helpers
  team(ti: TeamIdx) { return this.state.teams[ti]; }
  agentsOf(ti: TeamIdx) { return this.state.agents.filter((a) => a.team === ti); }
  handler(): Agent | null { const o = this.state.ball.owner; return o === null ? null : this.state.agents[o]; }
  attackSide(ti: TeamIdx) { return this.state.teams[ti].attackSide; }
  rim(ti: TeamIdx) { return rimPos(this.state.cfg.court, this.attackSide(ti)); }

  /** Effective rating with fatigue, difficulty and heat applied. */
  r(a: Agent, k: RatingKey): number {
    const s = this.state;
    let v = a.player.ratings[k];
    if (s.cfg.fatigue) v *= 0.86 + 0.14 * a.stamina;
    const diff = DIFFICULTY_LEVELS.find((d) => d.id === s.cfg.difficulty)!;
    const human = s.teams[a.team].humanControlled;
    const anyHuman = s.teams[0].humanControlled || s.teams[1].humanControlled;
    if (anyHuman) v *= human ? (diff.user - 1) * 0.6 + 1 : (diff.cpu - 1) * 0.6 + 1;
    return clamp(v, 20, 110);
  }

  heightM(a: Agent) { return a.player.heightIn * 0.0254; }
  reach(a: Agent) { return this.heightM(a) * 1.33 + (a.player.wingspanIn - a.player.heightIn) * 0.0254 * 0.5; }
  verticalLeap(a: Agent) { return 0.42 + (this.r(a, "vertical") - 40) * 0.0055; }

  emit(e: GameEvent) {
    this.state.events.push(e);
    this.state.frameEvents.push(e);
  }

  log(text: string, team: TeamIdx | null) {
    const s = this.state;
    s.playByPlay.push({ period: s.period, clock: s.clock, text, team, score: [s.teams[0].score, s.teams[1].score] });
  }

  name(a: Agent | number) {
    const ag = typeof a === "number" ? this.state.agents[a] : a;
    return `${ag.player.firstName[0]}. ${ag.player.lastName}`;
  }

  // ------------------------------------------------------------------- step
  /** Advance the simulation by dt seconds (call with fixed steps, e.g. 1/60). */
  step(dt: number, humanIntents: (AgentIntent | null)[] = []) {
    const s = this.state;
    s.frameEvents = [];
    if (s.phase === "final") return;
    s.time += dt;
    this.watchdog(dt);

    // apply human intents
    for (const a of s.agents) {
      if (a.human !== null) {
        const hi = humanIntents[a.human];
        if (hi) a.intent = hi;
      }
    }

    switch (s.phase) {
      case "pregame":
        s.phaseTimer -= dt;
        if (s.phaseTimer <= 0) this.setupJumpBall();
        break;
      case "jumpball":
        this.stepJumpBall(dt);
        break;
      case "timeout":
      case "periodEnd":
      case "halftime":
        s.phaseTimer -= dt;
        if (s.phaseTimer <= 0) this.resumeAfterBreak();
        this.recoverBench(dt * 4);
        return;
      case "deadball":
        s.phaseTimer -= dt;
        this.aiAndMove(dt);
        if (s.ball.owner === null) this.stepBallFlight(dt);
        else this.stepBallVisual(dt);
        if (s.phaseTimer <= 0) this.afterDeadBall();
        return;
      case "inbound":
        this.aiAndMove(dt);
        this.stepInbound(dt);
        this.stepBallVisual(dt);
        return;
      case "freethrows":
        this.aiAndMove(dt);
        this.stepFreeThrows(dt);
        if (s.ball.mode === "ft" || s.ball.mode === "loose") this.stepBallFlight(dt);
        return;
      case "live":
        this.stepLive(dt);
        return;
    }
  }

  private stallKey = "";
  private stallTime = 0;
  /** Number of times the watchdog had to intervene (exposed for tests/diagnostics). */
  watchdogTrips = 0;

  /**
   * Soft-lock protection: if nothing has progressed for a while (no clock movement,
   * no change of phase, possession or score), push the game forward.
   */
  private watchdog(dt: number) {
    const s = this.state;
    if (s.phase === "timeout" || s.phase === "halftime" || s.phase === "periodEnd" || s.phase === "pregame" || s.cfg.practice) { this.stallTime = 0; return; }
    const key = `${s.phase}|${s.ball.mode}|${s.ball.owner}|${Math.floor(s.clock * 2)}|${Math.floor(s.shotClock * 2)}|${s.teams[0].score}|${s.teams[1].score}|${s.freeThrows?.attempt ?? ""}`;
    if (key !== this.stallKey) { this.stallKey = key; this.stallTime = 0; return; }
    this.stallTime += dt;
    if (this.stallTime < 12) return;
    this.stallTime = 0;
    this.watchdogTrips++;
    switch (s.phase) {
      case "freethrows": {
        const ft = s.freeThrows;
        if (ft && s.ball.mode === "dead") { s.phaseTimer = 0; this.startFreeThrowStroke(s.agents[ft.shooter], false); }
        else if (ft) { s.ball.mode = "dead"; s.phaseTimer = 0.2; }
        break;
      }
      case "inbound": {
        const ib = s.inbound;
        if (ib) this.violation(ib.team, "fiveSeconds", ib.inbounder);
        break;
      }
      case "deadball": s.phaseTimer = 0; break;
      case "jumpball": this.setupJumpBall(); s.phaseTimer = 0.6; break;
      default: {
        // live ball nobody can reach (e.g. stuck): award it to the team that didn't touch it last
        if (s.ball.owner === null) {
          const team = (s.ball.lastTouch === 0 ? 1 : 0) as TeamIdx;
          const b = s.ball.phys.pos;
          s.ball.mode = "dead";
          this.toDeadBall(team, false, { x: b.x, z: b.z });
        }
      }
    }
  }

  private aiAndMove(dt: number) {
    const s = this.state;
    s.aiClock += dt;
    const decide = s.aiClock >= DT_DECIDE;
    if (decide) s.aiClock = 0;
    runAI(this, dt, decide);
    this.stepActions(dt);
    this.moveAgents(dt);
  }

  // ------------------------------------------------------------- jump ball
  private stepJumpBall(dt: number) {
    const s = this.state;
    s.phaseTimer -= dt;
    this.aiAndMove(dt);
    const b = s.ball.phys;
    if (s.phaseTimer > 0.6) {
      b.pos = v3(0, 2.0, 0);
      return;
    }
    if (s.ball.mode === "dead") {
      // toss
      s.ball.mode = "loose"; s.ball.looseCause = "jumpball";
      b.pos = v3(0, 2.0, 0);
      b.vel = v3(0, 4.6, 0);
      b.aboveRim = {};
      const jumpers = s.agents.filter((a) => a.action.kind === "jumpball");
      for (const j of jumpers) this.startJump(j, 0.55 + this.verticalLeap(j) * 0.2);
      return;
    }
    // tip at apex
    if (b.vel.y < 0.5 && b.pos.y > 2.9) {
      const jumpers = s.agents.filter((a) => a.action.kind === "jumpball");
      const score = (a: Agent) => this.reach(a) + this.verticalLeap(a) + this.rng.range(0, 0.3);
      const [j0, j1] = jumpers;
      const winner = !j1 || score(j0) >= score(j1) ? j0 : j1;
      const side = s.teams[winner.team].attackSide;
      b.vel = v3(-side * 0.3 + side * 2.8, 0.5, this.rng.range(-1.2, 1.2));
      // tip toward own team's back-court teammates
      b.vel.x = -side * 2.5;
      s.possessionArrow = winner.team === 0 ? 1 : 0;
      this.emit({ t: "jumpball", winner: winner.team });
      this.log(`${this.name(winner)} wins the opening tip`, winner.team);
      for (const j of jumpers) j.action = act("idle");
      s.phase = "live";
      s.offense = winner.team;
      s.ball.lastTouch = winner.team;
      s.ball.lastToucher = winner.idx;
      this.emit({ t: "periodStart", period: 1 });
    } else {
      this.stepBallFlight(dt);
    }
  }

  // ------------------------------------------------------------------ live
  private stepLive(dt: number) {
    const s = this.state;
    const r = s.cfg.rules;
    if (s.cfg.practice) { this.stepPractice(dt); return; }
    // clocks
    const ballInPlay = s.ball.mode !== "dead";
    if (ballInPlay) {
      s.clock -= dt;
      if (r.shotClock && s.ball.mode !== "shot") s.shotClock -= dt;
    }
    this.trackMinutes(dt);
    this.aiAndMove(dt);
    this.stepBallLive(dt);
    if (s.phase !== "live") return;
    this.checkViolations(dt);
    if (s.phase !== "live") return;

    // shot clock violation
    if (r.shotClock && s.shotClock <= 0 && s.ball.mode !== "shot" && s.clock > 0) {
      s.shotClock = 0;
      this.emit({ t: "buzzer", kind: "shotClock" });
      this.violation(s.offense, "shotClock", s.ball.owner);
      return;
    }
    // end of period (let a released shot finish)
    if (s.clock <= 0) {
      s.clock = 0;
      if (s.ball.mode === "shot" && s.ball.shot && s.ball.shot.releaseTime <= s.time) return;
      this.endPeriod();
    }
  }

  private trackMinutes(dt: number) {
    const s = this.state;
    for (const a of s.agents) {
      s.box[a.player.id].min += dt;
      s.teams[a.team].minutes[a.player.id] = (s.teams[a.team].minutes[a.player.id] ?? 0) + dt;
    }
    this.recoverBench(dt);
  }

  private recoverBench(dt: number) {
    const s = this.state;
    for (const t of s.teams) {
      for (const p of t.roster) {
        if (!t.onCourt.includes(p.id)) {
          const st = (p as Player & { _stamina?: number })._stamina ?? 1;
          (p as Player & { _stamina?: number })._stamina = Math.min(1, st + dt * 0.012);
        }
      }
    }
  }

  // --------------------------------------------------------------- actions
  startAction(a: Agent, kind: ActionKind, dur: number, data: ActionState["data"] = {}) {
    a.action = { kind, t: 0, dur, data };
  }

  startJump(a: Agent, height: number) {
    a.vy = Math.sqrt(2 * 9.81 * Math.max(0.05, height));
  }

  isBusy(a: Agent) {
    const k = a.action.kind;
    return ["gather", "jumper", "layup", "dunk", "floater", "hook", "fadeaway", "pass", "block", "steal", "fall", "dribbleMove", "rebound", "freeThrow"].includes(k) && (a.action.dur === 0 || a.action.t < a.action.dur);
  }

  private stepActions(dt: number) {
    const s = this.state;
    for (const a of s.agents) {
      const ac = a.action;
      ac.t += dt;
      if (a.stun > 0) a.stun = Math.max(0, a.stun - dt);
      // airborne
      if (a.y > 0 || a.vy > 0) {
        a.vy -= 9.81 * dt;
        a.y += a.vy * dt;
        if (a.y <= 0) { a.y = 0; a.vy = 0; }
      }
      this.handleIntentAct(a);
      switch (ac.kind) {
        case "jumper": case "fadeaway": case "floater": case "hook": case "layup": case "dunk":
          this.progressShot(a, dt);
          break;
        case "pass":
          if (ac.t >= (ac.data.release as number) && !ac.data.thrown) this.releasePass(a);
          if (ac.t >= ac.dur) a.action = act("idle");
          break;
        case "dribbleMove":
          if (ac.t >= ac.dur) a.action = act("idle");
          break;
        case "steal": case "block": case "rebound": case "fall": case "celebrate": case "dejected": case "catch":
          if (ac.dur && ac.t >= ac.dur && a.y === 0) a.action = act("idle");
          break;
        default:
          break;
      }
      // stamina
      const sp = len2(a.vel.x, a.vel.z);
      if (s.cfg.fatigue && s.phase === "live") {
        const drain = (sp > 6 ? 0.012 : sp > 3 ? 0.005 : -0.004) * (1.3 - a.player.ratings.stamina / 160);
        a.stamina = clamp(a.stamina - drain * dt * 1.6, 0.25, 1);
      }
    }
  }

  private handleIntentAct(a: Agent) {
    const s = this.state;
    let ia = a.intent.act;
    // input buffer: replay a recent press once the player is free
    if (!ia && a.buffered && s.time <= a.buffered.until && !this.isBusy(a)) {
      ia = a.buffered.act;
      a.buffered = null;
    }
    if (!ia) return;
    a.intent.act = undefined;
    if (s.phase === "freethrows") {
      if (ia.type === "shoot" && s.freeThrows && s.freeThrows.shooter === a.idx) this.ftInput(ia.phase);
      return;
    }
    if (s.phase === "inbound") {
      if (ia.type === "pass" && s.inbound && s.inbound.inbounder === a.idx && s.ball.owner === a.idx) {
        this.startPass(a, ia.to, ia.kind === "alley" ? "lob" : ia.kind);
      }
      return;
    }
    if (a.human !== null && this.isBusy(a) && (ia.type === "shoot" && ia.phase === "press" || ia.type === "pass" || ia.type === "dribbleMove" || ia.type === "steal" || ia.type === "block")) {
      const shooting = ["jumper", "fadeaway", "floater", "hook", "layup", "dunk"].includes(a.action.kind);
      if (!(ia.type === "pass" && shooting)) {
        a.buffered = { act: ia, until: s.time + 0.35 };
        return;
      }
    }
    // a release that arrives while the press is still buffered becomes a quick release
    if (ia.type === "shoot" && ia.phase === "release" && a.buffered?.act.type === "shoot") {
      a.buffered.act = { type: "shoot", phase: "press" };
      a.quickRelease = true;
      return;
    }
    if (s.phase !== "live" && s.phase !== "jumpball") return;
    const hasBall = s.ball.owner === a.idx;
    switch (ia.type) {
      case "shoot":
        if (ia.phase === "press" && hasBall && !this.isBusy(a)) {
          this.beginShot(a);
          if (a.quickRelease) { a.quickRelease = false; a.action.data.pendingQuick = true; }
        }
        else if (ia.phase === "release" && ["jumper", "fadeaway", "floater", "hook", "layup"].includes(a.action.kind)) this.humanRelease(a);
        break;
      case "pass":
        if (hasBall && !this.isBusy(a) && a.action.kind !== "dunk") this.startPass(a, ia.to, ia.kind);
        else if (hasBall && ["jumper", "layup"].includes(a.action.kind) && !a.action.data.released && a.y > 0) this.startPass(a, ia.to, ia.kind, true);
        break;
      case "dribbleMove":
        if (hasBall && !this.isBusy(a) && !a.pickedUp) this.dribbleMove(a, ia.move, ia.dir);
        break;
      case "steal":
        if (!hasBall && !this.isBusy(a)) this.attemptSteal(a);
        break;
      case "block":
        if (!hasBall && !this.isBusy(a) && a.y === 0) this.attemptBlock(a);
        break;
      case "rebound":
        if (!hasBall && !this.isBusy(a) && a.y === 0) this.attemptReboundJump(a);
        break;
      case "pumpFake":
        if (hasBall && !this.isBusy(a)) this.pumpFake(a);
        break;
      case "post":
        if (hasBall) a.action = ia.on ? act("post") : act("idle");
        break;
      case "callScreen":
        s.teams[a.team].playCall = "pnr";
        break;
      case "takeCharge":
        if (!hasBall && !this.isBusy(a)) this.startAction(a, "stance", 0.8, { charge: true });
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------- movement
  maxSpeed(a: Agent, sprint: boolean) {
    const s = this.state;
    const hasBall = s.ball.owner === a.idx;
    const spd = hasBall ? (this.r(a, "speedWithBall") * 0.6 + this.r(a, "speed") * 0.4) : this.r(a, "speed");
    let v = 3.3 + spd * 0.03;
    if (sprint) v *= 1.32 * (0.75 + 0.25 * a.stamina);
    if (a.action.kind === "post") v *= 0.45;
    if (a.action.kind === "stance") v *= 0.78;
    if (a.stun > 0) v *= 0.2;
    return v * s.cfg.sliders.speed;
  }

  private moveAgents(dt: number) {
    const s = this.state;
    const c = s.cfg.court;
    for (const a of s.agents) {
      const busyGround = ["gather", "pass", "freeThrow", "inbound", "jumpball"].includes(a.action.kind) && a.action.kind !== "inbound";
      const shooting = ["jumper", "fadeaway", "hook", "floater"].includes(a.action.kind);
      const moving = a.intent;
      let tx = moving.moveX, tz = moving.moveZ;
      const mag = Math.hypot(tx, tz);
      if (mag > 1) { tx /= mag; tz /= mag; }
      let maxV = this.maxSpeed(a, moving.sprint) * Math.min(1, mag);
      if (busyGround) maxV *= 0.15;
      if (shooting) maxV = 0;
      if (a.action.kind === "fall") maxV = 0;
      const desiredX = tx * (mag > 0.01 ? maxV / Math.max(Math.min(1, mag), 0.01) * Math.min(1, mag) : 0);
      const desiredZ = tz * (mag > 0.01 ? maxV / Math.max(Math.min(1, mag), 0.01) * Math.min(1, mag) : 0);
      const accel = (5.5 + this.r(a, "accel") * 0.085) * (a.y > 0 ? 0.08 : 1);
      // dribble move burst
      if (a.action.kind === "dribbleMove") {
        const d = a.action.data;
        const k = Math.sin(Math.PI * clamp(a.action.t / a.action.dur, 0, 1));
        a.vel.x += (d.bx as number) * k * 22 * dt;
        a.vel.z += (d.bz as number) * k * 22 * dt;
      }
      if (["layup", "dunk"].includes(a.action.kind) && a.y > 0) {
        // carry momentum through the air
      } else {
        const dvx = desiredX - a.vel.x, dvz = desiredZ - a.vel.z;
        const dl = Math.hypot(dvx, dvz);
        const maxDv = accel * dt;
        if (dl > maxDv) { a.vel.x += (dvx / dl) * maxDv; a.vel.z += (dvz / dl) * maxDv; }
        else { a.vel.x = desiredX; a.vel.z = desiredZ; }
      }
      // boundary assist: ball handlers plant before the line instead of drifting out
      if (s.ball.owner === a.idx && a.y === 0 && s.phase === "live" && (a.human === null || s.cfg.boundaryAssist)) {
        const lim = 0.55;
        if (Math.abs(a.pos.z) > c.halfW - lim && a.vel.z * Math.sign(a.pos.z) > 0) a.vel.z *= Math.exp(-14 * dt);
        if (Math.abs(a.pos.x) > c.halfL - lim && a.vel.x * Math.sign(a.pos.x) > 0) a.vel.x *= Math.exp(-14 * dt);
      }
      a.pos.x += a.vel.x * dt;
      a.pos.z += a.vel.z * dt;
      if (s.ball.owner === a.idx && a.y === 0 && s.phase === "live" && (a.human === null || s.cfg.boundaryAssist)) {
        a.pos.z = clamp(a.pos.z, -c.halfW + 0.12, c.halfW - 0.12);
        a.pos.x = clamp(a.pos.x, -c.halfL + 0.12, c.halfL - 0.12);
      }
      // facing
      let face: number | null = null;
      if (moving.faceX !== undefined && moving.faceZ !== undefined) face = Math.atan2(moving.faceX - a.pos.x, moving.faceZ - a.pos.z);
      else if (Math.hypot(a.vel.x, a.vel.z) > 0.6) face = Math.atan2(a.vel.x, a.vel.z);
      if (face !== null && !shooting) {
        const turn = (a.y > 0 ? 2 : 9) * dt;
        a.facing += clamp(angDiff(a.facing, face), -turn, turn);
      } else if (shooting && typeof a.action.data.faceTo === "number") {
        // square up to the rim while gathering; small corrections in the air
        const turn = (a.y > 0 ? 3 : 11) * dt;
        a.facing += clamp(angDiff(a.facing, a.action.data.faceTo as number), -turn, turn);
      }
      // keep players roughly on/near the floor
      a.pos.x = clamp(a.pos.x, -c.halfL - 1.2, c.halfL + 1.2);
      a.pos.z = clamp(a.pos.z, -c.halfW - 1.2, c.halfW + 1.2);
    }
    // collisions
    const ags = s.agents;
    for (let i = 0; i < ags.length; i++) {
      for (let j = i + 1; j < ags.length; j++) {
        const A = ags[i], B = ags[j];
        const dx = B.pos.x - A.pos.x, dz = B.pos.z - A.pos.z;
        const d = Math.hypot(dx, dz);
        const minD = AGENT_RADIUS * 2;
        if (d < minD && d > 1e-5) {
          const push = (minD - d);
          const sa = this.r(A, "strength") + (A.action.kind === "screen" ? 40 : 0) + (A.action.kind === "post" ? 15 : 0);
          const sb = this.r(B, "strength") + (B.action.kind === "screen" ? 40 : 0) + (B.action.kind === "post" ? 15 : 0);
          const wa = sb / (sa + sb), wb = sa / (sa + sb);
          const nx = dx / d, nz = dz / d;
          A.pos.x -= nx * push * wa; A.pos.z -= nz * push * wa;
          B.pos.x += nx * push * wb; B.pos.z += nz * push * wb;
          // bleed velocity into each other (screens stop defenders)
          const rel = (B.vel.x - A.vel.x) * nx + (B.vel.z - A.vel.z) * nz;
          if (rel < 0) {
            A.vel.x += nx * rel * wa; A.vel.z += nz * rel * wa;
            B.vel.x -= nx * rel * wb; B.vel.z -= nz * rel * wb;
          }
          this.onContact(A, B);
        }
      }
    }
  }

  /** Charges / blocking fouls on hard contact with the ball handler. */
  private onContact(A: Agent, B: Agent) {
    const s = this.state;
    if (s.phase !== "live" || !s.cfg.fouls) return;
    const h = this.handler();
    if (!h || (h !== A && h !== B)) return;
    const d = h === A ? B : A;
    if (d.team === h.team) return;
    const speed = Math.hypot(h.vel.x, h.vel.z);
    if (speed < 5.2 || h.y > 0) return;
    if (d.action.kind === "stance" && d.action.data.charge && Math.hypot(d.vel.x, d.vel.z) < 0.8) {
      // must be outside restricted area
      const rimP = this.rim(h.team);
      if (Math.hypot(d.pos.x - rimP.x, d.pos.z - rimP.z) > s.cfg.court.restrictedRadius) {
        if (this.rng.chance(0.55)) {
          this.startAction(d, "fall", 1.2);
          this.foul(h, d, "charge", false);
        }
      }
    }
  }

  // ------------------------------------------------------------- dribbling
  dribbleMove(a: Agent, move: DribbleMoveKind, dir: number) {
    const s = this.state;
    const durs: Record<DribbleMoveKind, number> = { crossover: 0.42, behindBack: 0.5, spin: 0.62, hesitation: 0.55, stepback: 0.55, betweenLegs: 0.45 };
    // burst direction: lateral relative to facing (dir = -1 left / +1 right), stepback = backwards
    const f = a.facing;
    const fx = Math.sin(f), fz = Math.cos(f);
    const lx = Math.cos(f) * dir, lz = -Math.sin(f) * dir;
    let bx = lx, bz = lz;
    if (move === "stepback") { bx = -fx; bz = -fz; }
    if (move === "hesitation") { bx = fx * 0.6; bz = fz * 0.6; }
    if (move === "spin") { bx = (lx + fx) * 0.7; bz = (lz + fz) * 0.7; }
    this.startAction(a, "dribbleMove", durs[move], { move, dir, bx, bz });
    a.hand = (move === "crossover" || move === "behindBack" || move === "betweenLegs" ? -a.hand : a.hand) as 1 | -1;
    // ankle breaker vs on-ball defender
    const def = this.nearestOpponent(a);
    let broke: number | null = null;
    if (def && dist2(def.pos, a.pos) < 1.8 && def.stun === 0) {
      const p = clamp(0.06 + (this.r(a, "ballHandle") - this.r(def, "perimeterD")) * 0.0065 + (move === "hesitation" ? 0.03 : 0), 0.02, 0.38);
      if (this.rng.chance(p)) {
        def.stun = this.rng.range(0.55, 1.1);
        broke = def.idx;
        if (this.rng.chance(0.18)) this.startAction(def, "fall", 1.3);
      }
    }
    // loose handle under pressure
    if (def && dist2(def.pos, a.pos) < 1.0 && this.rng.chance(clamp(0.025 - this.r(a, "ballHandle") * 0.0002, 0.003, 0.02))) {
      this.looseBall(a, "lostBall");
      return;
    }
    this.emit({ t: "dribbleMove", player: a.idx, move, broke });
  }

  pumpFake(a: Agent) {
    this.startAction(a, "gather", 0.35, { fake: true });
    const def = this.nearestOpponent(a);
    if (def && dist2(def.pos, a.pos) < 2.2 && def.y === 0 && this.rng.chance(clamp(0.45 - this.r(def, "iq") * 0.004, 0.08, 0.4))) {
      this.attemptBlock(def, true);
    }
  }

  nearestOpponent(a: Agent): Agent | null {
    let best: Agent | null = null, bd = 1e9;
    for (const o of this.state.agents) {
      if (o.team === a.team) continue;
      const d = dist2(o.pos, a.pos);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  // -------------------------------------------------------------- shooting
  shotKindFor(a: Agent): ShotKind {
    const s = this.state;
    const d = distToRim(s.cfg.court, this.attackSide(a.team), a.pos.x, a.pos.z);
    const speed = Math.hypot(a.vel.x, a.vel.z);
    const towardRim = this.towardRim(a);
    const canDunk = this.reach(a) + this.verticalLeap(a) > s.cfg.court.rimHeight + 0.12;
    if (d < 2.6 && canDunk && (speed > 2.5 || d < 1.3) && this.r(a, "dunk") > 45 && towardRim > 0.2) return "dunk";
    if (d < 2.9 && (speed > 2.2 || d < 1.4)) return "layup";
    if (d < 4.2 && speed > 2.5 && towardRim > 0.4 && this.r(a, "closeShot") > 55) return "floater";
    if (d < 3.4 && a.action.kind === "post") return "hook";
    if (d < 5.5 && a.action.kind === "post") return "fadeaway";
    return "jumper";
  }

  towardRim(a: Agent) {
    const rim = this.rim(a.team);
    const dx = rim.x - a.pos.x, dz = rim.z - a.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const sp = Math.hypot(a.vel.x, a.vel.z) || 1;
    return (a.vel.x * dx + a.vel.z * dz) / (d * sp);
  }

  beginShot(a: Agent, forceKind?: ShotKind) {
    const s = this.state;
    if (s.ball.owner !== a.idx) return;
    const kind = forceKind ?? this.shotKindFor(a);
    const lv = this.verticalLeap(a);
    // shooting rhythm: a deliberate gather; good shooters and catch-and-shoot looks are a touch quicker
    const sk = (a.player.ratings.midRange + a.player.ratings.three) / 2;
    const catchShoot = s.time - s.ball.lastPassTime < 0.7 && a.holdTime < 0.7;
    const gather = clamp(0.42 - (sk - 50) * 0.0016, 0.3, 0.44) * (catchShoot ? 0.88 : 1);
    const timing: Record<ShotKind, { dur: number; jumpAt: number; jump: number; release: number }> = {
      jumper: { dur: gather + 0.95, jumpAt: gather, jump: lv * 0.55, release: 0.0 },
      fadeaway: { dur: gather + 1.0, jumpAt: gather + 0.04, jump: lv * 0.5, release: 0.0 },
      floater: { dur: 1.0, jumpAt: 0.24, jump: lv * 0.45, release: 0.0 },
      hook: { dur: 1.05, jumpAt: 0.3, jump: lv * 0.4, release: 0.0 },
      layup: { dur: 1.2, jumpAt: 0.36, jump: lv * 0.85, release: 0.0 },
      dunk: { dur: 1.4, jumpAt: 0.38, jump: Math.max(lv, s.cfg.court.rimHeight + 0.15 - this.reach(a)), release: 0.0 },
      freeThrow: { dur: 1.0, jumpAt: 99, jump: 0, release: 0.55 },
      tip: { dur: 0.5, jumpAt: 0, jump: lv * 0.8, release: 0.25 },
    };
    const tm = timing[kind];
    const apexT = tm.jumpAt + Math.sqrt(2 * 9.81 * Math.max(0.05, tm.jump)) / 9.81;
    const release = kind === "layup" ? apexT - 0.03 : kind === "dunk" ? apexT : apexT - 0.02;
    this.startAction(a, kind as ActionKind, tm.dur, {
      jumpAt: tm.jumpAt, jumpH: tm.jump, release, released: false, ideal: release,
      human: a.human !== null, pressT: s.time, releasedAt: -1, quality: NaN, fromX: a.pos.x, fromZ: a.pos.z,
    });
    a.pickedUp = true;
    if (kind === "layup" || kind === "dunk") {
      // drive momentum toward the rim
      const rim = this.rim(a.team);
      const dx = rim.x - a.pos.x, dz = rim.z - a.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const v = Math.min(4.2, d / (release + 0.05));
      a.vel.x = (dx / d) * v * 0.9 + a.vel.x * 0.1;
      a.vel.z = (dz / d) * v * 0.9 + a.vel.z * 0.1;
      a.facing = Math.atan2(dx, dz);
    } else {
      // turn to the rim during the gather (see moveAgents) instead of snapping
      const rim = this.rim(a.team);
      const face = Math.atan2(rim.x - a.pos.x, rim.z - a.pos.z);
      a.action.data.faceTo = face;
      if (kind === "fadeaway") { a.vel.x = -Math.sin(face) * 1.2; a.vel.z = -Math.cos(face) * 1.2; }
    }
    // defenders react
    for (const d of this.agentsOf(a.team === 0 ? 1 : 0)) d.intent.act = undefined;
  }

  /** Human released the shoot button: record timing quality. */
  humanRelease(a: Agent) {
    a.quickRelease = false;
    const ac = a.action;
    if (ac.data.released || ac.data.releasedAt as number >= 0) return;
    ac.data.releasedAt = ac.t;
    const ideal = ac.data.ideal as number;
    // window scales with shooting skill: better shooters get bigger green windows
    ac.data.quality = (ac.t - ideal) / 0.22;
    ac.data.release = Math.max(ac.t, Math.min(ideal + 0.12, ac.t + 0.02));
  }

  private progressShot(a: Agent, dt: number) {
    const s = this.state;
    const ac = a.action;
    const d = ac.data;
    if (ac.t >= (d.jumpAt as number) && !d.jumped) {
      d.jumped = true;
      this.startJump(a, d.jumpH as number);
    }
    if (d.pendingQuick && ac.t >= (d.ideal as number) - 0.04) { d.pendingQuick = false; this.humanRelease(a); }
    // human never released: auto-release late
    if (d.human && !d.released && (d.releasedAt as number) < 0 && ac.t >= (d.ideal as number) + 0.18 && s.cfg.shotMeter) {
      d.releasedAt = ac.t;
      d.quality = (ac.t - (d.ideal as number)) / 0.22;
      d.release = ac.t;
    }
    if (s.ball.owner !== a.idx && !d.released) { a.action = act("idle"); return; }
    if (!d.released && ac.t >= (d.release as number) && !d.fake) {
      if (d.human && s.cfg.shotMeter && (d.releasedAt as number) < 0) return; // waiting for release
      d.released = true;
      this.releaseShot(a);
    }
    if (ac.t >= ac.dur && a.y === 0) a.action = act("idle");
    void dt;
  }

  /** Contest level 0..1 against a shooter at its current position. */
  contestOn(a: Agent): number {
    let best = 0;
    for (const o of this.agentsOf(a.team === 0 ? 1 : 0)) {
      const d = dist2(o.pos, a.pos);
      if (d > 2.4) continue;
      const hand = o.action.kind === "block" || o.y > 0 ? 1.15 : o.action.kind === "stance" ? 1.0 : 0.8;
      const facing = Math.cos(angDiff(o.facing, Math.atan2(a.pos.x - o.pos.x, a.pos.z - o.pos.z)));
      const heightAdv = clamp(1 + (o.player.heightIn - a.player.heightIn) * 0.02, 0.8, 1.25);
      const skill = 0.6 + 0.4 * ((d < 1.6 ? this.r(o, "interiorD") * 0.3 + this.r(o, "perimeterD") * 0.7 : this.r(o, "perimeterD")) / 99);
      const c = clamp((2.2 - d) / 1.6, 0, 1) * hand * heightAdv * skill * (0.55 + 0.45 * Math.max(0, facing)) * (o.stun > 0 ? 0.3 : 1);
      best = Math.max(best, c);
    }
    return clamp(best, 0, 1);
  }

  makeProbability(a: Agent, kind: ShotKind, dist: number, three: boolean, contest: number, quality: number): number {
    const s = this.state;
    const sl = s.cfg.sliders;
    let p: number;
    switch (kind) {
      case "dunk": p = 0.86 + (this.r(a, "dunk") - 50) * 0.0025; break;
      case "layup": p = 0.42 + (this.r(a, "layup") - 50) * 0.0062 - Math.max(0, dist - 1.2) * 0.03; break;
      case "tip": p = 0.4 + (this.r(a, "closeShot") - 50) * 0.004; break;
      case "floater": p = 0.33 + (this.r(a, "closeShot") - 50) * 0.0048; break;
      case "hook": p = 0.36 + (this.r(a, "postControl") * 0.5 + this.r(a, "closeShot") * 0.5 - 50) * 0.005; break;
      case "fadeaway": p = 0.3 + (this.r(a, "midRange") * 0.6 + this.r(a, "postControl") * 0.4 - 50) * 0.0045; break;
      case "freeThrow": p = 0.33 + this.r(a, "freeThrow") * 0.0059; break;
      default: {
        if (three) {
          const extra = Math.max(0, dist - s.cfg.court.threeRadius - 0.45);
          p = 0.302 + (this.r(a, "three") - 50) * 0.0043 - extra * 0.055;
        } else if (dist < 3) {
          p = 0.36 + (this.r(a, "closeShot") * 0.4 + this.r(a, "midRange") * 0.6 - 50) * 0.0045;
        } else {
          p = 0.3 + (this.r(a, "midRange") - 50) * 0.0046 - Math.max(0, dist - 5) * 0.012;
        }
      }
    }
    if (kind !== "freeThrow") {
      const cw = kind === "dunk" ? 0.18 : kind === "layup" ? 0.38 : 0.5;
      p *= 1 - cw * contest;
      const moving = Math.hypot(a.vel.x, a.vel.z);
      if (kind === "jumper" && moving > 2.5) p *= 0.9;
      if (kind === "jumper" && s.time - s.ball.lastPassTime < 1.2) p *= 1.04; // catch and shoot
      p *= 1 + a.heat * 0.06;
      // clutch
      const lead = Math.abs(s.teams[0].score - s.teams[1].score);
      if (s.clock < 120 && s.period >= s.cfg.rules.periods && lead <= 6) p *= 0.94 + this.r(a, "clutch") * 0.0011;
    }
    // shot meter timing
    if (!Number.isNaN(quality)) {
      const q = Math.abs(quality);
      const greenW = 0.06 + (this.r(a, kind === "freeThrow" ? "freeThrow" : three ? "three" : "midRange") - 50) * 0.0012;
      if (q < greenW) p = Math.max(p, Math.min(0.97, p * 1.6 + 0.12));
      else if (q < 0.22) p *= 1.04;
      else if (q < 0.45) p *= 0.78;
      else p *= 0.35;
    }
    p *= sl.shotSuccess;
    if (three) p *= sl.threeSuccess;
    if (kind === "layup" || kind === "dunk") p *= sl.layupSuccess;
    return clamp(p, 0.01, 0.99);
  }

  private releaseShot(a: Agent) {
    const s = this.state;
    const c = s.cfg.court;
    const side = this.attackSide(a.team);
    const kind = a.action.kind as ShotKind;
    const d = a.action.data;
    const dist = distToRim(c, side, d.fromX as number, d.fromZ as number);
    const three = kind !== "dunk" && kind !== "layup" && isThree(c, side, d.fromX as number, d.fromZ as number);
    const contest = this.contestOn(a);
    const quality = d.human && s.cfg.shotMeter ? (d.quality as number) : NaN;
    let pMake = this.makeProbability(a, kind, dist, three, contest, quality);

    // shooting foul?
    let fouled = false;
    if (s.cfg.fouls) {
      const base = kind === "dunk" || kind === "layup" ? 0.34 : kind === "floater" || kind === "hook" ? 0.16 : 0.065;
      const pf = base * contest * (0.45 + this.r(a, "drawFoul") / 110) * s.cfg.sliders.foulFrequency;
      if (this.rng.chance(pf)) {
        fouled = true;
        pMake *= kind === "dunk" ? 0.65 : 0.4;
      }
    }
    // block?
    const blocker = this.checkBlock(a, kind, dist);
    const willMake = !blocker && this.rng.chance(pMake);
    const points = (three ? 3 : 2) as 2 | 3;
    const assistFrom = s.ball.lastPasser !== null && s.ball.lastPasser !== a.idx && s.time - s.ball.lastPassTime < 4 && this.state.agents[s.ball.lastPasser].team === a.team ? s.ball.lastPasser : null;
    s.ball.shot = {
      shooter: a.idx, team: a.team, kind, points, willMake, contest, quality, fouled, fromX: d.fromX as number, fromZ: d.fromZ as number,
      blocked: !!blocker, assistFrom, releaseTime: s.time, side,
    };
    s.ball.mode = "shot";
    s.ball.owner = null;
    s.ball.lastTouch = a.team;
    s.ball.lastToucher = a.idx;
    s.ball.phys.touchedRim = false;
    s.ball.phys.touchedBoard = false;
    s.ball.phys.aboveRim = {};
    s.ball.phys.inNet = 0;
    this.emit({ t: "shot", shooter: a.idx, kind, points, distance: dist, contested: contest });

    // release point (hands above head)
    const h = this.heightM(a);
    const fx = Math.sin(a.facing), fz = Math.cos(a.facing);
    const handH = kind === "dunk" ? c.rimHeight + 0.15 : a.y + h * (kind === "layup" ? 1.18 : 1.13);
    s.ball.phys.pos = v3(a.pos.x + fx * 0.25, handH, a.pos.z + fz * 0.25);
    if (blocker) {
      this.resolveBlock(blocker, a);
      return;
    }
    const rim = rimPos(c, side);
    if (kind === "dunk") {
      s.ball.phys.pos = v3(rim.x - side * 0.05, rim.y + 0.25, rim.z);
      s.ball.phys.vel = willMake ? v3(side * 0.1, -4.5, 0) : v3(-side * 2.5, 2.5, this.rng.range(-1.5, 1.5));
      s.ball.phys.aboveRim = { r: true, l: true };
      return;
    }
    // aim: perfect center for makes (with tiny jitter), offsets for misses
    let target = v3(rim.x, rim.y, rim.z);
    const towardShooter = Math.atan2(s.ball.phys.pos.x - rim.x, s.ball.phys.pos.z - rim.z);
    if (willMake) {
      const j = 0.025;
      target = v3(rim.x + this.rng.range(-j, j), rim.y, rim.z + this.rng.range(-j, j));
      // bank shots from the wings sometimes
      if (kind === "layup" && this.rng.chance(0.4)) {
        target = v3(rim.x + side * 0.05, rim.y, rim.z);
      }
    } else {
      // miss: short/long/left/right off the rim
      const kindMiss = this.rng.weighted(["short", "long", "left", "right"], [3, 4, 2, 2]);
      const off = this.rng.range(0.19, 0.3);
      const ax = Math.sin(towardShooter), az = Math.cos(towardShooter);
      const px = Math.cos(towardShooter), pz = -Math.sin(towardShooter);
      if (kindMiss === "short") target = v3(rim.x + ax * off, rim.y, rim.z + az * off);
      else if (kindMiss === "long") target = v3(rim.x - ax * off, rim.y, rim.z - az * off);
      else if (kindMiss === "left") target = v3(rim.x + px * off, rim.y, rim.z + pz * off);
      else target = v3(rim.x - px * off, rim.y, rim.z - pz * off);
    }
    const arc = kind === "layup" ? 58 : kind === "floater" ? 62 : kind === "hook" ? 56 : 50 + this.rng.range(-2, 3);
    const spin = v3(-Math.cos(towardShooter) * 18, 0, Math.sin(towardShooter) * 18); // backspin
    const sol = aimAt(s.ball.phys.pos, target, (arc * Math.PI) / 180, spin) ?? solveArc(s.ball.phys.pos, target, 1.4);
    s.ball.phys.vel = sol.vel;
    s.ball.phys.spin = spin;
  }

  private checkBlock(a: Agent, kind: ShotKind, dist: number): Agent | null {
    const s = this.state;
    const h = this.heightM(a);
    const ballH = a.y + h * 1.13;
    let best: Agent | null = null, bp = 0;
    for (const o of this.agentsOf(a.team === 0 ? 1 : 0)) {
      if (o.action.kind !== "block" && o.action.kind !== "rebound") continue;
      const d = dist2(o.pos, a.pos);
      if (d > 1.35) continue;
      const handH = o.y + this.reach(o);
      if (handH < ballH - 0.15) continue;
      // timing: best near the defender's apex
      const p = 0.26 * (this.r(o, "block") / 80) * clamp(1.4 - d, 0.2, 1) * clamp(1 + (handH - ballH) * 0.6, 0.5, 1.4)
        * (kind === "jumper" ? 0.55 : kind === "fadeaway" ? 0.35 : kind === "dunk" ? 0.5 : 1) * s.cfg.sliders.blockSuccess;
      if (p > bp) { bp = p; best = o; }
    }
    void dist;
    if (best && this.rng.chance(bp)) return best;
    return null;
  }

  private resolveBlock(blocker: Agent, shooter: Agent) {
    const s = this.state;
    const b = s.ball.phys;
    // goaltending is handled in flight checks; here the ball is swatted
    const away = Math.atan2(blocker.pos.x - shooter.pos.x, blocker.pos.z - shooter.pos.z);
    const sp = this.rng.range(3.5, 7.5);
    b.vel = v3(Math.sin(away) * sp + this.rng.range(-1.5, 1.5), this.rng.range(-1.5, 2.5), Math.cos(away) * sp + this.rng.range(-1.5, 1.5));
    s.ball.mode = "loose"; s.ball.looseCause = "block";
    s.ball.lastTouch = blocker.team;
    s.ball.lastToucher = blocker.idx;
    s.box[blocker.player.id].blk++;
    const sl = s.box[shooter.player.id];
    sl.fga++;
    if (s.ball.shot?.points === 3) sl.tpa++;
    this.emit({ t: "block", blocker: blocker.idx, shooter: shooter.idx });
    this.log(`${this.name(blocker)} blocks ${this.name(shooter)}!`, blocker.team);
    s.ball.shot = null;
  }

  // ---------------------------------------------------------------- passing
  startPass(a: Agent, to: number, kind: "chest" | "bounce" | "lob" | "alley", fromAir = false) {
    const s = this.state;
    if (to === a.idx || !s.agents[to] || s.agents[to].team !== a.team) return;
    const release = fromAir ? 0.05 : kind === "lob" || kind === "alley" ? 0.22 : 0.14;
    this.startAction(a, "pass", release + 0.25, { to, kind, release, thrown: false });
    if (fromAir) a.action.dur = Math.max(0.35, 0.05 + a.vy / 9.81 * 2);
  }

  private releasePass(a: Agent) {
    const s = this.state;
    const ac = a.action;
    ac.data.thrown = true;
    if (s.ball.owner !== a.idx) return;
    const to = s.agents[ac.data.to as number];
    const kind = ac.data.kind as "chest" | "bounce" | "lob" | "alley";
    const speed = (kind === "bounce" ? 7.5 : kind === "lob" || kind === "alley" ? 9 : 10) + this.r(a, "passAccuracy") * 0.03;
    // lead the receiver
    const dist0 = dist2(a.pos, to.pos);
    const tFlight = dist0 / speed;
    let target = v2(to.pos.x + to.vel.x * tFlight * 0.85, to.pos.z + to.vel.z * tFlight * 0.85);
    if (kind === "alley") {
      const rim = this.rim(a.team);
      target = v2(rim.x - this.attackSide(a.team) * 0.4, rim.z);
    }
    // inaccuracy
    const pressure = this.pressureOn(a);
    const errP = clamp((1 - this.r(a, "passAccuracy") / 100) * 0.06 * (0.5 + pressure) * (dist0 / 8) * (1 / s.cfg.sliders.passAccuracy), 0, 0.2);
    let errant = false;
    if (this.rng.chance(errP)) {
      errant = true;
      target.x += this.rng.range(-2.5, 2.5);
      target.z += this.rng.range(-2.5, 2.5);
    } else {
      const jitter = 0.35 * (1 - this.r(a, "passAccuracy") / 120);
      target.x += this.rng.range(-jitter, jitter);
      target.z += this.rng.range(-jitter, jitter);
    }
    const dur = Math.max(0.18, dist2(a.pos, target) / speed) * (kind === "lob" || kind === "alley" ? 1.35 : 1);
    const b = s.ball.phys;
    const fx = Math.sin(a.facing), fz = Math.cos(a.facing);
    b.pos = v3(a.pos.x + fx * 0.35, a.y + this.heightM(a) * (kind === "lob" || kind === "alley" ? 1.05 : 0.72), a.pos.z + fz * 0.35);
    const catchH = kind === "alley" ? s.cfg.court.rimHeight + 0.35 : this.heightM(to) * 0.72;
    if (kind === "bounce") {
      // first leg to a bounce point 60% of the way
      const bp = v3(b.pos.x + (target.x - b.pos.x) * 0.6, s.cfg.court.ballRadius, b.pos.z + (target.z - b.pos.z) * 0.6);
      b.vel = solveTime(b.pos, bp, dur * 0.55);
      b.vel.y = Math.min(b.vel.y, -1.5);
    } else {
      b.vel = solveTime(b.pos, v3(target.x, catchH, target.z), dur);
    }
    b.spin = v3();
    s.ball.mode = "pass";
    s.ball.owner = null;
    s.ball.pass = { from: a.idx, to: to.idx, kind, target, t: 0, dur, rolled: [] };
    s.ball.lastTouch = a.team;
    s.ball.lastToucher = a.idx;
    a.pickedUp = false;
    this.emit({ t: "pass", from: a.idx, to: to.idx, kind });
    if (errant) s.ball.pass.to = -1;
  }

  pressureOn(a: Agent): number {
    let p = 0;
    for (const o of this.agentsOf(a.team === 0 ? 1 : 0)) {
      const d = dist2(o.pos, a.pos);
      p = Math.max(p, clamp((2.0 - d) / 1.6, 0, 1));
    }
    return p;
  }

  // -------------------------------------------------------- steals & blocks
  attemptSteal(d: Agent) {
    const s = this.state;
    this.startAction(d, "steal", 0.45);
    const h = this.handler();
    if (!h || h.team === d.team || s.phase !== "live") return;
    const dist = dist2(h.pos, d.pos);
    if (dist > 1.25) return;
    const shooting = ["jumper", "layup", "dunk", "fadeaway", "floater", "hook"].includes(h.action.kind);
    if (shooting) {
      if (s.cfg.fouls && this.rng.chance(0.35)) this.foul(d, h, "shooting", true);
      return;
    }
    // ball on the far hand is harder to reach
    const angleToD = Math.atan2(d.pos.x - h.pos.x, d.pos.z - h.pos.z);
    const handSide = Math.sin(angDiff(h.facing, angleToD)) * h.hand; // >0 ball exposed
    const exposed = clamp(0.5 + handSide * 0.5, 0.15, 1);
    let p = (0.05 + (this.r(d, "steal") - this.r(h, "ballHandle")) * 0.0028) * exposed * (h.action.kind === "dribbleMove" ? 1.4 : 1) * s.cfg.sliders.stealSuccess;
    if (h.action.kind === "post") p *= 0.6;
    if (this.rng.chance(clamp(p, 0.005, 0.32))) {
      s.box[d.player.id].stl++;
      s.box[h.player.id].tov++;
      this.emit({ t: "steal", player: d.idx, from: h.idx });
      this.log(`${this.name(d)} steals the ball from ${this.name(h)}`, d.team);
      // ball pops loose toward the defender
      s.ball.mode = "loose"; s.ball.looseCause = "steal";
      s.ball.owner = null;
      s.ball.lastTouch = d.team;
      s.ball.lastToucher = d.idx;
      const b = s.ball.phys;
      b.pos = v3(h.pos.x, 0.8, h.pos.z);
      b.vel = v3(Math.sin(angleToD) * 2.5, 1.5, Math.cos(angleToD) * 2.5);
      this.changePossessionTracking(d.team);
    } else if (s.cfg.fouls && this.rng.chance(clamp(0.1 - this.r(d, "iq") * 0.0006 + (dist < 0.7 ? 0.05 : 0), 0.02, 0.15) * s.cfg.sliders.foulFrequency)) {
      this.foul(d, h, "reach", false);
    } else {
      d.stun = Math.max(d.stun, 0.25); // off balance after a gamble
    }
  }

  attemptBlock(d: Agent, onFake = false) {
    const lv = this.verticalLeap(d);
    this.startAction(d, "block", 1.0, { fake: onFake });
    this.startJump(d, lv * 0.9);
    if (onFake) d.stun = 0.6;
  }

  attemptReboundJump(a: Agent) {
    this.startAction(a, "rebound", 0.9);
    this.startJump(a, this.verticalLeap(a) * 0.85);
  }

  // ------------------------------------------------------------------- ball
  private stepBallLive(dt: number) {
    const s = this.state;
    const b = s.ball;
    switch (b.mode) {
      case "held":
      case "dribble":
        this.stepBallVisual(dt);
        if (b.owner !== null) {
          const h = s.agents[b.owner];
          h.holdTime += dt;
          // out of bounds with ball
          if (!inBounds(s.cfg.court, h.pos.x, h.pos.z, -0.05) && h.y === 0 && s.phase === "live") {
            this.turnover(h, "outOfBounds");
            this.violation(h.team, "outOfBounds", h.idx);
          }
        }
        break;
      case "shot":
        this.stepBallFlight(dt);
        this.checkGoaltend();
        break;
      case "pass":
        this.stepPass(dt);
        break;
      case "loose":
        this.stepBallFlight(dt);
        this.tryLooseRecovery();
        this.checkLooseOOB();
        break;
      default:
        break;
    }
  }

  /** Ball attached to the handler (rendering uses dribblePhase for the bounce). */
  private stepBallVisual(dt: number) {
    const s = this.state;
    const b = s.ball;
    if (b.owner === null) return;
    const h = s.agents[b.owner];
    const moving = Math.hypot(h.vel.x, h.vel.z);
    const rate = 1.6 + moving * 0.28;
    const dribbling = !h.pickedUp && !["gather", "jumper", "layup", "dunk", "fadeaway", "floater", "hook", "pass", "freeThrow", "inbound"].includes(h.action.kind) && h.action.kind !== "post";
    b.mode = dribbling ? "dribble" : "held";
    if (dribbling) b.dribblePhase = (b.dribblePhase + dt * rate) % 1;
    const fx = Math.sin(h.facing), fz = Math.cos(h.facing);
    const sx = Math.cos(h.facing) * h.hand, sz = -Math.sin(h.facing) * h.hand;
    const hh = this.heightM(h);
    if (dribbling) {
      // ball height follows |sin| bounce between hand (~waist) and floor
      const hand = hh * 0.5;
      const ph = b.dribblePhase;
      const y = s.cfg.court.ballRadius + (hand - s.cfg.court.ballRadius) * Math.abs(Math.cos(ph * Math.PI));
      b.phys.pos = v3(h.pos.x + fx * 0.32 + sx * 0.3, y, h.pos.z + fz * 0.32 + sz * 0.3);
    } else {
      const k = h.action.kind;
      const y = k === "jumper" || k === "fadeaway" ? h.y + hh * (0.95 + 0.2 * clamp(h.action.t / Math.max(0.01, h.action.data.release as number), 0, 1)) : h.y + hh * 0.62;
      b.phys.pos = v3(h.pos.x + fx * 0.3, y, h.pos.z + fz * 0.3);
    }
    b.phys.vel = v3(h.vel.x, 0, h.vel.z);
  }

  private stepBallFlight(dt: number) {
    const s = this.state;
    this.ballEvents.length = 0;
    stepBall(s.ball.phys, s.cfg.court, dt, this.ballEvents);
    for (const e of this.ballEvents) {
      switch (e.type) {
        case "rim": this.emit({ t: "rimHit", speed: e.speed }); break;
        case "board": this.emit({ t: "boardHit", speed: e.speed }); break;
        case "floor":
          this.emit({ t: "floorBounce", speed: e.speed });
          if (s.ball.mode === "shot") this.shotMissed();
          break;
        case "net":
          if (s.ball.mode === "shot" && !s.ball.phys.touchedRim && !s.ball.phys.touchedBoard) this.emit({ t: "swish" });
          break;
        case "score":
          if (s.ball.mode === "shot" && s.ball.shot && e.side === s.ball.shot.side) this.shotMade();
          break;
        default: break;
      }
    }
    // shot fell away without scoring (descending well below rim & away)
    if (s.ball.mode === "shot" && s.ball.shot) {
      const rim = rimPos(s.cfg.court, s.ball.shot.side);
      const b = s.ball.phys;
      if (b.vel.y < 0 && b.pos.y < rim.y - 0.25 && Math.hypot(b.pos.x - rim.x, b.pos.z - rim.z) > s.cfg.court.rimRadius + 0.05) {
        this.shotMissed();
      }
    }
  }

  private checkGoaltend() {
    const s = this.state;
    const sh = s.ball.shot;
    if (!sh || s.ball.mode !== "shot") return;
    const b = s.ball.phys;
    const rim = rimPos(s.cfg.court, sh.side);
    if (b.vel.y >= 0 || b.pos.y < rim.y) return;
    if (Math.hypot(b.pos.x - rim.x, b.pos.z - rim.z) > s.cfg.court.rimRadius + 0.12) return;
    for (const o of this.agentsOf(sh.team === 0 ? 1 : 0)) {
      if (o.y <= 0.1) continue;
      const handH = o.y + this.reach(o);
      if (Math.abs(handH - b.pos.y) < 0.25 && Math.hypot(o.pos.x - b.pos.x, o.pos.z - b.pos.z) < 0.55 && this.rng.chance(0.03 * (1 - this.r(o, "iq") / 150))) {
        this.emit({ t: "violation", team: o.team, kind: "goaltending", player: o.idx });
        this.log(`Goaltending on ${this.name(o)}`, o.team);
        sh.willMake = true;
        this.shotMade(true);
        return;
      }
    }
  }

  private stepPass(dt: number) {
    const s = this.state;
    const p = s.ball.pass!;
    p.t += dt;
    const b = s.ball.phys;
    const prev = { x: b.pos.x, z: b.pos.z };
    this.stepBallFlight(dt);
    if (s.ball.mode !== "pass") return;
    // interceptions: each defender gets one chance when the ball passes within reach
    for (const o of this.agentsOf(s.ball.lastTouch === 0 ? 1 : 0)) {
      if (o.stun > 0 || p.rolled.includes(o.idx)) continue;
      const d = distToSeg2(prev, { x: b.pos.x, z: b.pos.z }, o.pos);
      const reachH = o.y + this.reach(o);
      if (d < 0.5 + this.r(o, "steal") * 0.003 && b.pos.y < reachH && b.pos.y > 0.25) {
        p.rolled.push(o.idx);
        const facing = Math.cos(angDiff(o.facing, Math.atan2(b.pos.x - o.pos.x, b.pos.z - o.pos.z)));
        const pr = 0.12 * (this.r(o, "steal") / 80) * s.cfg.sliders.stealSuccess * (p.kind === "lob" ? 0.5 : p.kind === "bounce" ? 0.8 : 1)
          * (0.4 + 0.6 * Math.max(0, facing)) * clamp(1.2 - d, 0.3, 1);
        if (this.rng.chance(pr)) {
          const passer = s.agents[p.from];
          if (this.rng.chance(0.6)) {
            this.giveBall(o);
            s.box[o.player.id].stl++;
            s.box[passer.player.id].tov++;
            this.emit({ t: "steal", player: o.idx, from: passer.idx });
            this.log(`${this.name(o)} picks off the pass`, o.team);
            this.changePossessionTracking(o.team);
          } else {
            // deflection
            b.vel = v3(this.rng.range(-3, 3), this.rng.range(0, 2), this.rng.range(-3, 3));
            s.ball.mode = "loose"; s.ball.looseCause = "deflect";
            s.ball.lastTouch = o.team;
            s.ball.lastToucher = o.idx;
          }
          return;
        }
      }
    }
    // catch
    if (p.to >= 0) {
      const r = s.agents[p.to];
      const d = Math.hypot(r.pos.x - b.pos.x, r.pos.z - b.pos.z);
      const catchTop = r.y + this.reach(r) + 0.25;
      const dSeg = distToSeg2(prev, { x: b.pos.x, z: b.pos.z }, r.pos);
      if (Math.min(d, dSeg) < 1.15 && b.pos.y < catchTop && b.pos.y > 0.15) {
        if (p.kind === "alley" && b.pos.y > s.cfg.court.rimHeight - 0.3 && r.y > 0.2) {
          // alley-oop finish
          this.giveBall(r);
          s.ball.lastPasser = p.from;
          s.ball.lastPassTime = s.time;
          this.beginShot(r, this.reach(r) + this.verticalLeap(r) > s.cfg.court.rimHeight + 0.1 ? "dunk" : "layup");
          r.action.data.release = r.action.t + 0.08;
          r.action.data.jumped = true;
          r.action.data.ideal = r.action.data.release;
          return;
        }
        // fumbles
        const fumble = clamp(0.03 - this.r(r, "hustle") * 0.0002, 0.002, 0.02);
        if (this.rng.chance(fumble)) {
          b.vel = v3(this.rng.range(-2, 2), 1, this.rng.range(-2, 2));
          s.ball.mode = "loose"; s.ball.looseCause = "fumble";
          s.ball.lastTouch = r.team;
          return;
        }
        this.giveBall(r);
        s.ball.lastPasser = p.from;
        s.ball.lastPassTime = s.time;
        r.pickedUp = false;
        if (s.phase === "inbound") this.inboundComplete();
        return;
      }
    }
    // pass sailed past
    if (p.t > p.dur + 0.6) {
      s.ball.mode = "loose"; s.ball.looseCause = "sailed";
    }
  }

  giveBall(a: Agent) {
    const s = this.state;
    const prevOwnerTeam = s.ball.lastTouch;
    s.ball.mode = "held";
    s.ball.owner = a.idx;
    s.ball.pass = null;
    s.ball.lastTouch = a.team;
    s.ball.lastToucher = a.idx;
    a.holdTime = 0;
    a.pickedUp = false;
    if (a.team !== s.offense) this.changePossessionTracking(a.team);
    if (s.phase === "inbound" && s.inbound && a.idx !== s.inbound.inbounder) this.inboundComplete();
    void prevOwnerTeam;
    // humans follow the ball on offense
    this.autoSwitchHuman(a.team);
  }

  autoSwitchHuman(team: TeamIdx) {
    const s = this.state;
    if (!s.teams[team].humanControlled || s.ball.owner === null) return;
    const humans = s.agents.filter((a) => a.team === team && a.human !== null);
    if (!humans.length) return;
    const owner = s.agents[s.ball.owner];
    if (owner.team !== team) return;
    if (humans.some((h) => h.idx === owner.idx)) return;
    const lock = (s as MatchState & { lockHuman?: boolean }).lockHuman;
    if (lock) return;
    // move controller 0 of this team to the ball handler
    const h = humans[0];
    owner.human = h.human;
    h.human = null;
  }

  private changePossessionTracking(newOffense: TeamIdx) {
    const s = this.state;
    if (s.offense !== newOffense) {
      s.offense = newOffense;
      s.frontcourt = false;
      s.backcourtTimer = 0;
      if (s.cfg.rules.shotClock) s.shotClock = s.cfg.rules.shotClock;
      s.possessions[newOffense]++;
      for (const a of s.agents) { a.laneTime = 0; a.pickedUp = false; }
      s.teams[0].playCall = null;
      s.teams[1].playCall = null;
      // defensive human controller moves to the nearest defender of the ball
      this.switchHumanToDefender(newOffense === 0 ? 1 : 0);
    }
  }

  switchHumanToDefender(team: TeamIdx) {
    const s = this.state;
    if (!s.teams[team].humanControlled) return;
    if ((s as MatchState & { lockHuman?: boolean }).lockHuman) return;
    const h = s.agents.find((a) => a.team === team && a.human !== null);
    if (!h) return;
    const bp = s.ball.phys.pos;
    let best = h, bd = 1e9;
    for (const a of this.agentsOf(team)) {
      const d = Math.hypot(a.pos.x - bp.x, a.pos.z - bp.z);
      if (d < bd) { bd = d; best = a; }
    }
    if (best !== h) { best.human = h.human; h.human = null; }
  }

  /** Manual switch to the defender closest to the ball (human pressed switch). */
  switchPlayer(humanIdx: number, toIdx?: number) {
    const s = this.state;
    const cur = s.agents.find((a) => a.human === humanIdx);
    if (!cur) return;
    let target: Agent | undefined;
    if (toIdx !== undefined) target = s.agents[toIdx];
    else {
      const bp = s.ball.phys.pos;
      const cands = this.agentsOf(cur.team).filter((a) => a !== cur && a.human === null);
      cands.sort((a, b) => Math.hypot(a.pos.x - bp.x, a.pos.z - bp.z) - Math.hypot(b.pos.x - bp.x, b.pos.z - bp.z));
      target = cands[0];
    }
    if (target && target.team === cur.team && target.human === null && s.ball.owner !== cur.idx) {
      target.human = humanIdx;
      cur.human = null;
    }
  }

  private tryLooseRecovery() {
    const s = this.state;
    const b = s.ball.phys;
    if (s.ball.mode !== "loose") return;
    const cands: { a: Agent; w: number }[] = [];
    for (const a of s.agents) {
      if (a.stun > 0.3 || a.action.kind === "fall") continue;
      const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
      const top = a.y + this.reach(a);
      if (d < 0.8 && b.pos.y < top && b.pos.y > 0) {
        const offensive = a.team === s.offense;
        const reb = this.r(a, offensive ? "offReb" : "defReb");
        const w = (reb / 70) * (1 / (0.25 + d)) * (b.pos.y > 2.2 ? (a.y > 0 ? 1.5 : 0.6) : 1) * (offensive ? 0.42 : 1.8);
        cands.push({ a, w });
      }
    }
    if (!cands.length) return;
    // probability someone secures it this tick
    const total = cands.reduce((x, c) => x + c.w, 0);
    if (!this.rng.chance(clamp(total * 0.12, 0.05, 0.9))) return;
    const winner = this.rng.weighted(cands.map((c) => c.a), cands.map((c) => c.w));
    // loose-ball foul in a crowded scrum
    if (s.cfg.fouls && cands.length >= 2 && this.rng.chance(0.045 * s.cfg.sliders.foulFrequency)) {
      const other = cands.find((c) => c.a.team !== winner.team);
      if (other) {
        this.foul(other.a, winner, "loose", false);
        return;
      }
    }
    const wasShot = s.ball.shot !== null || s.ball.phys.touchedRim || s.ball.phys.touchedBoard;
    const offensive = winner.team === s.ball.lastTouch && wasShot;
    const shotTeam = s.ball.lastTouch;
    if (wasShot) {
      const line = s.box[winner.player.id];
      const isOff = winner.team === shotTeam;
      if (isOff) line.oreb++; else line.dreb++;
      this.emit({ t: "rebound", player: winner.idx, offensive: isOff });
      if (this.rng.chance(0.35)) this.log(`${this.name(winner)} ${isOff ? "offensive" : "defensive"} rebound`, winner.team);
      if (isOff && s.cfg.rules.shotClock && s.ball.phys.touchedRim) {
        s.shotClock = Math.max(s.shotClock, s.cfg.league === "pro" ? 14 : s.cfg.league === "college" ? 20 : s.cfg.rules.shotClock);
      }
    }
    void offensive;
    s.ball.shot = null;
    s.ball.phys.touchedRim = false;
    s.ball.phys.touchedBoard = false;
    this.giveBall(winner);
  }

  private checkLooseOOB() {
    const s = this.state;
    const b = s.ball.phys;
    if (b.pos.y < s.cfg.court.ballRadius + 0.05 && !inBounds(s.cfg.court, b.pos.x, b.pos.z)) {
      const team = s.ball.lastTouch;
      const toucher = s.ball.lastToucher;
      const fromShot = s.ball.looseCause === "miss" || s.ball.looseCause === "block" || s.ball.phys.touchedRim;
      if (toucher !== null && team === s.offense && !fromShot) s.box[s.agents[toucher].player.id].tov++;
      this.violation(team, "outOfBounds", toucher);
    }
  }

  private looseBall(from: Agent, reason: TurnoverReason) {
    const s = this.state;
    s.ball.mode = "loose"; s.ball.looseCause = "lostBall";
    s.ball.owner = null;
    s.ball.lastTouch = from.team;
    s.ball.lastToucher = from.idx;
    const b = s.ball.phys;
    b.pos = v3(from.pos.x, 0.6, from.pos.z);
    b.vel = v3(this.rng.range(-2.5, 2.5), 1.2, this.rng.range(-2.5, 2.5));
    void reason;
  }

  // ---------------------------------------------------------------- scoring
  private shotMade(goaltend = false) {
    const s = this.state;
    const sh = s.ball.shot!;
    if (!sh) return;
    const shooter = s.agents[sh.shooter];
    const pts = sh.points;
    s.teams[sh.team].score += pts;
    const line = s.box[shooter.player.id];
    line.pts += pts;
    line.fgm++;
    line.fga++;
    if (pts === 3) { line.tpm++; line.tpa++; }
    if (sh.kind === "dunk") line.dunks++;
    if (sh.assistFrom !== null) s.box[s.agents[sh.assistFrom].player.id].ast++;
    this.addPlusMinus(sh.team, pts);
    shooter.heat = clamp(shooter.heat + 0.25, -1, 1);
    const dist = Math.hypot(sh.fromX - rimPos(s.cfg.court, sh.side).x, sh.fromZ);
    const swish = !s.ball.phys.touchedRim && !s.ball.phys.touchedBoard;
    this.emit({ t: "make", shooter: sh.shooter, kind: sh.kind, points: pts, assist: sh.assistFrom, andOne: sh.fouled, distance: dist, swish });
    this.log(`${this.name(shooter)} ${describeShot(sh.kind, pts, dist)}${sh.assistFrom !== null ? ` (assist ${this.name(sh.assistFrom)})` : ""}${goaltend ? " (goaltending)" : ""}`, sh.team);
    this.trackRun(sh.team, pts);
    s.lastScoreTime = s.time;
    if (s.cfg.practice) { s.ball.mode = "loose"; s.ball.shot = null; return; }
    s.ball.mode = "dead";
    if (sh.fouled) {
      s.ball.shot = null;
      this.awardFreeThrows(shooter, 1, false);
      return;
    }
    s.ball.shot = null;
    this.toDeadBall(sh.team === 0 ? 1 : 0, true);
  }

  private shotMissed() {
    const s = this.state;
    const sh = s.ball.shot;
    if (!sh) return;
    const shooter = s.agents[sh.shooter];
    shooter.heat = clamp(shooter.heat - 0.15, -1, 1);
    const dist = Math.hypot(sh.fromX - rimPos(s.cfg.court, sh.side).x, sh.fromZ);
    this.emit({ t: "miss", shooter: sh.shooter, kind: sh.kind, points: sh.points, distance: dist });
    if (!sh.fouled) {
      s.box[shooter.player.id].fga++;
      if (sh.points === 3) s.box[shooter.player.id].tpa++;
    }
    if (sh.fouled) {
      s.ball.shot = null;
      s.ball.mode = "dead";
      const def = this.nearestOpponent(shooter)!;
      this.foul(def, shooter, "shooting", true, sh.points);
      return;
    }
    // airball / brick → live rebound
    s.ball.mode = "loose"; s.ball.looseCause = "miss";
    s.ball.shot = null;
    if (s.cfg.rules.shotClock && !s.ball.phys.touchedRim) {
      // shot clock keeps running if the rim wasn't hit
    }
  }

  private addPlusMinus(team: TeamIdx, pts: number) {
    const s = this.state;
    for (const a of s.agents) s.box[a.player.id].plusMinus += a.team === team ? pts : -pts;
  }

  private trackRun(team: TeamIdx, pts: number) {
    const s = this.state;
    if (s.run.team === team) s.run.pts += pts;
    else s.run = { team, pts };
    this.emit({ t: "crowd", level: clamp(0.4 + pts * 0.15 + (s.run.pts > 7 ? 0.3 : 0), 0, 1) });
  }

  // ------------------------------------------------------------------ fouls
  foul(fouler: Agent, on: Agent, kind: FoulKind, shooting: boolean, shotPoints = 2) {
    const s = this.state;
    if (s.cfg.practice) return;
    const pfLine = s.box[fouler.player.id];
    pfLine.pf++;
    const defensive = fouler.team !== s.offense || kind === "shooting";
    const team = s.teams[fouler.team];
    if (kind !== "charge") team.fouls++;
    let fts = 0;
    if (kind === "charge") {
      s.box[fouler.player.id].tov++;
      this.emit({ t: "turnover", player: fouler.idx, reason: "offensiveFoul" });
    } else if (shooting) {
      fts = shotPoints;
    } else if (defensive && this.inBonus(fouler.team)) {
      fts = 2;
    }
    this.emit({ t: "foul", player: fouler.idx, on: on.idx, kind, shooting, fts });
    this.log(`Foul on ${this.name(fouler)} (${kind}${fts ? `, ${fts} FT` : ""})`, fouler.team);
    const s2 = s.ball.shot;
    if (s2 && s2.shooter === on.idx) s.ball.shot = null;
    // foul out
    if (pfLine.pf >= s.cfg.rules.foulOutLimit) {
      this.emit({ t: "foulOut", player: fouler.idx });
      this.log(`${this.name(fouler)} has fouled out`, fouler.team);
    }
    s.ball.mode = "dead";
    s.ball.owner = null;
    if (fts > 0) {
      const oneAndOne = !shooting && s.cfg.league === "college" && team.fouls < 10;
      this.awardFreeThrows(on, fts, oneAndOne && !shooting ? true : false);
    } else {
      // side out for the fouled team (or turnover on charge)
      const inbTeam = (kind === "charge" ? (fouler.team === 0 ? 1 : 0) : on.team) as TeamIdx;
      const reset = s.cfg.league === "pro" ? 14 : s.cfg.league === "college" ? 20 : 0;
      if (inbTeam === s.offense && s.cfg.rules.shotClock && reset && s.shotClock < reset) s.shotClock = reset;
      this.toDeadBall(inbTeam, false, { x: on.pos.x, z: on.pos.z });
    }
  }

  inBonus(foulingTeam: TeamIdx) {
    const s = this.state;
    return s.teams[foulingTeam].fouls >= (s.cfg.rules.bonusFouls);
  }

  private awardFreeThrows(shooter: Agent, total: number, oneAndOne: boolean) {
    const s = this.state;
    s.phase = "freethrows";
    s.freeThrows = { shooter: shooter.idx, team: shooter.team, total, made: 0, attempt: 1, oneAndOne, keepPossession: false };
    s.phaseTimer = s.cfg.fast ? 0.2 : 2.2;
    s.ball.mode = "dead";
    s.ball.owner = shooter.idx;
    this.lineUpForFreeThrows();
  }

  private lineUpForFreeThrows() {
    const s = this.state;
    const ft = s.freeThrows!;
    const c = s.cfg.court;
    const side = this.attackSide(ft.team);
    const spot = ftSpot(c, side);
    const shooter = s.agents[ft.shooter];
    shooter.pos = v2(spot.x - side * 0.25, spot.z);
    shooter.vel = v2();
    shooter.facing = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    shooter.action = act("freeThrow", 0, { ready: false });
    const lw = c.laneWidth / 2 + 0.45;
    const rim = rimPos(c, side);
    const laneSpots: V2[] = [];
    for (const k of [1.5, 2.6, 3.7]) {
      laneSpots.push(v2(rim.x - side * k + side * 0.4, lw), v2(rim.x - side * k + side * 0.4, -lw));
    }
    const defenders = this.agentsOf(ft.team === 0 ? 1 : 0);
    const offense = this.agentsOf(ft.team).filter((a) => a !== shooter);
    // defense gets the lowest two spots, then alternate
    const order = [...defenders.slice(0, 2), ...offense.slice(0, 2), ...defenders.slice(2, 3)];
    order.forEach((a, i) => { if (laneSpots[i]) { a.pos = { ...laneSpots[i] }; a.vel = v2(); a.facing = Math.atan2(rim.x - a.pos.x, -a.pos.z); } });
    // remaining players behind the arc / back for transition
    const rest = [...defenders.slice(3), ...offense.slice(2)];
    rest.forEach((a, i) => { a.pos = v2(spot.x - side * (2.5 + i * 1.5), (i % 2 ? 1 : -1) * 3.5); a.vel = v2(); });
    for (const a of s.agents) if (a !== shooter) a.action = act("idle");
    s.ball.phys.pos = v3(shooter.pos.x, 1.2, shooter.pos.z);
  }

  /** Free-throw stroke timing: the set point is reached at `ideal` seconds after the press. */
  static FT_IDEAL = 0.72;

  private startFreeThrowStroke(a: Agent, human: boolean) {
    a.action = act("freeThrow", 1.6, { started: true, start: this.state.time, ideal: Match.FT_IDEAL, release: Match.FT_IDEAL, releasedAt: -1, human });
  }

  private ftInput(phase: "press" | "release") {
    const s = this.state;
    const ft = s.freeThrows!;
    const a = s.agents[ft.shooter];
    if (a.action.kind !== "freeThrow") return;
    const d = a.action.data;
    if (phase === "press" && !d.started) {
      // pressing during the lineup or bounce routine is remembered, not lost
      if (s.phaseTimer > 0 || s.ball.mode !== "dead") d.queuedPress = true;
      else this.startFreeThrowStroke(a, true);
    } else if (phase === "release") {
      if (d.started && (d.releasedAt as number) < 0) d.releasedAt = a.action.t;
      else if (d.queuedPress) { d.queuedPress = false; d.queuedRelease = true; }
    }
  }

  private stepFreeThrows(dt: number) {
    const s = this.state;
    const ft = s.freeThrows!;
    const a = s.agents[ft.shooter];
    const c = s.cfg.court;
    if (s.ball.mode === "dead") {
      s.phaseTimer -= dt;
      const d = a.action.data;
      const fx = Math.sin(a.facing), fz = Math.cos(a.facing);
      const hh = this.heightM(a);
      // pre-shot routine: two bounces, then the ball comes up to the shooter's chest
      const routine = s.cfg.fast ? 0 : 1.3;
      const tr = routine - s.phaseTimer; // seconds into the routine
      if (!d.started && s.phaseTimer > 0 && s.phaseTimer < routine) {
        const ph = (tr / routine) * 2; // two bounces
        const y = s.cfg.court.ballRadius + (hh * 0.5 - s.cfg.court.ballRadius) * Math.abs(Math.cos(ph * Math.PI));
        s.ball.phys.pos = v3(a.pos.x + fx * 0.35 + Math.cos(a.facing) * -0.12, y, a.pos.z + fz * 0.35 - Math.sin(a.facing) * -0.12);
        d.routine = true;
        if (Math.abs(Math.cos(ph * Math.PI)) < 0.06 && !d[`b${Math.floor(ph)}`]) { d[`b${Math.floor(ph)}`] = true; this.emit({ t: "floorBounce", speed: 2 }); }
      } else {
        d.routine = false;
        s.ball.phys.pos = v3(a.pos.x + fx * 0.3, hh * 0.62, a.pos.z + fz * 0.3);
      }
      const humanShooter = a.human !== null && s.cfg.shotMeter && !s.cfg.fast;
      if (s.phaseTimer > 0) return;
      if (!d.started) {
        d.waiting = ((d.waiting as number) ?? 0) + dt;
        if (!humanShooter && (d.waiting as number) > 0.35) this.startFreeThrowStroke(a, false);
        else if (humanShooter && d.queuedPress) this.startFreeThrowStroke(a, true);
        else if (humanShooter && d.queuedRelease) { this.startFreeThrowStroke(a, true); a.action.data.releasedAt = Match.FT_IDEAL; }
        // watchdog: never wait forever at the line
        else if (humanShooter && (d.waiting as number) > 8) { this.startFreeThrowStroke(a, false); this.emit({ t: "crowd", level: 0.2 }); }
      }
      if (!a.action.data.started) return;
      // the ball rises with the shooting motion
      const k = Math.min(1, a.action.t / Match.FT_IDEAL);
      s.ball.phys.pos = v3(a.pos.x + fx * (0.3 - 0.08 * k), hh * (0.62 + 0.5 * k * k), a.pos.z + fz * (0.3 - 0.08 * k));
      const ideal = a.action.data.ideal as number;
      const rel = a.action.data.releasedAt as number;
      if (a.action.data.human && rel < 0 && a.action.t < ideal + 0.35) return;
      if (a.action.t < ideal) return;
      // shoot
      const q = a.action.data.human ? ((rel < 0 ? a.action.t : rel) - ideal) / 0.22 : NaN;
      const p = this.makeProbability(a, "freeThrow", 4.6, false, 0, a.action.data.human ? q : NaN);
      const make = this.rng.chance(p);
      const side = this.attackSide(ft.team);
      const rim = rimPos(c, side);
      const pos = v3(a.pos.x + Math.sin(a.facing) * 0.25, this.heightM(a) * 1.15, a.pos.z);
      let target = v3(rim.x, rim.y, rim.z);
      if (!make) {
        const off = this.rng.range(0.19, 0.27);
        const ang = this.rng.range(0, Math.PI * 2);
        target = v3(rim.x + Math.cos(ang) * off, rim.y, rim.z + Math.sin(ang) * off);
      }
      const spin = v3(0, 0, side * 16);
      const sol = aimAt(pos, target, (52 * Math.PI) / 180, spin) ?? solveArc(pos, target, 1.2);
      s.ball.phys.pos = pos;
      s.ball.phys.vel = sol.vel;
      s.ball.phys.spin = spin;
      s.ball.phys.aboveRim = {};
      s.ball.phys.touchedRim = false;
      s.ball.phys.touchedBoard = false;
      s.ball.mode = "ft";
      void make;
      s.ball.owner = null;
      a.action.data.shot = true;
      return;
    }
    // ball in flight: resolve on score / fall
    const ev = s.frameEvents;
    const made = ev.some((e) => e.t === "make") || this.ballEvents.some((e) => e.type === "score");
    const b = s.ball.phys;
    const rim = rimPos(c, this.attackSide(ft.team));
    const done = made || (b.vel.y < 0 && b.pos.y < rim.y - 0.3);
    if (!done) return;
    const line = s.box[a.player.id];
    line.fta++;
    if (made) {
      line.ftm++;
      line.pts++;
      s.teams[ft.team].score++;
      this.addPlusMinus(ft.team, 1);
      ft.made++;
      this.trackRun(ft.team, 1);
    }
    this.emit({ t: "freeThrow", shooter: a.idx, made, attempt: ft.attempt, total: ft.total });
    const last = ft.attempt >= ft.total || (ft.oneAndOne && !made && ft.attempt === 1);
    if (ft.oneAndOne && made && ft.attempt === 1) ft.total = 2;
    if (!last) {
      ft.attempt++;
      s.ball.mode = "dead";
      s.phaseTimer = s.cfg.fast ? 0.15 : 1.8;
      a.action = act("freeThrow", 0, { ready: false });
      return;
    }
    s.freeThrows = null;
    a.action = act("idle");
    if (made) {
      s.ball.mode = "dead";
      this.toDeadBall(ft.team === 0 ? 1 : 0, true);
    } else {
      // live rebound off the last miss
      s.ball.mode = "loose"; s.ball.looseCause = "ftMiss";
      s.ball.lastTouch = ft.team;
      s.ball.phys.touchedRim = true;
      s.phase = "live";
      for (const ag of s.agents) ag.action = act("idle");
    }
  }

  // ------------------------------------------------------------- violations
  private checkViolations(dt: number) {
    const s = this.state;
    const h = this.handler();
    const c = s.cfg.court;
    const off = s.offense;
    const side = this.attackSide(off);
    // three seconds
    for (const a of this.agentsOf(off)) {
      if (inLane(c, side, a.pos.x, a.pos.z) && s.ball.mode !== "shot" && s.ball.mode !== "loose") a.laneTime += dt;
      else a.laneTime = 0;
      if (a.laneTime > 3.0 && !(s.ball.owner === a.idx && this.isBusy(a))) {
        this.violation(off, "threeSeconds", a.idx);
        return;
      }
    }
    if (!h || h.team !== off) return;
    // half court
    const inFront = h.pos.x * side > 0;
    if (!s.frontcourt) {
      s.backcourtTimer += dt;
      if (inFront) s.frontcourt = true;
      const limit = s.cfg.rules.backcourtSeconds;
      if (s.backcourtTimer > limit && !inFront) {
        this.violation(off, limit === 8 ? "eightSeconds" : "tenSeconds", h.idx);
        return;
      }
    } else if (h.pos.x * side < -0.15 && h.y === 0 && s.ball.lastTouch === off) {
      this.violation(off, "backcourt", h.idx);
    }
  }

  private violation(team: TeamIdx, kind: ViolationKind, player: number | null) {
    const s = this.state;
    if (s.cfg.practice) return;
    if (s.phase !== "live" && s.phase !== "inbound") return;
    this.emit({ t: "violation", team, kind, player });
    const labels: Record<ViolationKind, string> = {
      shotClock: "Shot clock violation", threeSeconds: "Three seconds", backcourt: "Backcourt violation",
      tenSeconds: "10-second violation", eightSeconds: "8-second violation", fiveSeconds: "5-second violation",
      outOfBounds: "Out of bounds", travel: "Traveling", goaltending: "Goaltending", laneViolation: "Lane violation",
    };
    this.log(`${labels[kind]}${player !== null ? ` on ${this.name(player)}` : ""}`, team);
    if (player !== null && kind !== "outOfBounds" && team === s.offense) {
      s.box[s.agents[player].player.id].tov++;
      this.emit({ t: "turnover", player, reason: kind === "shotClock" ? "shotClock" : kind === "threeSeconds" ? "threeSeconds" : kind === "backcourt" ? "backcourt" : "tenSeconds" });
    }
    s.ball.mode = "dead";
    s.ball.owner = null;
    s.ball.shot = null;
    const b = s.ball.phys.pos;
    this.toDeadBall(team === 0 ? 1 : 0, false, { x: b.x, z: b.z });
  }

  private turnover(a: Agent, reason: TurnoverReason) {
    const s = this.state;
    s.box[a.player.id].tov++;
    this.emit({ t: "turnover", player: a.idx, reason });
  }

  // --------------------------------------------------------- dead / inbound
  private toDeadBall(nextOffense: TeamIdx, afterScore: boolean, at?: { x: number; z: number }) {
    const s = this.state;
    s.phase = "deadball";
    s.phaseTimer = s.cfg.fast ? 0.1 : afterScore ? 1.1 : 1.6;
    s.ball.mode = "dead";
    s.ball.owner = null;
    s.ball.pass = null;
    const c = s.cfg.court;
    const side = this.attackSide(nextOffense);
    let spot: V2;
    let backcourt = true;
    if (afterScore) {
      spot = v2(-side * (c.halfL + 0.5), this.rng.range(-1.5, 1.5));
    } else {
      const x = clamp(at?.x ?? 0, -c.halfL + 1, c.halfL - 1);
      const z = (at?.z ?? 0) >= 0 ? c.halfW + 0.5 : -c.halfW - 0.5;
      spot = v2(x, z);
      backcourt = x * side < 0;
    }
    s.inbound = { team: nextOffense, spot, inbounder: -1, timer: 0, afterScore, backcourt };
    this.changePossessionTracking(nextOffense);
    if (!afterScore && s.cfg.rules.shotClock && !backcourt) {
      // keep remaining shot clock on side outs for the same team; reset otherwise handled above
    }
    for (const a of s.agents) {
      if (a.action.kind === "fall" || a.action.kind === "celebrate") continue;
      a.action = act("idle");
    }
    this.considerSubsAndTimeouts();
  }

  private afterDeadBall() {
    const s = this.state;
    if (s.clock <= 0 && s.phase === "deadball") { this.endPeriod(); return; }
    const ib = s.inbound;
    if (!ib) { s.phase = "live"; return; }
    // choose inbounder: closest non-PG (or the C after scores)
    const team = this.agentsOf(ib.team);
    const byDist = [...team].sort((a, b) => dist2(a.pos, ib.spot) - dist2(b.pos, ib.spot));
    const inbounder = byDist.find((a) => a.role !== "ball") ?? byDist[0];
    ib.inbounder = inbounder.idx;
    inbounder.pos = { ...ib.spot };
    inbounder.vel = v2();
    const side = this.attackSide(ib.team);
    inbounder.facing = Math.atan2(-ib.spot.x, -ib.spot.z);
    void side;
    inbounder.action = act("inbound");
    s.ball.owner = inbounder.idx;
    s.ball.mode = "held";
    s.ball.lastTouch = ib.team;
    s.phase = "inbound";
    ib.timer = 0;
    // humans never control the inbounder (the AI inbounds); move control to another player
    if (inbounder.human !== null && !(s as MatchState & { lockHuman?: boolean }).lockHuman) {
      const other = team.find((a) => a !== inbounder && a.human === null && a.role === "ball") ?? team.find((a) => a !== inbounder && a.human === null);
      if (other) { other.human = inbounder.human; inbounder.human = null; }
    }
  }

  private stepInbound(dt: number) {
    const s = this.state;
    const ib = s.inbound!;
    ib.timer += dt;
    if (s.ball.mode === "pass" || s.ball.mode === "loose") {
      if (s.ball.mode === "pass") this.stepPass(dt);
      else { this.stepBallFlight(dt); this.tryLooseRecovery(); if (s.ball.owner !== null) this.inboundComplete(); this.checkLooseOOB(); }
      return;
    }
    if (ib.timer > 5 && s.ball.owner === ib.inbounder) {
      this.violation(ib.team, "fiveSeconds", ib.inbounder);
    }
  }

  private inboundComplete() {
    const s = this.state;
    const ib = s.inbound;
    if (ib) {
      const inbounder = s.agents[ib.inbounder];
      if (inbounder) inbounder.action = act("idle");
    }
    s.inbound = null;
    s.phase = "live";
    s.frontcourt = !(ib?.backcourt ?? true);
    s.backcourtTimer = 0;
  }

  // ------------------------------------------------ subs, timeouts, periods
  private considerSubsAndTimeouts() {
    const s = this.state;
    for (const ti of [0, 1] as TeamIdx[]) {
      const t = s.teams[ti];
      // AI timeouts: opponent on a 9-0 run, or late-game advance
      if (!t.humanControlled && t.timeouts > 0 && s.run.team !== ti && s.run.pts >= 9 && !s.cfg.fast) {
        s.run.pts = 0;
        this.callTimeout(ti);
      }
      if (!t.humanControlled || (t as TeamGameState & { autoSubs?: boolean }).autoSubs !== false) this.autoSubs(ti);
    }
  }

  callTimeout(ti: TeamIdx): boolean {
    const s = this.state;
    const t = s.teams[ti];
    if (t.timeouts <= 0) return false;
    if (s.phase === "live" && s.ball.owner !== null && s.agents[s.ball.owner].team !== ti) return false;
    if (s.phase === "live" && s.ball.owner === null) return false;
    t.timeouts--;
    this.emit({ t: "timeout", team: ti, remaining: t.timeouts });
    this.log(`Timeout ${t.team.name}`, ti);
    if (s.phase === "live") {
      const h = this.handler();
      this.toDeadBall(ti, false, h ? { x: h.pos.x, z: h.pos.z } : undefined);
    }
    s.phase = "timeout";
    s.timeoutTeam = ti;
    s.phaseTimer = s.cfg.fast ? 0.1 : 8;
    return true;
  }

  private resumeAfterBreak() {
    const s = this.state;
    if (s.phase === "periodEnd" || s.phase === "halftime") {
      this.startNextPeriod();
      return;
    }
    s.phase = "deadball";
    s.phaseTimer = 0.4;
  }

  private autoSubs(ti: TeamIdx) {
    const s = this.state;
    const t = s.teams[ti];
    const fouledOut = (id: string) => s.box[id].pf >= s.cfg.rules.foulOutLimit;
    const staminaOf = (p: Player) => {
      const ag = s.agents.find((a) => a.player.id === p.id);
      return ag ? ag.stamina : ((p as Player & { _stamina?: number })._stamina ?? 1);
    };
    const bench = t.roster.filter((p) => !t.onCourt.includes(p.id) && !fouledOut(p.id) && !p.injury);
    let changed = false;
    for (let slot = 0; slot < 5; slot++) {
      const pid = t.onCourt[slot];
      const p = t.roster.find((r) => r.id === pid)!;
      const st = staminaOf(p);
      const played = (t.minutes[pid] ?? 0) / 60;
      const target = t.rotation[pid] ?? 24;
      const periodLen = s.cfg.quarterMinutes;
      const scale = (periodLen * s.cfg.rules.periods) / 48;
      const overMinutes = played > target * scale * (s.period / s.cfg.rules.periods) + 3 * scale;
      const tired = st < 0.62;
      const late = s.period >= s.cfg.rules.periods && s.clock < 180 && Math.abs(s.teams[0].score - s.teams[1].score) < 12;
      if (!(fouledOut(pid) || ((tired || overMinutes) && !late))) continue;
      // best rested bench player at a compatible position
      const cands = bench.filter((b) => !t.onCourt.includes(b.id) && staminaOf(b) > 0.8)
        .sort((a, b) => posFit(b, p) * overall(b.ratings, b.pos) - posFit(a, p) * overall(a.ratings, a.pos));
      const sub = cands[0];
      if (!sub) continue;
      t.onCourt[slot] = sub.id;
      const ag = s.agents.find((a) => a.player.id === pid);
      if (ag) (p as Player & { _stamina?: number })._stamina = ag.stamina;
      this.emit({ t: "sub", team: ti, in: sub.id, out: pid });
      this.log(`${sub.firstName[0]}. ${sub.lastName} checks in for ${p.firstName[0]}. ${p.lastName}`, ti);
      changed = true;
    }
    if (changed) this.rebuildAgentsKeepPositions();
  }

  /** Manual substitution (from the pause menu). */
  substitute(ti: TeamIdx, outId: string, inId: string) {
    const s = this.state;
    const t = s.teams[ti];
    const slot = t.onCourt.indexOf(outId);
    if (slot < 0 || t.onCourt.includes(inId)) return false;
    t.onCourt[slot] = inId;
    this.emit({ t: "sub", team: ti, in: inId, out: outId });
    this.rebuildAgentsKeepPositions();
    return true;
  }

  private rebuildAgentsKeepPositions() {
    const s = this.state;
    const oldAgents = s.agents;
    const humanByTeam = [0, 1].map((ti) => oldAgents.find((a) => a.team === ti && a.human !== null)?.human ?? null);
    const pos = oldAgents.map((a) => ({ ...a.pos }));
    const ownerSlot = s.ball.owner;
    this.buildAgents();
    for (const a of s.agents) {
      const old = oldAgents.find((o) => o.player.id === a.player.id);
      if (!old) {
        a.pos = pos[a.idx];
        const st = (a.player as Player & { _stamina?: number })._stamina;
        a.stamina = st ?? 1;
        a.human = null;
      }
    }
    for (const ti of [0, 1] as TeamIdx[]) {
      const hv = humanByTeam[ti];
      if (hv !== null && !this.lockPlayerId && !s.agents.some((a) => a.team === ti && a.human !== null)) s.agents[ti * 5].human = hv;
    }
    s.ball.owner = ownerSlot;
  }

  private endPeriod() {
    const s = this.state;
    const regulation = s.cfg.rules.periods;
    s.teams.forEach((t) => t.periodScores.push(t.score - t.periodScores.reduce((a, b) => a + b, 0)));
    this.emit({ t: "buzzer", kind: "period" });
    this.emit({ t: "periodEnd", period: s.period });
    s.ball.mode = "dead";
    s.ball.owner = null;
    s.ball.shot = null;
    if (s.period >= regulation && s.teams[0].score !== s.teams[1].score) {
      s.phase = "final";
      s.winner = s.teams[0].score > s.teams[1].score ? 0 : 1;
      this.emit({ t: "final", winner: s.winner });
      this.log(`Final: ${s.teams[0].team.name} ${s.teams[0].score}, ${s.teams[1].team.name} ${s.teams[1].score}`, null);
      return;
    }
    const half = regulation === 2 ? s.period === 1 : s.period === 2;
    s.phase = half ? "halftime" : "periodEnd";
    s.phaseTimer = s.cfg.fast ? 0.1 : half ? 6 : 3;
    // recover stamina between periods
    for (const a of s.agents) a.stamina = Math.min(1, a.stamina + (half ? 0.35 : 0.12));
  }

  private startNextPeriod() {
    const s = this.state;
    const regulation = s.cfg.rules.periods;
    s.period++;
    const ot = s.period > regulation;
    s.clock = (ot ? s.cfg.rules.overtimeMinutes * (s.cfg.quarterMinutes / s.cfg.rules.quarterMinutes) : s.cfg.quarterMinutes) * 60;
    s.clock = Math.max(s.clock, 60);
    if (s.cfg.rules.shotClock) s.shotClock = s.cfg.rules.shotClock;
    const newHalf = regulation === 2 ? s.period === 2 : s.period === 3;
    if (newHalf) for (const t of s.teams) t.attackSide = (t.attackSide * -1) as 1 | -1;
    // team fouls reset per quarter (pro/hs) or half (college)
    if (regulation === 4 || newHalf || ot) for (const t of s.teams) t.fouls = 0;
    this.emit({ t: "periodStart", period: s.period });
    if (ot) {
      this.setupJumpBall();
      return;
    }
    // alternating possession
    const team = s.possessionArrow;
    s.possessionArrow = team === 0 ? 1 : 0;
    this.toDeadBall(team, false, { x: 0, z: 1 });
    s.inbound!.spot = v2(0, s.cfg.court.halfW + 0.5);
    s.inbound!.backcourt = true;
    s.phaseTimer = 0.5;
  }

  // ------------------------------------------------------------- utilities
  /** Positions an offense would like for spacing (attacking `side`). */
  spacingSpot(role: Agent["role"], side: 1 | -1, variant = 0): V2 {
    const c = this.state.cfg.court;
    const rim = rimPos(c, side);
    const R = c.threeRadius + 0.6;
    const at = (ang: number, r = R) => v2(rim.x - side * Math.cos(ang) * r, Math.sin(ang) * r);
    switch (role) {
      case "ball": return at(0);
      case "wing": return at(variant ? -1.0 : 1.0);
      case "slot": return at(variant ? 1.0 : -1.0);
      case "corner": return v2(rim.x - side * 0.6, (variant ? -1 : 1) * (c.halfW - 1.0));
      case "post": return v2(rim.x - side * 2.2, (variant ? 1 : -1) * (c.laneWidth / 2 + 1.0));
    }
  }

  /** Expected points of a shot taken by `a` right now (AI decision support). */
  shotValue(a: Agent): number {
    const s = this.state;
    const c = s.cfg.court;
    const side = this.attackSide(a.team);
    const dist = distToRim(c, side, a.pos.x, a.pos.z);
    const kind = this.shotKindFor(a);
    const three = kind === "jumper" && isThree(c, side, a.pos.x, a.pos.z);
    const contest = this.contestOn(a);
    const p = this.makeProbability(a, kind, dist, three, contest, NaN);
    return p * (three ? 3 : 2);
  }

  segT = segT2;
}

// ---------------------------------------------------------------------------

function act(kind: ActionKind, dur = 0, data: ActionState["data"] = {}): ActionState {
  return { kind, t: 0, dur, data };
}
type ActionState = import("./state").ActionState;

function newAgent(idx: number, team: TeamIdx, p: Player): Agent {
  return {
    idx, team, player: p, pos: v2(), vel: v2(), facing: 0, y: 0, vy: 0, action: act("idle"),
    stamina: (p as Player & { _stamina?: number })._stamina ?? 1, fatigueDebt: 0,
    intent: { moveX: 0, moveZ: 0, sprint: false }, laneTime: 0, guarding: null, human: null, hand: 1,
    holdTime: 0, pickedUp: false, stun: 0, heat: 0, role: "wing",
  };
}

const posRank = (p: string) => ["PG", "SG", "SF", "PF", "C"].indexOf(p);

function tallest(ags: Agent[]): Agent {
  return ags.reduce((a, b) => (b.player.heightIn + b.player.ratings.vertical * 0.05 > a.player.heightIn + a.player.ratings.vertical * 0.05 ? b : a));
}

export function pickStarters(roster: Player[]): string[] {
  const avail = roster.filter((p) => !p.injury);
  const chosen: Player[] = [];
  for (const pos of ["PG", "SG", "SF", "PF", "C"] as const) {
    const best = avail.filter((p) => !chosen.includes(p) && (p.pos === pos || p.secondaryPos === pos))
      .sort((a, b) => overall(b.ratings, pos) - overall(a.ratings, pos))[0];
    if (best) chosen.push(best);
  }
  for (const p of [...avail].sort((a, b) => overall(b.ratings, b.pos) - overall(a.ratings, a.pos))) {
    if (chosen.length >= 5) break;
    if (!chosen.includes(p)) chosen.push(p);
  }
  return chosen.slice(0, 5).map((p) => p.id);
}

function defaultRotation(roster: Player[], starters: string[], cfg: MatchConfig): Record<string, number> {
  const rot: Record<string, number> = {};
  const sorted = [...roster].sort((a, b) => overall(b.ratings, b.pos) - overall(a.ratings, a.pos));
  let benchRank = 0;
  for (const p of sorted) {
    if (starters.includes(p.id)) rot[p.id] = 33;
    else { rot[p.id] = [22, 18, 14, 10, 6, 0, 0, 0, 0, 0][benchRank] ?? 0; benchRank++; }
  }
  void cfg;
  return rot;
}

function posFit(candidate: Player, out: Player) {
  if (candidate.pos === out.pos) return 1.15;
  if (candidate.secondaryPos === out.pos || out.secondaryPos === candidate.pos) return 1.05;
  return Math.abs(posRank(candidate.pos) - posRank(out.pos)) <= 1 ? 0.95 : 0.75;
}

function describeShot(kind: ShotKind, pts: number, dist: number) {
  const ft = Math.round(dist / 0.3048);
  switch (kind) {
    case "dunk": return "throws it down";
    case "layup": return "finishes at the rim";
    case "floater": return `hits a ${ft}-foot floater`;
    case "hook": return "drops in a hook shot";
    case "fadeaway": return `buries a ${ft}-foot fadeaway`;
    default: return pts === 3 ? `drains a ${ft}-foot three` : `hits a ${ft}-foot jumper`;
  }
}
