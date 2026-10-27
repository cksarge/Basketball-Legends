"use client";
import { useSettings, type ActionName } from "@/state/settings";
import type { InputDevice } from "./MenuNavigator";

const XBOX = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "View", "Menu", "LS", "RS", "↑", "↓", "←", "→"];
const PS = ["✕", "○", "□", "△", "L1", "R1", "L2", "R2", "Create", "Options", "L3", "R3", "↑", "↓", "←", "→"];

export function keyLabel(code: string) {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  const map: Record<string, string> = {
    Space: "Space",
    ShiftLeft: "Shift",
    ShiftRight: "Shift",
    Escape: "Esc",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    Tab: "Tab",
    Enter: "Enter",
  };
  return map[code] ?? code;
}

/** Shows the bound key or button for an action, in the current device's style. */
export function KeyHint({ action, device }: { action: ActionName; device: InputDevice }) {
  const keys = useSettings((s) => s.controls.keys[action]);
  const pad = useSettings((s) => s.controls.pad[action]);
  let label = "";
  if (device === "keyboard") label = keys?.[0] ? keyLabel(keys[0]) : "-";
  else {
    const names = device === "playstation" ? PS : XBOX;
    label = pad?.[0] !== undefined ? (names[pad[0]] ?? `B${pad[0]}`) : action.startsWith("dribble") ? "RS" : "-";
  }
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded border border-line bg-deck px-1.5 py-0.5 font-body text-[11px] font-semibold text-net">
      {label}
    </kbd>
  );
}
