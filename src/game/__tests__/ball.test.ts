import { describe, expect, it } from "vitest";
import { aimAt, newBallPhys, stepBall, type BallEvent } from "../ball";
import { courtFor, rimPos } from "../court";
import { v3 } from "../vec";

const c = courtFor("pro");
const rim = rimPos(c, 1);

function shoot(from: { x: number; z: number }, releaseH: number, angleDeg: number, aimOffset = { x: 0, z: 0 }) {
  const b = newBallPhys();
  b.pos = v3(from.x, releaseH, from.z);
  const spin = v3(0, 0, 0);
  const a = aimAt(b.pos, v3(rim.x + aimOffset.x, rim.y, rim.z + aimOffset.z), (angleDeg * Math.PI) / 180, spin)!;
  b.vel = a.vel;
  const events: BallEvent[] = [];
  for (let t = 0; t < 4; t += 1 / 60) stepBall(b, c, 1 / 60, events);
  return events;
}

describe("ball physics", () => {
  it("perfectly aimed jumpers go in from many spots", () => {
    const spots = [
      { x: rim.x - 4.5, z: 0 }, { x: rim.x - 6.5, z: 2 }, { x: rim.x - 1.5, z: -6.6 },
      { x: rim.x - 7.3, z: 0 }, { x: rim.x - 3, z: 3 }, { x: rim.x - 0.5, z: 1.2 },
    ];
    for (const s of spots) {
      const ev = shoot(s, 2.6, 50);
      expect(ev.some((e) => e.type === "score"), JSON.stringify(s)).toBe(true);
    }
  });
  it("badly aimed shots miss", () => {
    const ev = shoot({ x: rim.x - 6, z: 0 }, 2.6, 48, { x: 0.35, z: 0 });
    expect(ev.some((e) => e.type === "score")).toBe(false);
    expect(ev.some((e) => e.type === "rim" || e.type === "board")).toBe(true);
  });
  it("ball comes to rest on the floor", () => {
    const b = newBallPhys();
    b.pos = v3(0, 2, 0);
    for (let t = 0; t < 12; t += 1 / 60) stepBall(b, c, 1 / 60);
    expect(b.pos.y).toBeCloseTo(c.ballRadius, 2);
  });
});
