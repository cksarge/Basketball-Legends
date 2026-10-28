// Career creator rules: body ranges, rating caps, starting ratings and the new-career save.
import { ALL_KEYS, ARCHETYPES, POS_BASE, archetypesFor, overall } from "@/engine/player";
import { Rng, clamp } from "@/engine/rng";
import type { Archetype, Position, RatingKey, Ratings, Team } from "@/engine/types";
import { CAREER_VERSION, type BodySpec, type Career, type CareerPlayer, type CareerSettings, type CreatorInput } from "./types";

/** Adult height range per position, in inches. */
export const HEIGHT_RANGE: Record<Position, [number, number]> = { PG: [68, 78], SG: [72, 80], SF: [75, 82], PF: [77, 84], C: [79, 88] };
export const WINGSPAN_RANGE = [-2, 9] as const; // relative to height

export const expectedWeight = (heightIn: number) => Math.round(heightIn * 2.75 - 5);
export function weightRange(heightIn: number): [number, number] {
  return [Math.round(heightIn * 2.3), Math.round(heightIn * 3.35)];
}

export function defaultBody(pos: Position): BodySpec {
  const [lo, hi] = HEIGHT_RANGE[pos];
  const h = Math.round((lo + hi) / 2);
  return { adultHeightIn: h, weightLb: expectedWeight(h), wingspanIn: h + 3 };
}

/** Clamp a body to the ranges for this position. */
export function clampBody(pos: Position, b: BodySpec): BodySpec {
  const [lo, hi] = HEIGHT_RANGE[pos];
  const h = clamp(Math.round(b.adultHeightIn), lo, hi);
  const [wlo, whi] = weightRange(h);
  return {
    adultHeightIn: h,
    weightLb: clamp(Math.round(b.weightLb), wlo, whi),
    wingspanIn: clamp(Math.round(b.wingspanIn), h + WINGSPAN_RANGE[0], h + WINGSPAN_RANGE[1]),
  };
}

/** Inches still to grow at a given age (the creator picks the adult height). */
export function growthLeft(age: number) {
  return age <= 14 ? 3.5 : age === 15 ? 2.2 : age === 16 ? 1.2 : age === 17 ? 0.5 : 0;
}
export const heightAtAge = (adult: number, age: number) => Math.round(adult - growthLeft(age));
export const weightAtAge = (adult: number, age: number) => Math.round(adult - growthLeft(age) * 7);

/** How each rating's cap reacts to height (per 4"), weight (per 20 lb over expected) and wingspan (per 4" over height). */
const BODY_EFFECT: Partial<Record<RatingKey, [h: number, w: number, ws: number]>> = {
  speed: [-6, -6, 0],
  accel: [-5, -5, 0],
  strength: [4, 9, 0],
  vertical: [-2, -6, 1],
  stamina: [0, -2, 0],
  durability: [0, 3, 0],
  closeShot: [4, 1, 1],
  layup: [-1, -1, 1],
  dunk: [6, -2, 2],
  three: [-2, 0, -1],
  freeThrow: [-1, 0, 0],
  postControl: [6, 4, 1],
  drawFoul: [0, 2, 0],
  ballHandle: [-6, -2, 0],
  speedWithBall: [-6, -4, 0],
  passAccuracy: [-1, 0, 0],
  interiorD: [6, 4, 4],
  perimeterD: [-3, -2, 4],
  steal: [-3, -1, 4],
  block: [8, 1, 6],
  offReb: [6, 2, 3],
  defReb: [6, 2, 3],
};

export function computeCaps(pos: Position, archetype: Archetype, body: BodySpec): Ratings {
  const hz = (body.adultHeightIn - 78) / 4;
  const wz = (body.weightLb - expectedWeight(body.adultHeightIn)) / 20;
  const ws = (body.wingspanIn - body.adultHeightIn) / 4;
  const caps = {} as Ratings;
  for (const k of ALL_KEYS) {
    const [h, w, s] = BODY_EFFECT[k] ?? [0, 0, 0];
    const v = 86 + h * hz + w * wz + s * ws + (POS_BASE[pos][k] ?? 0) * 0.55 + (ARCHETYPES[archetype].mods[k] ?? 0) * 0.75;
    caps[k] = Math.round(clamp(v, 55, 99));
  }
  return caps;
}

/** Ratings a freshman starts with before spending creator points. */
export function startingRatings(pos: Position, archetype: Archetype, caps: Ratings, rng: Rng): Ratings {
  const r = {} as Ratings;
  for (const k of ALL_KEYS) {
    const v = 36 + (POS_BASE[pos][k] ?? 0) * 0.45 + (ARCHETYPES[archetype].mods[k] ?? 0) * 0.5 + rng.normal(0, 1.5);
    r[k] = Math.round(clamp(v, 25, caps[k] - 20));
  }
  return r;
}

/** Points to spend in the creator, and the most any one rating can take. */
export const CREATOR_POINTS = 45;
export const CREATOR_MAX_PER_RATING = 10;

export function applyAllocation(base: Ratings, caps: Ratings, alloc: Partial<Record<RatingKey, number>>): Ratings {
  const r = { ...base };
  for (const k of ALL_KEYS) {
    const add = clamp(Math.round(alloc[k] ?? 0), 0, CREATOR_MAX_PER_RATING);
    r[k] = Math.min(caps[k], r[k] + add);
  }
  return r;
}

export function allocationTotal(alloc: Partial<Record<RatingKey, number>>) {
  return Object.values(alloc).reduce((a, b) => a + (b ?? 0), 0);
}

/** Expected peak overall: the overall the player reaches with every rating at its cap, softened (nobody maxes everything). */
export function potentialFromCaps(pos: Position, caps: Ratings) {
  return Math.round(clamp(overall(caps, pos) - 4, 40, 99));
}

export const DEFAULT_SETTINGS: CareerSettings = { difficulty: "pro", quarterMinutes: 6, bench: "ask", storyFrequency: "normal" };

export function validArchetype(pos: Position, a: Archetype) {
  return archetypesFor(pos).includes(a);
}

/** Schools a player from this hometown would normally attend (same city), biggest first. */
export function hometownSchools(teams: Team[], hometown: string) {
  const city = hometown.replace(/, AZ$/, "");
  const order = ["6A", "5A", "4A", "3A", "2A", "1A"];
  return teams.filter((t) => t.city === city).sort((a, b) => order.indexOf(a.tier!) - order.indexOf(b.tier!) || a.name.localeCompare(b.name));
}

/** Every Arizona city with a high school in the game, as "City, AZ". */
export function hometowns(teams: Team[]) {
  return [...new Set(teams.map((t) => `${t.city}, AZ`))].sort();
}

export function newCareerId(rng: Rng) {
  return `c-${Date.now().toString(36)}-${Math.floor(rng.next() * 36 ** 5).toString(36)}`;
}

/** Freshmen start the summer before school, on August 1 of the start year. */
export const startDate = (startYear: number) => `${startYear}-08-01`;
export const FRESHMAN_AGE = 14;

export function createCareer(input: CreatorInput, seed = Date.now() % 2147483647): Career {
  const rng = new Rng(seed);
  const body = clampBody(input.pos, input.body);
  const archetype = validArchetype(input.pos, input.archetype) ? input.archetype : archetypesFor(input.pos)[0];
  const caps = computeCaps(input.pos, archetype, body);
  const base = startingRatings(input.pos, archetype, caps, new Rng(`${seed}:start`));
  const ratings = applyAllocation(base, caps, input.allocation);
  const age = FRESHMAN_AGE;
  const player: CareerPlayer = {
    id: `user-${seed.toString(36)}`,
    firstName: input.firstName.trim() || "Rookie",
    lastName: input.lastName.trim() || "Player",
    pos: input.pos,
    heightIn: heightAtAge(body.adultHeightIn, age),
    weightLb: weightAtAge(body.weightLb, age),
    wingspanIn: heightAtAge(body.wingspanIn, age),
    age,
    hometown: input.hometown,
    archetype,
    ratings,
    potential: potentialFromCaps(input.pos, caps),
    jersey: clamp(Math.round(input.jersey), 0, 99),
    teamId: input.schoolId,
    classYear: "FR",
    appearance: input.appearance,
    badges: [],
    traits: { workEthic: 0.7, ego: 0.4, loyalty: 0.6, consistency: 0.7 },
    isUser: true,
    body,
    caps,
    skillPoints: 0,
    xp: 0,
    birthYear: input.startYear - age,
  };
  const now = Date.now();
  const date = startDate(input.startYear);
  return {
    version: CAREER_VERSION,
    id: newCareerId(rng),
    createdAt: now,
    updatedAt: now,
    seed,
    stage: "hs",
    date,
    startYear: input.startYear,
    player,
    settings: { ...DEFAULT_SETTINGS, ...input.settings },
    hs: { schoolId: input.schoolId, seasons: [] },
    inbox: [
      {
        id: "welcome",
        date,
        from: "Coach",
        subject: "Welcome to the program",
        body: `Glad to have you, ${player.firstName}. Tryouts are in November. Every level is open to you if you earn it, so put in the work this fall.`,
        read: false,
      },
    ],
    log: [{ date, text: `${player.firstName} ${player.lastName} starts high school.`, kind: "milestone" }],
  };
}
