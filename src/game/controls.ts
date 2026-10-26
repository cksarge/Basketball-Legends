// Maps a ControllerFrame to the controlled agent's intent, based on game context.
import type { ControllerFrame } from "./input";
import type { Match } from "./sim/match";
import type { Agent, AgentIntent } from "./sim/state";
import { distToRim } from "./court";

export interface ControlContext {
  /** Camera yaw: world angle of the camera's forward direction projected on the floor. */
  camForwardX: number;
  camForwardZ: number;
}

export function frameToIntent(match: Match, agent: Agent, f: ControllerFrame, ctx: ControlContext): { intent: AgentIntent; meta: { switchPlayer?: boolean; callForBall?: boolean } } {
  const s = match.state;
  // screen -> world (camera relative)
  const fx = ctx.camForwardX, fz = ctx.camForwardZ;
  const rx = -fz, rz = fx; // right vector (perpendicular on the floor)
  const wx = rx * f.moveX + fx * f.moveY;
  const wz = rz * f.moveX + fz * f.moveY;
  const intent: AgentIntent = { moveX: wx, moveZ: wz, sprint: f.sprint };
  const meta: { switchPlayer?: boolean; callForBall?: boolean } = {};
  const hasBall = s.ball.owner === agent.idx;
  const onOffense = s.offense === agent.team && s.ball.mode !== "loose";
  const P = f.pressed, H = f.held, R = f.released;

  if (s.phase === "freethrows" && s.freeThrows?.shooter === agent.idx) {
    if (P.has("shoot")) intent.act = { type: "shoot", phase: "press" };
    else if (R.has("shoot")) intent.act = { type: "shoot", phase: "release" };
    intent.moveX = 0; intent.moveZ = 0;
    return { intent, meta };
  }

  if (hasBall) {
    // face the basket while standing still with the ball for a natural triple-threat stance
    if (Math.hypot(wx, wz) < 0.1) {
      const rim = match.rim(agent.team);
      intent.faceX = rim.x; intent.faceZ = rim.z;
    }
    if (P.has("shoot")) intent.act = { type: "shoot", phase: "press" };
    else if (R.has("shoot")) intent.act = { type: "shoot", phase: "release" };
    else if (f.iconTarget !== null) {
      const mates = match.agentsOf(agent.team);
      const target = mates[f.iconTarget];
      if (target && target !== agent) intent.act = { type: "pass", to: target.idx, kind: "chest" };
    } else if (P.has("pass") || P.has("bounce") || P.has("lob")) {
      const target = pickPassTarget(match, agent, wx, wz);
      if (target) {
        let kind: "chest" | "bounce" | "lob" | "alley" = P.has("bounce") ? "bounce" : P.has("lob") ? "lob" : "chest";
        if (kind === "lob" && distToRim(s.cfg.court, match.attackSide(agent.team), target.pos.x, target.pos.z) < 3 && match.reach(target) + match.verticalLeap(target) > s.cfg.court.rimHeight + 0.1) kind = "alley";
        intent.act = { type: "pass", to: target.idx, kind };
      }
    } else if (P.has("pumpFake")) intent.act = { type: "pumpFake" };
    else if (P.has("callScreen")) intent.act = { type: "callScreen" };
    else {
      const gesture = f.stickMove ?? (P.has("dribbleLeft") ? "left" : P.has("dribbleRight") ? "right" : P.has("dribbleBack") ? "back" : P.has("dribbleSpin") ? "spin" : null);
      if (gesture) {
        // left/right are screen-relative: convert to the player's own left/right
        const screenRightX = rx, screenRightZ = rz;
        const faceX = Math.sin(agent.facing), faceZ = Math.cos(agent.facing);
        const playerRightX = Math.cos(agent.facing), playerRightZ = -Math.sin(agent.facing);
        void faceX; void faceZ;
        const dot = screenRightX * playerRightX + screenRightZ * playerRightZ;
        if (gesture === "left" || gesture === "right") {
          const dir = (gesture === "right" ? 1 : -1) * (dot >= 0 ? 1 : -1);
          const move = H.has("sprint") ? "behindBack" : agent.hand === (dir > 0 ? -1 : 1) ? "crossover" : "betweenLegs";
          intent.act = { type: "dribbleMove", move, dir };
        } else if (gesture === "back") intent.act = { type: "dribbleMove", move: H.has("sprint") ? "hesitation" : "stepback", dir: 1 };
        else intent.act = { type: "dribbleMove", move: "spin", dir: agent.hand };
      }
    }
    if (H.has("post") && !intent.act) intent.act = agent.action.kind === "post" ? undefined : { type: "post", on: true };
    if (R.has("post")) intent.act = { type: "post", on: false };
  } else if (onOffense) {
    if (P.has("callForBall") || P.has("pass")) meta.callForBall = true;
    if (P.has("block")) intent.act = { type: "rebound" };
  } else {
    // defense or loose ball
    const ballLoose = s.ball.mode === "loose" || s.ball.mode === "shot";
    if (P.has("block")) intent.act = ballLoose ? { type: "rebound" } : { type: "block" };
    else if (P.has("steal")) intent.act = { type: "steal" };
    else if (P.has("takeCharge")) intent.act = { type: "takeCharge" };
    if (P.has("switchPlayer")) meta.switchPlayer = true;
    if (H.has("intenseD") && !intent.act && agent.action.kind !== "stance") {
      match.startAction(agent, "stance", 0);
    } else if (!H.has("intenseD") && agent.action.kind === "stance" && agent.action.dur === 0) {
      agent.action = { kind: "idle", t: 0, dur: 0, data: {} };
    }
    // intense D: face the ball handler
    if (H.has("intenseD")) {
      const h = match.handler();
      if (h) { intent.faceX = h.pos.x; intent.faceZ = h.pos.z; }
    }
  }
  return { intent, meta };
}

/** Teammate closest to the stick direction (or most open/closest if no direction). */
export function pickPassTarget(match: Match, from: Agent, dx: number, dz: number): Agent | null {
  const mates = match.agentsOf(from.team).filter((a) => a !== from);
  if (!mates.length) return null;
  const dl = Math.hypot(dx, dz);
  let best: Agent | null = null, bestScore = -Infinity;
  for (const m of mates) {
    const vx = m.pos.x - from.pos.x, vz = m.pos.z - from.pos.z;
    const d = Math.hypot(vx, vz) || 1;
    let score: number;
    if (dl > 0.2) {
      const cos = (vx * dx + vz * dz) / (d * dl);
      score = cos * 2 - d * 0.03;
    } else {
      const fx = Math.sin(from.facing), fz = Math.cos(from.facing);
      score = ((vx * fx + vz * fz) / d) * 0.5 - d * 0.06 + match.shotValue(m) * 0.6;
    }
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best;
}
