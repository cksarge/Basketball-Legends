// Default minutes for a roster: the best healthy players play most.
import { playerOvr } from "@/engine/player";
import type { Player } from "@/engine/types";

/** Minutes by depth in a 240-minute game. */
const TEMPLATE = [36, 34, 33, 32, 30, 22, 18, 15, 12, 8];
const FULL_TEAM = 5;

/** Player id -> minutes, best first, adding up to totalMinutes. Hurt players sit unless fewer than 5 can play. */
export function defaultRotation(roster: Player[], totalMinutes: number): Record<string, number> {
  const hurt = (p: Player) => p.injury?.gamesOut ?? 0;
  const best = (a: Player, b: Player) => playerOvr(b) - playerOvr(a);
  const healthy = roster.filter((p) => !hurt(p)).sort(best);
  // an emergency: the least hurt players suit up
  const callUps = [...roster.filter(hurt)].sort((a, b) => hurt(a) - hurt(b) || best(a, b)).slice(0, Math.max(0, FULL_TEAM - healthy.length));
  const players = [...healthy, ...callUps].slice(0, TEMPLATE.length);
  const weights = players.map((_, i) => TEMPLATE[i]);
  const cap = totalMinutes / FULL_TEAM;
  const minutes = weights.map(() => 0);
  let left = totalMinutes;
  // hand out minutes by weight, spilling anything over the cap to the players below it
  while (left > 0) {
    const open = players.map((_, i) => i).filter((i) => minutes[i] < cap);
    const weight = open.reduce((sum, i) => sum + weights[i], 0);
    let given = 0;
    for (const i of open) {
      const add = Math.min(cap - minutes[i], Math.max(1, Math.round((left * weights[i]) / weight)), left - given);
      minutes[i] += add;
      given += add;
    }
    left -= given;
    if (!given) break;
  }
  return Object.fromEntries(players.map((p, i) => [p.id, minutes[i]]).filter(([, m]) => (m as number) > 0));
}
