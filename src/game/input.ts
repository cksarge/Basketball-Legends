// In-game input: keyboard + gamepads -> per-controller frames (edge-triggered actions).
import type { ActionName } from "@/state/settings";

export type DeviceId = "keyboard" | `pad${number}`;

export interface ControllerFrame {
  moveX: number; // screen-space -1..1 (right +)
  moveY: number; // screen-space -1..1 (up/away +)
  sprint: boolean;
  held: Set<ActionName>;
  pressed: Set<ActionName>;
  released: Set<ActionName>;
  /** Icon-pass target slot (0..4) if a number was pressed while icon pass is held. */
  iconTarget: number | null;
  /** Right-stick dribble gesture this frame. */
  stickMove: "left" | "right" | "back" | "spin" | null;
  device: DeviceId;
}

export interface Bindings {
  keys: Record<ActionName, string[]>;
  pad: Record<ActionName, number[]>;
  deadzone: number;
}

const ACTIONS: ActionName[] = [
  "up",
  "down",
  "left",
  "right",
  "sprint",
  "shoot",
  "pass",
  "lob",
  "bounce",
  "iconPass",
  "dribbleLeft",
  "dribbleRight",
  "dribbleBack",
  "dribbleSpin",
  "pumpFake",
  "post",
  "callScreen",
  "steal",
  "block",
  "switchPlayer",
  "intenseD",
  "takeCharge",
  "timeout",
  "pause",
  "camera",
  "replay",
  "callForBall",
];

export class InputManager {
  private keys = new Set<string>();
  private prevHeld = new Map<DeviceId, Set<ActionName>>();
  private numberPressed: number | null = null;
  private stickPrev = new Map<DeviceId, string | null>();
  bindings: Bindings;
  enabled = true;

  constructor(bindings: Bindings) {
    this.bindings = bindings;
  }

  attach() {
    window.addEventListener("keydown", this.onDown);
    window.addEventListener("keyup", this.onUp);
    window.addEventListener("blur", this.onBlur);
  }

  detach() {
    window.removeEventListener("keydown", this.onDown);
    window.removeEventListener("keyup", this.onUp);
    window.removeEventListener("blur", this.onBlur);
  }

  private onDown = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
    if (/^Digit[1-5]$/.test(e.code)) this.numberPressed = Number(e.code.slice(5)) - 1;
    // stop the browser scrolling / tabbing during gameplay
    if (["Space", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    this.keys.add(e.code);
    this.tapped.add(e.code);
  };
  /** Keys pressed since the last keyboard read: a tap shorter than a frame still counts once. */
  private tapped = new Set<string>();
  private onUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
  private onBlur = () => {
    this.keys.clear();
  };

  /** Gamepads currently connected (indexes). */
  connectedPads(): number[] {
    const pads = navigator.getGamepads?.() ?? [];
    return [...pads].filter((p): p is Gamepad => !!p && p.connected).map((p) => p.index);
  }

  /** Read one frame for a device. */
  read(device: DeviceId): ControllerFrame {
    const held = new Set<ActionName>();
    let mx = 0,
      my = 0,
      stickMove: ControllerFrame["stickMove"] = null;
    if (device === "keyboard") {
      for (const a of ACTIONS) if (this.bindings.keys[a]?.some((k) => this.keys.has(k) || this.tapped.has(k))) held.add(a);
      this.tapped.clear();
      mx = (held.has("right") ? 1 : 0) - (held.has("left") ? 1 : 0);
      my = (held.has("up") ? 1 : 0) - (held.has("down") ? 1 : 0);
      const l = Math.hypot(mx, my);
      if (l > 1) {
        mx /= l;
        my /= l;
      }
    } else {
      const idx = Number(device.slice(3));
      const pad = navigator.getGamepads?.()[idx];
      if (pad && pad.connected) {
        for (const a of ACTIONS) if (this.bindings.pad[a]?.some((b) => pad.buttons[b]?.pressed || (pad.buttons[b]?.value ?? 0) > 0.5)) held.add(a);
        const dz = this.bindings.deadzone;
        const ax = pad.axes[0] ?? 0,
          ay = pad.axes[1] ?? 0;
        const m = Math.hypot(ax, ay);
        if (m > dz) {
          const k = Math.min(1, (m - dz) / (1 - dz)) / m;
          mx = ax * k;
          my = -ay * k;
        }
        if (held.has("up")) my = 1;
        if (held.has("down")) my = -1;
        if (held.has("left")) mx = -1;
        if (held.has("right")) mx = 1;
        // right stick gestures -> dribble moves
        const rx = pad.axes[2] ?? 0,
          ry = pad.axes[3] ?? 0;
        let g: string | null = null;
        if (Math.hypot(rx, ry) > 0.7) g = Math.abs(rx) > Math.abs(ry) ? (rx > 0 ? "right" : "left") : ry > 0 ? "back" : "spin";
        const prevG = this.stickPrev.get(device) ?? null;
        if (g && g !== prevG) stickMove = g as ControllerFrame["stickMove"];
        this.stickPrev.set(device, g);
      }
    }
    const prev = this.prevHeld.get(device) ?? new Set<ActionName>();
    const pressed = new Set<ActionName>([...held].filter((a) => !prev.has(a)));
    const released = new Set<ActionName>([...prev].filter((a) => !held.has(a)));
    this.prevHeld.set(device, held);
    let iconTarget: number | null = null;
    if (device === "keyboard" && this.numberPressed !== null) {
      iconTarget = this.numberPressed;
      this.numberPressed = null;
    } else if (device !== "keyboard" && held.has("iconPass")) {
      // face buttons pick teammates while icon pass is held: A,B,X,Y,RB
      const map: [ActionName, number][] = [
        ["pass", 0],
        ["bounce", 1],
        ["shoot", 2],
        ["lob", 3],
        ["callScreen", 4],
      ];
      for (const [a, slot] of map) if (pressed.has(a)) iconTarget = slot;
    }
    return { moveX: mx, moveY: my, sprint: held.has("sprint"), held, pressed, released, iconTarget, stickMove, device };
  }

  rumble(device: DeviceId, strong: number, weak: number, ms: number) {
    if (device === "keyboard") return;
    const pad = navigator.getGamepads?.()[Number(device.slice(3))] as
      (Gamepad & { vibrationActuator?: { playEffect: (t: string, p: object) => Promise<unknown> } }) | null;
    pad?.vibrationActuator?.playEffect("dual-rumble", { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => undefined);
  }
}
