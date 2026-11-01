// The game has no touch controls: a phone or tablet needs a controller or a keyboard to play.
import type { PendingMatch } from "@/state/matchStore";

/** Touch is the only way in: the main pointer is a finger and no mouse or trackpad is attached. */
export const isTouchOnly = (coarse: boolean, anyFine: boolean) => coarse && !anyFine;

/** A connected controller takes over the keyboard's spot, so it really does control the game. */
export function withController(p: PendingMatch, pad: number): PendingMatch {
  const swap = (list: string[]) => list.map((d) => (d === "keyboard" ? `pad${pad}` : d));
  return { ...p, home: { ...p.home, controllers: swap(p.home.controllers) }, away: { ...p.away, controllers: swap(p.away.controllers) } };
}
