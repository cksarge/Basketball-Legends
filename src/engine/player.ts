import { Rng, clamp } from "./rng";
import { AZ_HOMETOWNS, FIRST_NAMES, INTL_HOMETOWNS, LAST_NAMES, US_HOMETOWNS } from "./names";
import type { Appearance, Archetype, ClassYear, LeagueId, Player, Position, RatingKey, Ratings, Team } from "./types";

// ---------------------------------------------------------------------------
// Overall rating
// ---------------------------------------------------------------------------

type Weights = Partial<Record<RatingKey, number>>;

const OVR_WEIGHTS: Record<Position, Weights> = {
  PG: {
    three: 1.4,
    midRange: 1,
    ballHandle: 1.6,
    passAccuracy: 1.4,
    passVision: 1.5,
    speed: 1,
    speedWithBall: 1,
    layup: 0.9,
    perimeterD: 0.9,
    steal: 0.7,
    iq: 1.1,
    freeThrow: 0.4,
    accel: 0.6,
    clutch: 0.3,
  },
  SG: {
    three: 1.6,
    midRange: 1.3,
    ballHandle: 1,
    passAccuracy: 0.6,
    layup: 1,
    dunk: 0.4,
    speed: 0.9,
    perimeterD: 1,
    steal: 0.6,
    iq: 0.9,
    freeThrow: 0.5,
    drawFoul: 0.5,
    accel: 0.6,
    clutch: 0.3,
  },
  SF: {
    three: 1.2,
    midRange: 1.1,
    layup: 1,
    dunk: 0.7,
    ballHandle: 0.7,
    perimeterD: 1.1,
    interiorD: 0.5,
    steal: 0.6,
    defReb: 0.6,
    vertical: 0.6,
    strength: 0.5,
    speed: 0.7,
    iq: 0.9,
    passVision: 0.4,
  },
  PF: {
    closeShot: 1,
    layup: 0.6,
    dunk: 0.9,
    midRange: 0.7,
    three: 0.6,
    postControl: 0.8,
    interiorD: 1.1,
    block: 0.8,
    defReb: 1.2,
    offReb: 0.8,
    strength: 1,
    vertical: 0.7,
    iq: 0.8,
    perimeterD: 0.5,
  },
  C: {
    closeShot: 1.2,
    dunk: 1,
    postControl: 1,
    interiorD: 1.5,
    block: 1.4,
    defReb: 1.5,
    offReb: 1.1,
    strength: 1.2,
    vertical: 0.6,
    iq: 0.8,
    layup: 0.4,
    passVision: 0.3,
  },
};

export function overall(r: Ratings, pos: Position): number {
  const w = OVR_WEIGHTS[pos];
  let sum = 0,
    tw = 0;
  for (const k in w) {
    const wk = w[k as RatingKey]!;
    sum += r[k as RatingKey] * wk;
    tw += wk;
  }
  const base = sum / tw;
  // stretch so elite players read 90+ and scrubs read ~40
  return Math.round(clamp(40 + (base - 45) * 1.18, 25, 99));
}

export const playerOvr = (p: Player) => overall(p.ratings, p.pos);

// ---------------------------------------------------------------------------
// Archetypes
// ---------------------------------------------------------------------------

/** Rating offsets relative to the player's base talent. */
const ARCHETYPES: Record<Archetype, { positions: Position[]; mods: Weights }> = {
  "Floor General": {
    positions: ["PG"],
    mods: { passAccuracy: 14, passVision: 16, ballHandle: 12, iq: 10, three: 2, dunk: -12, strength: -10, block: -15, interiorD: -12, offReb: -12 },
  },
  "Shot Creator": {
    positions: ["PG", "SG", "SF"],
    mods: { ballHandle: 12, midRange: 12, three: 8, speedWithBall: 8, drawFoul: 8, clutch: 8, interiorD: -10, block: -12, offReb: -10 },
  },
  Sharpshooter: {
    positions: ["PG", "SG", "SF"],
    mods: { three: 18, midRange: 10, freeThrow: 14, iq: 4, dunk: -12, interiorD: -12, block: -12, strength: -8, offReb: -12 },
  },
  Slasher: { positions: ["SG", "SF"], mods: { layup: 14, dunk: 14, speed: 10, accel: 10, vertical: 10, drawFoul: 10, three: -8, postControl: -6 } },
  "3&D Wing": { positions: ["SG", "SF"], mods: { three: 12, perimeterD: 14, steal: 8, hustle: 8, ballHandle: -6, postControl: -8, passVision: -4 } },
  "Two-Way Wing": { positions: ["SF", "PF"], mods: { perimeterD: 10, interiorD: 4, midRange: 6, layup: 6, strength: 4, defReb: 4, steal: 4 } },
  "Stretch Big": { positions: ["PF", "C"], mods: { three: 14, midRange: 10, freeThrow: 8, postControl: -2, block: -4, offReb: -6, strength: -4, speed: -8 } },
  "Post Scorer": {
    positions: ["PF", "C"],
    mods: { postControl: 16, closeShot: 14, strength: 10, drawFoul: 8, three: -14, speed: -10, ballHandle: -12, perimeterD: -8 },
  },
  "Rim Protector": {
    positions: ["C", "PF"],
    mods: { block: 18, interiorD: 16, defReb: 10, vertical: 6, three: -16, midRange: -8, ballHandle: -16, passVision: -8, speed: -8 },
  },
  "Glass Cleaner": { positions: ["C", "PF"], mods: { offReb: 18, defReb: 18, hustle: 12, strength: 8, three: -16, midRange: -8, ballHandle: -14, speed: -6 } },
  "Playmaking Big": { positions: ["PF", "C"], mods: { passVision: 14, passAccuracy: 12, iq: 10, ballHandle: 6, block: -4, vertical: -6, speed: -6 } },
  "Athletic Finisher": {
    positions: ["PF", "C", "SF"],
    mods: { dunk: 18, vertical: 16, speed: 4, offReb: 8, block: 6, three: -14, freeThrow: -10, midRange: -8 },
  },
};

export const ARCHETYPE_LIST = Object.keys(ARCHETYPES) as Archetype[];
export const archetypesFor = (pos: Position) => ARCHETYPE_LIST.filter((a) => ARCHETYPES[a].positions.includes(pos));

/** Position baseline shapes (relative to talent). */
const POS_BASE: Record<Position, Weights> = {
  PG: {
    speed: 8,
    accel: 8,
    ballHandle: 8,
    speedWithBall: 8,
    passAccuracy: 6,
    passVision: 6,
    three: 3,
    strength: -10,
    block: -14,
    interiorD: -10,
    offReb: -12,
    defReb: -10,
    postControl: -12,
    dunk: -6,
  },
  SG: { speed: 6, accel: 6, three: 5, midRange: 4, ballHandle: 2, strength: -6, block: -10, interiorD: -8, offReb: -8, defReb: -6, postControl: -8 },
  SF: { vertical: 2, perimeterD: 2, block: -4, postControl: -2 },
  PF: { strength: 6, interiorD: 6, defReb: 6, offReb: 4, block: 4, speed: -4, ballHandle: -6, passVision: -4, three: -4 },
  C: {
    strength: 10,
    interiorD: 10,
    block: 10,
    defReb: 10,
    offReb: 8,
    closeShot: 6,
    speed: -10,
    accel: -8,
    ballHandle: -14,
    speedWithBall: -12,
    three: -10,
    passVision: -6,
    perimeterD: -6,
    steal: -6,
  },
};

const ALL_KEYS: RatingKey[] = [
  "speed",
  "accel",
  "strength",
  "vertical",
  "stamina",
  "durability",
  "closeShot",
  "layup",
  "dunk",
  "midRange",
  "three",
  "freeThrow",
  "postControl",
  "drawFoul",
  "ballHandle",
  "speedWithBall",
  "passAccuracy",
  "passVision",
  "interiorD",
  "perimeterD",
  "steal",
  "block",
  "offReb",
  "defReb",
  "iq",
  "hustle",
  "clutch",
];

const HEIGHT: Record<Position, [number, number]> = { PG: [72, 77], SG: [75, 79], SF: [77, 81], PF: [79, 83], C: [81, 86] };

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface GenOptions {
  pos?: Position;
  archetype?: Archetype;
  /** Target overall (pro scale). */
  targetOvr: number;
  age: number;
  league: LeagueId;
  teamId: string | null;
  hometownPool?: "az" | "us" | "intl" | "mixed";
  classYear?: ClassYear;
  idPrefix?: string;
}

let idCounter = 0;
export function newPlayerId(rng: Rng, prefix = "p") {
  idCounter++;
  return `${prefix}-${Math.floor(rng.next() * 36 ** 6).toString(36)}${idCounter.toString(36)}`;
}

export function generatePlayer(rng: Rng, o: GenOptions): Player {
  const pos = o.pos ?? rng.pick<Position>(["PG", "SG", "SF", "PF", "C"]);
  const archetype = o.archetype ?? rng.pick(archetypesFor(pos));
  const [hmin, hmax] = HEIGHT[pos];
  // Younger players are shorter on average (still growing).
  const growth = o.age < 18 ? (18 - o.age) * 0.7 : 0;
  const heightIn = Math.round(clamp(rng.normal((hmin + hmax) / 2 - growth, 1.6), hmin - 3 - growth, hmax + 2));
  const weightLb = Math.round(heightIn * 2.75 + rng.normal(0, 10) + (pos === "C" || pos === "PF" ? 18 : 0) - growth * 4);
  const wingspanIn = Math.round(heightIn + rng.normal(3, 2));

  // Search the talent base that yields the target overall.
  const noise: Partial<Record<RatingKey, number>> = {};
  for (const k of ALL_KEYS) noise[k] = rng.normal(0, 5.5);
  const build = (base: number): Ratings => {
    const r = {} as Ratings;
    for (const k of ALL_KEYS) {
      const v = base + (POS_BASE[pos][k] ?? 0) + (ARCHETYPES[archetype].mods[k] ?? 0) + noise[k]!;
      r[k] = Math.round(clamp(v, 25, 99));
    }
    r.freeThrow = Math.round(clamp((r.freeThrow + r.three + r.midRange) / 3 + rng.normal(4, 5), 25, 99));
    r.stamina = Math.round(clamp(r.stamina + (o.age < 30 ? 4 : -4), 25, 99));
    return r;
  };
  let lo = 10,
    hi = 110,
    ratings = build(60);
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    ratings = build(mid);
    if (overall(ratings, pos) < o.targetOvr) lo = mid;
    else hi = mid;
  }

  const poolKind = o.hometownPool ?? "mixed";
  const pool =
    poolKind === "az"
      ? AZ_HOMETOWNS
      : poolKind === "us"
        ? US_HOMETOWNS
        : poolKind === "intl"
          ? INTL_HOMETOWNS
          : rng.chance(0.18)
            ? INTL_HOMETOWNS
            : US_HOMETOWNS;

  const ovr = overall(ratings, pos);
  const youth = clamp(26 - o.age, 0, 10);
  const potential = Math.round(clamp(ovr + youth * rng.range(0.6, 2.4) + rng.normal(0, 2), ovr, 99));

  return {
    id: newPlayerId(rng, o.idPrefix),
    firstName: rng.pick(FIRST_NAMES),
    lastName: rng.pick(LAST_NAMES),
    pos,
    secondaryPos: secondaryFor(rng, pos),
    heightIn,
    weightLb,
    wingspanIn,
    age: o.age,
    hometown: rng.pick(pool),
    archetype,
    ratings,
    potential,
    jersey: 0,
    teamId: o.teamId,
    classYear: o.classYear,
    appearance: randomAppearance(rng),
    badges: [],
    traits: { workEthic: rng.next(), ego: rng.next(), loyalty: rng.next(), consistency: rng.range(0.3, 1) },
  };
}

function secondaryFor(rng: Rng, pos: Position): Position | undefined {
  const adj: Record<Position, Position[]> = { PG: ["SG"], SG: ["PG", "SF"], SF: ["SG", "PF"], PF: ["SF", "C"], C: ["PF"] };
  return rng.chance(0.6) ? rng.pick(adj[pos]) : undefined;
}

export const SKIN_TONES = ["#f6d7c3", "#eac4a6", "#d9a77f", "#c68a5e", "#a86b42", "#8a5232", "#6b3e25", "#4f2c1a", "#3a2014"];
export const HAIR_COLORS = ["#0d0d0d", "#2b1a10", "#4a2e19", "#6e4a2a", "#a07040", "#d8b26e", "#b5452a", "#9a9a9a"];
export const HAIR_STYLES = ["Bald", "Buzz", "Short", "Fade", "Waves", "Twists", "Afro", "Braids", "Locs", "Man Bun", "Curly Top", "Mohawk"];
export const FACIAL_HAIR = ["None", "Stubble", "Goatee", "Beard", "Mustache", "Full Beard"];
const SHOE_COLORS = ["#ffffff", "#111111", "#e63946", "#1d3557", "#ffb703", "#2a9d8f", "#8338ec", "#ff006e", "#f4a261"];

export function randomAppearance(rng: Rng): Appearance {
  return {
    skinTone: rng.int(0, SKIN_TONES.length - 1),
    hairStyle: rng.int(0, HAIR_STYLES.length - 1),
    hairColor: rng.weighted([0, 1, 2, 3, 4, 5, 6, 7], [40, 20, 12, 8, 6, 5, 3, 2]),
    facialHair: rng.weighted([0, 1, 2, 3, 4, 5], [45, 20, 10, 12, 4, 9]),
    headband: rng.chance(0.12),
    armSleeve: rng.weighted(["none", "left", "right"] as const, [75, 12, 13]),
    kneePads: rng.chance(0.15),
    shoeColor: rng.pick(SHOE_COLORS),
    faceShape: rng.next(),
    build: rng.next(),
  };
}

// ---------------------------------------------------------------------------
// Rosters
// ---------------------------------------------------------------------------

/** Average starter overall for a team by league/tier/prestige. */
export function teamTalentTarget(team: Team): number {
  const p = team.prestige;
  switch (team.league) {
    case "pro":
      return 76 + p * 8;
    case "college":
      if (team.tier === "D1") return 56 + p * 20;
      if (team.tier === "D2") return 50 + p * 14;
      return 45 + p * 12;
    case "hs":
      return 38 + p * 22;
  }
}

const ROSTER_SIZE: Record<LeagueId, number> = { pro: 15, college: 14, hs: 12 };
const CLASS_YEARS: ClassYear[] = ["FR", "SO", "JR", "SR"];

export function generateRoster(team: Team, seed = 0): Player[] {
  const rng = new Rng(`${team.id}:roster:${seed}`);
  const target = teamTalentTarget(team);
  const size = ROSTER_SIZE[team.league];
  const slots: Position[] = ["PG", "SG", "SF", "PF", "C", "PG", "SG", "SF", "PF", "C", "SG", "SF", "PF", "PG", "C"];
  const players: Player[] = [];
  for (let i = 0; i < size; i++) {
    const depth = i < 5 ? 0 : i < 8 ? 1 : i < 11 ? 2 : 3;
    const star = i === 0 || (i === 1 && rng.chance(0.4));
    let tgt = target - depth * (team.league === "pro" ? 5.5 : 6.5) + rng.normal(0, 3) + (star ? rng.range(4, 11) : 0);
    let age: number, classYear: ClassYear | undefined;
    if (team.league === "pro") {
      age = Math.round(clamp(rng.normal(26.5, 3.8), 19, 38));
    } else if (team.league === "college") {
      classYear = rng.pick(CLASS_YEARS);
      age = 18 + CLASS_YEARS.indexOf(classYear) + rng.int(0, 1);
      tgt += (CLASS_YEARS.indexOf(classYear) - 1.5) * 1.5;
    } else {
      classYear = rng.weighted(CLASS_YEARS, [1, 2, 4, 5]);
      age = 14 + CLASS_YEARS.indexOf(classYear) + rng.int(0, 1);
      tgt += (CLASS_YEARS.indexOf(classYear) - 2) * 2.5;
    }
    const p = generatePlayer(rng, {
      pos: slots[i],
      targetOvr: clamp(Math.round(tgt), 28, 97),
      age,
      league: team.league,
      teamId: team.id,
      classYear,
      hometownPool: team.league === "hs" ? "az" : team.league === "college" ? (rng.chance(0.08) ? "intl" : "us") : "mixed",
      idPrefix: team.id,
    });
    if (team.league === "pro") p.contract = rookieOrVetContract(rng, p);
    players.push(p);
  }
  assignJerseys(rng, players);
  return players;
}

function rookieOrVetContract(rng: Rng, p: Player) {
  const ovr = playerOvr(p);
  const salary = Math.round(clamp(1.1e6 + Math.pow(Math.max(0, ovr - 60) / 35, 2.4) * 52e6 + rng.normal(0, 1.5e6), 1.1e6, 55e6) / 1e4) * 1e4;
  return { salary, years: rng.int(1, 5), rookie: p.age <= 22 };
}

export function assignJerseys(rng: Rng, players: Player[]) {
  const used = new Set<number>();
  for (const p of players) {
    let n: number;
    do {
      n = rng.weighted([rng.int(0, 15), rng.int(20, 35), rng.int(40, 55), rng.int(0, 99)], [5, 4, 2, 1]);
    } while (used.has(n));
    used.add(n);
    p.jersey = n;
  }
}

export const fullName = (p: Player) => `${p.firstName} ${p.lastName}`;
export const heightStr = (inches: number) => `${Math.floor(inches / 12)}'${inches % 12}"`;
