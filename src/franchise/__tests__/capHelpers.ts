import type { Franchise } from "../types";

/** Sets a team's payroll by spreading it evenly over its roster. */
export function setPayroll(f: Franchise, teamId: string, total: number): Franchise {
  const ids = f.rosters[teamId];
  const players = { ...f.players };
  for (const id of ids) players[id] = { ...players[id], contract: { ...players[id].contract!, salary: total / ids.length, years: 2 } };
  return { ...f, players };
}
