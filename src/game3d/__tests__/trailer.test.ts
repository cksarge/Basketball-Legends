import { describe, expect, it } from "vitest";
import { HALFCOURT, LOOP, PARK_SHOT, SHOTS, ballArc, cameraFor, dribbleHeight, fadeAt, shotAt, type Vec3 } from "../trailer/timeline";

const rim: Vec3 = [12.75, 3.05, 0];

describe("the menu trailer", () => {
  it("opens on a game in progress and ends on the Legend, the same way every time", () => {
    expect(SHOTS[0].id).toBe("break");
    expect(SHOTS.at(-1)!.id).toBe("legend");
    expect(SHOTS.map((s) => s.id)).toEqual(["break", "dunk", "interview", "park", "halfcourt", "legend"]);
    expect(shotAt(12.34)).toEqual(shotAt(12.34));
  });

  it("walks through every shot, then loops", () => {
    let at = 0;
    for (const [i, s] of SHOTS.entries()) {
      expect(shotAt(at + 0.01).index).toBe(i);
      expect(shotAt(at + s.duration - 0.01).index).toBe(i);
      at += s.duration;
    }
    expect(at).toBe(LOOP);
    expect(shotAt(LOOP + 1).index).toBe(0);
  });

  it("every shot gets time to breathe", () => {
    for (const s of SHOTS) expect(s.duration).toBeGreaterThanOrEqual(4);
  });

  it("fades through black at each cut and stays clear in between", () => {
    expect(fadeAt(0, 5)).toBe(1);
    expect(fadeAt(5, 5)).toBe(1);
    expect(fadeAt(2.5, 5)).toBe(0);
  });

  it("drops both long shots through the rim", () => {
    const park = ballArc([6.5, 2.3, 1.8], rim, 6, 1);
    expect(park).toEqual(rim);
    const half = ballArc([0.35, 2.4, 0], rim, HALFCOURT.apex, 1);
    expect(half).toEqual(rim);
    expect(ballArc([0.35, 2.4, 0], rim, HALFCOURT.apex, 0.5)[1]).toBeCloseTo(HALFCOURT.apex + (2.4 + 3.05) / 2 - 3.05, 1);
    expect(PARK_SHOT.flight).toBeGreaterThan(1);
    expect(HALFCOURT.release + HALFCOURT.flight).toBeLessThan(SHOTS[4].duration);
  });

  it("keeps the dribble between the floor and the hand", () => {
    for (let t = 0; t < 4; t += 0.07) {
      expect(dribbleHeight(t)).toBeGreaterThan(0.1);
      expect(dribbleHeight(t)).toBeLessThan(1);
    }
  });

  it("never puts the camera through the floor, at any moment", () => {
    for (const s of SHOTS)
      for (let t = 0; t < s.duration; t += 0.1) {
        const ball: Vec3 = s.id === "halfcourt" ? ballArc([0.35, 2.4, 0], rim, HALFCOURT.apex, (t - HALFCOURT.release) / HALFCOURT.flight) : [0, 1, 0];
        const c = cameraFor(s.id, t, rim, [0, 0, 0], ball);
        expect(c.pos[1]).toBeGreaterThan(0.3);
        expect(c.pos.every(Number.isFinite)).toBe(true);
        expect(c.fov).toBeGreaterThan(15);
      }
  });
});
