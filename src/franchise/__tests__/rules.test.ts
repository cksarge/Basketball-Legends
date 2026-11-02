import { describe, expect, it } from "vitest";
import { capRules, nextCap } from "../pro/rules";

describe("cap rules", () => {
  it("starts at the spec's numbers", () => {
    const r = capRules({ year: 2026, salaryCap: 140e6 });
    expect([r.taxLine, r.firstApron, r.secondApron, r.minSalary]).toEqual([170e6, 178e6, 189e6, 1.2e6]);
    expect([r.maxSalary(0), r.maxSalary(6), r.maxSalary(7), r.maxSalary(9), r.maxSalary(10)]).toEqual([35e6, 35e6, 42e6, 42e6, 49e6]);
  });

  it("scales every number with the cap", () => {
    const r = capRules({ year: 2030, salaryCap: 168e6 });
    expect(r.taxLine).toBe(204e6);
    expect(r.midLevel).toBeGreaterThan(capRules({ year: 2026, salaryCap: 140e6 }).midLevel);
  });

  it("raises the cap 3 to 6 percent a year, and the same seed repeats", () => {
    let cap = { year: 2026, salaryCap: 140e6 };
    for (let i = 0; i < 30; i++) {
      const next = nextCap(cap, "s");
      expect(next.year).toBe(cap.year + 1);
      expect(next.salaryCap / cap.salaryCap).toBeGreaterThanOrEqual(1.029);
      expect(next.salaryCap / cap.salaryCap).toBeLessThanOrEqual(1.061);
      expect(next).toEqual(nextCap(cap, "s"));
      cap = next;
    }
  });
});
