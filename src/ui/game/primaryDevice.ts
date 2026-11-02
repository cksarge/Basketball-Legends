/** The controller for your player: the first connected gamepad unless you're on the keyboard. */
export function primaryDevice(device: string): string {
  if (device === "keyboard" || typeof navigator === "undefined") return "keyboard";
  const pad = [...(navigator.getGamepads?.() ?? [])].find((p): p is Gamepad => !!p && p.connected);
  return pad ? `pad${pad.index}` : "keyboard";
}
