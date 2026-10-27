import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputManager } from "../input";
import { DEFAULT_KEYS, DEFAULT_PAD } from "@/state/settings";

// A standard-mapping gamepad we can poke between reads.
const pad = {
  id: "Test pad (STANDARD GAMEPAD)", index: 0, connected: true, mapping: "standard", timestamp: 0,
  axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
};
const press = (b: number, on: boolean) => { pad.buttons[b] = { pressed: on, touched: on, value: on ? 1 : 0 }; };

describe("gamepad input", () => {
  let input: InputManager;
  beforeEach(() => {
    vi.stubGlobal("navigator", { getGamepads: () => [pad, null, null, null] });
    pad.axes = [0, 0, 0, 0];
    pad.buttons.forEach((_, i) => press(i, false));
    input = new InputManager({ keys: DEFAULT_KEYS, pad: DEFAULT_PAD, deadzone: 0.18 });
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it("moves with the left stick and ignores drift inside the deadzone", () => {
    pad.axes = [0.1, -0.1, 0, 0];
    let f = input.read("pad0");
    expect(f.moveX).toBe(0);
    pad.axes = [1, 0, 0, 0];
    f = input.read("pad0");
    expect(f.moveX).toBeCloseTo(1, 2);
    pad.axes = [0, -1, 0, 0]; // stick up is negative Y on the Gamepad API
    f = input.read("pad0");
    expect(f.moveY).toBeCloseTo(1, 2);
  });

  it("reports button presses once, then holds and releases", () => {
    press(DEFAULT_PAD.shoot[0], true);
    let f = input.read("pad0");
    expect(f.pressed.has("shoot")).toBe(true);
    f = input.read("pad0");
    expect(f.pressed.has("shoot")).toBe(false);
    expect(f.held.has("shoot")).toBe(true);
    press(DEFAULT_PAD.shoot[0], false);
    f = input.read("pad0");
    expect(f.released.has("shoot")).toBe(true);
  });

  it("turns right-stick flicks into dribble moves and maps the d-pad", () => {
    pad.axes = [0, 0, 1, 0];
    expect(input.read("pad0").stickMove).toBe("right");
    expect(input.read("pad0").stickMove).toBe(null); // held, not re-triggered
    pad.axes = [0, 0, 0, 0];
    input.read("pad0");
    pad.axes = [0, 0, 0, -1];
    expect(input.read("pad0").stickMove).toBe("spin");
    pad.axes = [0, 0, 0, 0];
    press(14, true); // d-pad left
    expect(input.read("pad0").moveX).toBe(-1);
  });

  it("picks icon-pass targets with face buttons while LB is held", () => {
    press(DEFAULT_PAD.iconPass[0], true);
    input.read("pad0");
    press(3, true); // Y -> slot 3
    expect(input.read("pad0").iconTarget).toBe(3);
  });

  it("reads nothing from a missing controller", () => {
    const f = input.read("pad2");
    expect(f.moveX).toBe(0);
    expect(f.held.size).toBe(0);
  });
});
