// Each year's prospects, created a season ahead so they can be scouted.
import { generatePlayer, playerOvr } from "@/engine/player";
import { Rng, clamp } from "@/engine/rng";
import type { Player, Position } from "@/engine/types";
import type { DraftState } from "../types";

export const CLASS_SIZE = 70;
const TOP_OVR = 79;
const OVR_PER_RANK = 0.26;
const POSITIONS: Position[] = ["PG", "SG", "SF", "PF", "C"];
/** About once in 12 years, a class has a once-in-a-generation talent. */
const GENERATIONAL_CHANCE = 1 / 12;

function prospect(rng: Rng, year: number, rank: number, generational: boolean): Player {
  const age = rng.int(19, 22);
  const target = generational ? rng.int(84, 86) : Math.round(TOP_OVR - rank * OVR_PER_RANK + rng.normal(0, 2));
  const p = generatePlayer(rng, { pos: rng.pick(POSITIONS), targetOvr: target, age, league: "college", teamId: null, hometownPool: "mixed" });
  const ovr = playerOvr(p);
  const youth = (23 - age) / 2;
  const potential = generational ? rng.int(97, 99) : Math.round(clamp(ovr + youth * rng.range(3, 9) + rng.normal(0, 2.5), ovr, 99));
  const out: Player = { ...p, id: `draft-${year}-${rank}`, potential, teamId: null, file: { service: 0, teamSeasons: 0 } };
  delete out.classYear;
  return out;
}

export function newDraftState(seed: string, year: number): DraftState {
  const rng = new Rng(`${seed}:class:${year}`);
  const generational = rng.chance(GENERATIONAL_CHANCE);
  return {
    year,
    prospects: Array.from({ length: CLASS_SIZE }, (_, i) => prospect(rng, year, i, generational && i === 0)),
    scouting: {},
    assigned: [],
    results: [],
  };
}
