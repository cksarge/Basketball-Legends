import { describe, expect, it } from "vitest";
import { playerOvr } from "@/engine/player";
import { newDraftState } from "../pro/draftClass";

const classes = Array.from({ length: 30 }, (_, i) => newDraftState(`c${i}`, 2027).prospects);
const mean = (n: number[]) => n.reduce((a, b) => a + b, 0) / n.length;

describe("draft classes", () => {
  it("has 70 unsigned prospects aged 19 to 22", () => {
    const c = classes[0];
    expect(c).toHaveLength(70);
    expect(c[3].id).toBe("draft-2027-3");
    for (const p of c) {
      expect(p.age).toBeGreaterThanOrEqual(19);
      expect(p.age).toBeLessThanOrEqual(22);
      expect(p.contract).toBeUndefined();
      expect(p.teamId).toBeNull();
    }
  });

  it("the top prospect averages 76-80 and the last 58-64", () => {
    const top = mean(classes.map((c) => playerOvr(c[0])));
    const last = mean(classes.map((c) => playerOvr(c[69])));
    expect(top).toBeGreaterThan(76);
    expect(top).toBeLessThan(80);
    expect(last).toBeGreaterThan(58);
    expect(last).toBeLessThan(64);
  });

  it("younger prospects carry more potential", () => {
    const all = classes.flat();
    const room = (age: number) => mean(all.filter((p) => p.age === age).map((p) => p.potential - playerOvr(p)));
    expect(room(19)).toBeGreaterThan(room(22) + 3);
  });

  it("the same seed and year give the same class, and the next year differs", () => {
    expect(newDraftState("c0", 2027)).toEqual(newDraftState("c0", 2027));
    expect(newDraftState("c0", 2028).prospects[0].lastName + newDraftState("c0", 2028).prospects[1].lastName).not.toBe(
      newDraftState("c0", 2027).prospects[0].lastName + newDraftState("c0", 2027).prospects[1].lastName,
    );
  });
});
