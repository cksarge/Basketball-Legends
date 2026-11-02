// How an AI team chooses to play, from the roster it has.
import { playerOvr } from "@/engine/player";
import { Rng } from "@/engine/rng";
import type { Player, SystemId, TeamTactics } from "@/engine/types";
import { DEFAULT_TACTICS } from "@/game/sim/match";
import { SYSTEMS } from "@/game/sim/playbook";
import type { Franchise } from "../types";

const ROTATION = 8;
const STAR_GAP = 7;
const POST_SCORER = 88;
const SHOOTER = 78;
const SHOOTERS = 4;
const PASSER = 80;
const BOOK_SIZE = 4;

function chooseSystem(top: Player[]): SystemId {
  const ovr = top.map(playerOvr);
  if (ovr[0] - ovr[1] >= STAR_GAP) return "isoStar";
  if (top.some((p) => p.ratings.postControl >= POST_SCORER)) return "postUp";
  if (top.filter((p) => p.ratings.three >= SHOOTER).length >= SHOOTERS) return "paceSpace";
  return top.some((p) => p.ratings.passVision >= PASSER) ? "pickRoll" : "motion";
}

export function aiTactics(roster: Player[], seed: string): TeamTactics {
  const top = [...roster].sort((a, b) => playerOvr(b) - playerOvr(a)).slice(0, ROTATION);
  const system = chooseSystem(top);
  const plays = new Rng(`${seed}:plays:${system}`).shuffle([...SYSTEMS[system].plays]).slice(0, BOOK_SIZE);
  return { ...DEFAULT_TACTICS, system, plays };
}

export function leagueTactics(f: Pick<Franchise, "rosters" | "players" | "seed" | "season">): Record<string, TeamTactics> {
  const out: Record<string, TeamTactics> = {};
  for (const id of Object.keys(f.rosters))
    out[id] = aiTactics(
      f.rosters[id].map((p) => f.players[p]),
      `${f.seed}:${f.season.year}:${id}`,
    );
  return out;
}
