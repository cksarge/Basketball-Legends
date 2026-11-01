import { describe, expect, it } from "vitest";
import type { PendingMatch } from "@/state/matchStore";
import { isTouchOnly, withController } from "../touchOnly";

describe("the controller gate", () => {
  it("only stops devices with nothing but touch", () => {
    expect(isTouchOnly(true, false)).toBe(true);
    expect(isTouchOnly(true, true)).toBe(false); // a touchscreen laptop
    expect(isTouchOnly(false, true)).toBe(false);
    expect(isTouchOnly(false, false)).toBe(false);
  });

  it("hands the keyboard's spot to the controller, and leaves CPU sides alone", () => {
    const p = { home: { controllers: ["keyboard"] }, away: { controllers: [] } } as unknown as PendingMatch;
    const out = withController(p, 2);
    expect(out.home.controllers).toEqual(["pad2"]);
    expect(out.away.controllers).toEqual([]);
  });

  it("leaves a side that already uses a controller as it is", () => {
    const p = { home: { controllers: ["pad0"] }, away: { controllers: ["keyboard"] } } as unknown as PendingMatch;
    expect(withController(p, 1)).toMatchObject({ home: { controllers: ["pad0"] }, away: { controllers: ["pad1"] } });
  });
});
