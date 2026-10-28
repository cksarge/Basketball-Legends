// High school rosters by level. Opponents are generated on demand from (school, level, year), so the
// same team always has the same players; your own school's rosters are saved and carried from year to year.
import { assignJerseys, generatePlayer, playerOvr, teamTalentTarget } from "@/engine/player";
import { Rng, clamp } from "@/engine/rng";
import type { ClassYear, Player, Position, Team } from "@/engine/types";
import type { HsLevel } from "../types";

const CLASSES: ClassYear[] = ["FR", "SO", "JR", "SR"];
const CLASS_WEIGHTS: Record<HsLevel, number[]> = { varsity: [1, 3, 6, 7], jv: [3, 6, 3, 0], frso: [7, 4, 0, 0] };
/** How far below varsity talent each level sits (pro-scale overall). */
export const LEVEL_OFFSET: Record<HsLevel, number> = { varsity: 0, jv: -7, frso: -12 };
export const LEVEL_SIZE: Record<HsLevel, number> = { varsity: 12, jv: 12, frso: 13 };
const SLOTS: Position[] = ["PG", "SG", "SF", "PF", "C", "PG", "SG", "SF", "PF", "C", "SG", "SF", "PF", "PG", "C"];

/** Levels a school fields, in order from lowest to highest (JV 2 plays as JV). */
export function schoolLevels(team: Team): HsLevel[] {
  const l = team.levels ?? ["varsity", "jv"];
  return (["frso", "jv", "varsity"] as HsLevel[]).filter((x) => l.includes(x));
}

export const ageFor = (cls: ClassYear, rng: Rng) => 14 + CLASSES.indexOf(cls) + (rng.chance(0.35) ? 1 : 0);

export function levelRoster(team: Team, level: HsLevel, year: number): Player[] {
  const rng = new Rng(`${team.id}:${level}:${year}`);
  const target = teamTalentTarget(team) + LEVEL_OFFSET[level];
  const players: Player[] = [];
  for (let i = 0; i < LEVEL_SIZE[level]; i++) {
    const depth = i < 5 ? 0 : i < 8 ? 1 : i < 11 ? 2 : 3;
    const classYear = rng.weighted(CLASSES, CLASS_WEIGHTS[level]);
    const star = i === 0 && rng.chance(0.5);
    const tgt = target - depth * 6 + (CLASSES.indexOf(classYear) - 1.5) * 2 + rng.normal(0, 3) + (star ? rng.range(3, 9) : 0);
    players.push(
      generatePlayer(rng, {
        pos: SLOTS[i],
        targetOvr: clamp(Math.round(tgt), 25, 90),
        age: ageFor(classYear, rng),
        league: "hs",
        teamId: team.id,
        classYear,
        hometownPool: "az",
        idPrefix: `${team.id}-${level}-${year}`,
      }),
    );
  }
  assignJerseys(rng, players);
  return players;
}

/** Strength used by the fast score model: the average overall of the top five players. */
export function rosterStrength(roster: Player[]) {
  const top = roster
    .map(playerOvr)
    .sort((a, b) => b - a)
    .slice(0, 5);
  return top.reduce((a, b) => a + b, 0) / Math.max(1, top.length);
}

/** Expected strength of a school's team without building its roster (calibrated to rosterStrength in tests). */
export function estimatedStrength(team: Team, level: HsLevel, year: number) {
  const rng = new Rng(`${team.id}:${level}:${year}:str`);
  return teamTalentTarget(team) + LEVEL_OFFSET[level] + STRENGTH_BIAS[level] + rng.normal(0, 2.2);
}
/** Mean gap between rosterStrength(levelRoster(...)) and the talent target plus level offset. */
export const STRENGTH_BIAS: Record<HsLevel, number> = { varsity: 1.6, jv: -0.7, frso: -1.7 };

/**
 * Next year's rosters for your school: everyone moves up a class and improves, seniors graduate,
 * the best underclassmen move up a level, and a new freshman class fills the bottom.
 */
export function rollRosters(team: Team, prev: Partial<Record<HsLevel, Player[]>>, year: number): Partial<Record<HsLevel, Player[]>> {
  const rng = new Rng(`${team.id}:roll:${year}`);
  const levels = schoolLevels(team);
  const pool: Player[] = [];
  for (const l of levels)
    for (const p of prev[l] ?? []) {
      const cls = p.classYear ?? "SR";
      if (cls === "SR") continue;
      const next = CLASSES[CLASSES.indexOf(cls) + 1];
      const grow = rng.range(2, 6) * (0.6 + p.traits.workEthic * 0.8);
      const ratings = { ...p.ratings };
      for (const k of Object.keys(ratings) as (keyof typeof ratings)[]) ratings[k] = Math.round(clamp(ratings[k] + grow + rng.normal(0, 1.5), 25, 99));
      pool.push({ ...p, classYear: next, age: p.age + 1, ratings, heightIn: p.heightIn + (p.age < 17 ? rng.int(0, 2) : 0) });
    }
  // fresh faces: next year's generated rosters supply the incoming freshmen (and transfers to fill holes)
  const fresh = levels.flatMap((l) => levelRoster(team, l, year)).filter((p) => p.classYear === "FR");
  pool.push(...fresh);
  pool.sort((a, b) => playerOvr(b) - playerOvr(a));
  const out: Partial<Record<HsLevel, Player[]>> = {};
  const order = [...levels].reverse(); // varsity first
  for (const l of order) {
    const eligible = pool.filter((p) => l !== "frso" || p.classYear === "FR" || p.classYear === "SO");
    // seniors and juniors go to varsity or JV before freshmen take spots
    const take = eligible.slice(0, LEVEL_SIZE[l]);
    out[l] = take.map((p) => ({ ...p, teamId: team.id }));
    for (const p of take) pool.splice(pool.indexOf(p), 1);
  }
  for (const l of levels) {
    const r = out[l]!;
    if (r.length < LEVEL_SIZE[l]) r.push(...levelRoster(team, l, year).slice(0, LEVEL_SIZE[l] - r.length));
    assignJerseys(rng, r);
  }
  return out;
}
