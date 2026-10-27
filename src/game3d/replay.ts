// Instant replays: the renderer records a compact snapshot of every sim step into a ring
// buffer, cuts highlight clips around big plays, and plays clips back through the same
// avatar/ball pipeline as live play (the simulation is paused while a replay runs).
import type { Match } from "@/game/sim/match";
import type { GameEvent } from "@/game/sim/events";
import type { ActionKind, BallMode, TeamIdx } from "@/game/sim/state";
import type { Player } from "@/engine/types";
import type { Official } from "@/game/sim/officials";

export interface AgentView {
  idx: number;
  team: TeamIdx;
  player: Player;
  pos: { x: number; z: number };
  vel: { x: number; z: number };
  facing: number;
  y: number;
  action: { kind: ActionKind; t: number; dur: number; data: Record<string, number | string | boolean | undefined> };
  hand: 1 | -1;
  stamina: number;
  human: number | null;
}

export interface ViewFrame {
  time: number;
  agents: AgentView[];
  ball: { pos: { x: number; y: number; z: number }; vel: { x: number; y: number; z: number }; mode: BallMode; owner: number | null; dribblePhase: number };
  offense: TeamIdx;
  phase: string;
  /** Rim x for each team's attacking basket at this moment. */
  rimX: [number, number];
  /** The officiating crew at this moment (if any). */
  officials?: Official[];
}

export interface Clip {
  id: number;
  label: string;
  /** Importance: 3+ is worth an automatic replay. */
  weight: number;
  frames: ViewFrame[];
  /** Index of the key moment (the make, block, ...). */
  keyIndex: number;
  /** Agent index to frame the camera on. */
  focus: number | null;
  team: TeamIdx | null;
  period: number;
  clock: number;
}

export type ReplayCam = "broadcast" | "baseline" | "orbit" | "courtside" | "rim";
export const REPLAY_CAMS: { id: ReplayCam; label: string }[] = [
  { id: "orbit", label: "Orbit" }, { id: "baseline", label: "Baseline" }, { id: "rim", label: "Above the rim" },
  { id: "courtside", label: "Courtside" }, { id: "broadcast", label: "Broadcast" },
];

export interface ReplayPlayback {
  clip: Clip;
  /** Playback position in frames (fractional). */
  t: number;
  speed: number;
  playing: boolean;
  cam: number;
  /** Automatic replays end by themselves and skip with any button. */
  auto: boolean;
  /** Queue of further clips (highlight reels). */
  queue: Clip[];
}

const BUFFER_SECONDS = 12;
const STEP = 1 / 60;
const MAX_HIGHLIGHTS = 16;

/** Live view straight off the match (no copies). */
export function liveView(match: Match): ViewFrame {
  const s = match.state;
  return {
    time: s.time,
    agents: s.agents,
    ball: { pos: s.ball.phys.pos, vel: s.ball.phys.vel, mode: s.ball.mode, owner: s.ball.owner, dribblePhase: s.ball.dribblePhase },
    offense: s.offense,
    phase: s.phase,
    rimX: [match.rim(0).x, match.rim(1).x],
    officials: s.crew?.refs,
  };
}

function snapshot(match: Match): ViewFrame {
  const s = match.state;
  return {
    time: s.time,
    agents: s.agents.map((a) => ({
      idx: a.idx, team: a.team, player: a.player, pos: { x: a.pos.x, z: a.pos.z }, vel: { x: a.vel.x, z: a.vel.z },
      facing: a.facing, y: a.y, action: { kind: a.action.kind, t: a.action.t, dur: a.action.dur, data: { ...a.action.data } },
      hand: a.hand, stamina: a.stamina, human: a.human,
    })),
    ball: {
      pos: { ...s.ball.phys.pos }, vel: { ...s.ball.phys.vel }, mode: s.ball.mode, owner: s.ball.owner, dribblePhase: s.ball.dribblePhase,
    },
    offense: s.offense,
    phase: s.phase,
    rimX: [match.rim(0).x, match.rim(1).x],
    officials: s.crew?.refs.map((o) => ({ ...o, pos: { ...o.pos }, vel: { ...o.vel }, queue: [] })),
  };
}

interface PendingCut { at: number; label: string; weight: number; focus: number | null; team: TeamIdx | null; period: number; clock: number }

export class ReplayDirector {
  private buf: ViewFrame[] = [];
  private pending: PendingCut[] = [];
  private nextId = 1;
  highlights: Clip[] = [];
  playback: ReplayPlayback | null = null;
  /** Set when a clip worth an automatic replay has just been cut. */
  autoCandidate: Clip | null = null;
  private lastAutoAt = -999;
  private listeners = new Set<() => void>();

  constructor(private match: Match) {}

  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  /** Bumped on every change so UI can subscribe cheaply. */
  version = 0;
  private notify() { this.version++; for (const fn of this.listeners) fn(); }

  /** Call after every sim step. */
  record() {
    const s = this.match.state;
    if (s.phase === "final" && this.buf.length && this.buf[this.buf.length - 1].phase === "final") return;
    this.buf.push(snapshot(this.match));
    const max = Math.round(BUFFER_SECONDS / STEP);
    if (this.buf.length > max) this.buf.splice(0, this.buf.length - max);
    // cut clips once enough follow-up has been recorded
    const now = s.time;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (now >= p.at + 1.6 || s.phase === "final") {
        this.pending.splice(i, 1);
        const clip = this.cut(p);
        if (clip) this.addHighlight(clip);
      }
    }
  }

  /** Watch game events for plays worth keeping. */
  observe(events: GameEvent[]) {
    const s = this.match.state;
    const late = s.period >= s.cfg.rules.periods && s.clock < 30 && Math.abs(s.teams[0].score - s.teams[1].score) <= 3;
    const nm = (i: number | null) => (i !== null && s.agents[i] ? `${s.agents[i].player.firstName[0]}. ${s.agents[i].player.lastName}` : "");
    for (const e of events) {
      let label = "", weight = 0, focus: number | null = null;
      switch (e.t) {
        case "make":
          focus = e.shooter;
          if (e.kind === "dunk") { label = `${nm(e.shooter)} slam`; weight = e.andOne ? 4 : 3; }
          else if (e.points === 3) { label = `${nm(e.shooter)} from deep`; weight = late ? 4 : e.andOne ? 3 : 2; }
          else { label = `${nm(e.shooter)} scores`; weight = e.andOne ? 3 : late ? 3 : 1; }
          if (e.andOne) label += ", and one";
          if (s.clock <= 1 && s.period >= 1) { label = `${nm(e.shooter)} at the buzzer`; weight = 5; }
          break;
        case "block": focus = e.blocker; label = `${nm(e.blocker)} rejection`; weight = 3; break;
        case "steal": focus = e.player; label = `${nm(e.player)} steal`; weight = 1; break;
        case "dribbleMove": if (e.broke !== null) { focus = e.player; label = `${nm(e.player)} breaks ankles`; weight = 3; } break;
        default: break;
      }
      if (!weight || !s.agents[focus ?? 0]) continue;
      const team = focus !== null ? s.agents[focus].team : null;
      this.pending.push({ at: s.time, label, weight, focus, team, period: s.period, clock: s.clock });
    }
  }

  private cut(p: PendingCut): Clip | null {
    const from = this.buf.findIndex((f) => f.time >= p.at - 4.2);
    if (from < 0) return null;
    const frames = this.buf.slice(from).filter((f) => f.time <= p.at + 1.6);
    if (frames.length < 30) return null;
    const keyIndex = Math.max(0, frames.findIndex((f) => f.time >= p.at));
    // follow the player by id (agent slots can shift after substitutions)
    return { id: this.nextId++, label: p.label, weight: p.weight, frames, keyIndex, focus: p.focus, team: p.team, period: p.period, clock: p.clock };
  }

  private addHighlight(clip: Clip) {
    this.highlights.push(clip);
    if (this.highlights.length > MAX_HIGHLIGHTS) {
      // drop the least important (oldest first among ties)
      let worst = 0;
      for (let i = 1; i < this.highlights.length; i++) if (this.highlights[i].weight < this.highlights[worst].weight) worst = i;
      this.highlights.splice(worst, 1);
    }
    const realNow = performance.now() / 1000;
    if (clip.weight >= 3 && realNow - this.lastAutoAt > 40) this.autoCandidate = clip;
    this.notify();
  }

  /** The last few seconds as a clip (manual replay). */
  recentClip(): Clip | null {
    if (this.buf.length < 30) return null;
    const frames = this.buf.slice();
    return { id: this.nextId++, label: "Instant replay", weight: 0, frames, keyIndex: frames.length - 1, focus: null, team: null, period: this.match.state.period, clock: this.match.state.clock };
  }

  play(clip: Clip, opts: { auto?: boolean; queue?: Clip[]; fromStart?: boolean } = {}) {
    if (opts.auto) this.lastAutoAt = performance.now() / 1000;
    const startAt = opts.auto || opts.fromStart ? Math.max(0, clip.keyIndex - Math.round(2.6 / STEP)) : 0;
    this.playback = {
      clip, t: startAt, speed: opts.auto ? 0.6 : 1, playing: true,
      cam: clip.focus !== null ? 0 : 4, auto: !!opts.auto, queue: opts.queue ?? [],
    };
    this.autoCandidate = null;
    this.notify();
  }

  /** Play every highlight in order (halftime / postgame reels). */
  playReel(clips = this.highlights) {
    if (!clips.length) return;
    const [first, ...rest] = [...clips];
    this.play(first, { fromStart: true, queue: rest });
    if (this.playback) this.playback.speed = 0.8;
  }

  stop() {
    this.playback = null;
    this.notify();
  }

  /** Advance playback; returns the frame to draw, or null when finished. */
  advance(dt: number): ViewFrame | null {
    const pb = this.playback;
    if (!pb) return null;
    if (pb.playing) pb.t += (dt / STEP) * pb.speed;
    const last = pb.clip.frames.length - 1;
    if (pb.t >= last) {
      if (pb.queue.length) {
        const [next, ...rest] = pb.queue;
        const speed = pb.speed;
        this.play(next, { fromStart: true, queue: rest });
        this.playback!.speed = speed;
        return this.frameAt(this.playback!);
      }
      if (pb.auto) { this.stop(); return null; }
      pb.t = last;
      pb.playing = false;
      this.notify();
    }
    if (pb.t < 0) pb.t = 0;
    return this.frameAt(pb);
  }

  current(): ViewFrame | null {
    return this.playback ? this.frameAt(this.playback) : null;
  }

  private frameAt(pb: ReplayPlayback): ViewFrame {
    const f = pb.clip.frames;
    return f[Math.min(f.length - 1, Math.max(0, Math.floor(pb.t)))];
  }

  setPlaying(on: boolean) { if (this.playback) { this.playback.playing = on; if (on && this.playback.t >= this.playback.clip.frames.length - 1) this.playback.t = 0; this.notify(); } }
  scrub(seconds: number) { if (this.playback) { this.playback.t = Math.max(0, Math.min(this.playback.clip.frames.length - 1, this.playback.t + seconds / STEP)); this.notify(); } }
  setSpeed(speed: number) { if (this.playback) { this.playback.speed = speed; this.notify(); } }
  cycleCam(dir = 1) { if (this.playback) { this.playback.cam = (this.playback.cam + dir + REPLAY_CAMS.length) % REPLAY_CAMS.length; this.notify(); } }
  progress() { const pb = this.playback; return pb ? pb.t / Math.max(1, pb.clip.frames.length - 1) : 0; }
}
