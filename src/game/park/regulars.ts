// The regulars at each park: generated players with nicknames, street clothes and a reputation.
// Generation is deterministic per park, so the same people are there every time you show up.
import { assignJerseys, generatePlayer, playerOvr } from "@/engine/player";
import { Rng, clamp } from "@/engine/rng";
import type { Player, Position, RatingKey, Team } from "@/engine/types";
import type { Park } from "./parks";

export interface Regular {
  player: Player;
  nickname: string;
  /** What people at the park say about them. */
  rep: string;
}

export interface StreetOutfit {
  shirt: string;
  shorts: string;
}

export const REGULARS_PER_PARK = 18;

const NICKNAMES = [
  "Big Smooth",
  "Deuce",
  "Flash",
  "Tank",
  "Lefty",
  "Hops",
  "Moose",
  "Doc",
  "Spider",
  "Ice",
  "Buckets",
  "Dime",
  "Tiny",
  "Showtime",
  "Pops",
  "Junior",
  "Scoop",
  "Boogie",
  "Rook",
  "Slim",
  "Pistol",
  "Bishop",
  "Professor",
  "Wheels",
  "Smoke",
  "Cash",
  "Truck",
  "Sky",
  "Bricks",
  "Mailman",
  "Glue",
  "Hammer",
  "Breeze",
  "Bones",
  "Choppa",
  "Silk",
  "Nails",
  "Kid",
  "Uncle Ray",
  "Coach",
  "Stretch",
  "Bull",
  "Rocket",
  "Vision",
  "Lockdown",
  "Sauce",
  "Biscuit",
  "Sarge",
];

const REP: Partial<Record<RatingKey, string[]>> = {
  three: ["Never misses from the corner", "Shoots it from the parking lot", "Pure shooter, ask anybody"],
  midRange: ["Lives at the elbow", "Pull-up game is automatic"],
  ballHandle: ["Will break your ankles", "Handles like a yo-yo", "Dribbles out the clock for fun"],
  layup: ["Finishes through anybody", "Crafty around the rim"],
  dunk: ["Dunks on everybody, even in warmups", "Plays above the rim"],
  postControl: ["Backs you down every time", "Old-man post game"],
  perimeterD: ["Picks you up full court", "Lockdown defender"],
  block: ["Swats everything", "Nothing easy at the rim"],
  defReb: ["Owns the glass", "Every rebound is his"],
  passVision: ["Sees everything", "Makes everybody better"],
  speed: ["Fastest guy at the park", "Always running the break"],
  hustle: ["Dives on the concrete", "Never stops moving"],
};
const GENERIC_REP = ["Calls next every game", "Talks more than he plays", "Here every morning at seven", "Played in college back in the day", "New in town"];

/** Shirt and shorts colors people actually wear to the park. */
const SHIRTS = ["#f4f4f2", "#1d1f23", "#c8102e", "#1f4e9a", "#2e7d32", "#f2a900", "#6a1b9a", "#8d9399", "#e66b1f", "#0c7c8c", "#7b1e3a", "#d8c9a8"];
const SHORTS = ["#1d1f23", "#2a3550", "#5a5f66", "#f4f4f2", "#3b2f2a", "#14365e", "#7a7f86"];

export function regularOutfit(id: string): StreetOutfit {
  const rng = new Rng(`outfit:${id}`);
  const shirt = rng.pick(SHIRTS);
  let shorts = rng.pick(SHORTS);
  if (shorts === shirt) shorts = "#1d1f23";
  return { shirt, shorts };
}

const cache = new Map<string, Regular[]>();

/** The park's regulars, best first (the same players, with the same ids, every time). */
export function parkRegulars(park: Park): Regular[] {
  const hit = cache.get(park.id);
  if (hit) return hit;
  const rng = new Rng(`park:${park.id}:regulars`);
  const names = rng.shuffle([...NICKNAMES]);
  const positions: Position[] = ["PG", "SG", "SF", "PF", "C"];
  const out: Regular[] = [];
  for (let i = 0; i < REGULARS_PER_PARK; i++) {
    const [lo, hi] = park.level;
    // a few standouts, most in the middle, some just out for exercise
    const t = clamp(rng.normal(0.5, 0.22), 0, 1);
    const age = Math.round(clamp(rng.normal(27, 7), 17, 48));
    const p = generatePlayer(rng, {
      pos: positions[i % 5],
      targetOvr: Math.round(lo + (hi - lo) * t),
      age,
      league: "pro",
      teamId: null,
      hometownPool: "us",
      idPrefix: `park-${park.id}`,
    });
    // older regulars lose a step but know every trick
    if (age > 34) {
      p.ratings.speed = Math.max(25, p.ratings.speed - (age - 34));
      p.ratings.vertical = Math.max(25, p.ratings.vertical - (age - 34));
      p.ratings.iq = Math.min(99, p.ratings.iq + 6);
    }
    p.id = `park-${park.id}-${i}`;
    p.hometown = `${park.city}, ${park.state}`;
    // everyday players: a few inches shorter than the pros at each position
    const shrink = rng.int(2, 5);
    p.heightIn = clamp(p.heightIn - shrink, 66, 84);
    p.wingspanIn -= shrink;
    const best = (Object.keys(REP) as RatingKey[]).sort((a, b) => p.ratings[b] - p.ratings[a])[0];
    const pool = rng.chance(0.75) ? (REP[best] ?? GENERIC_REP) : GENERIC_REP;
    out.push({ player: p, nickname: names[i % names.length], rep: rng.pick(pool) });
  }
  assignJerseys(
    rng,
    out.map((r) => r.player),
  );
  const sorted = out.sort((a, b) => playerOvr(b.player) - playerOvr(a.player));
  cache.set(park.id, sorted);
  return sorted;
}

/** A pickup side as a Team the engine and renderer understand (no real program behind it). */
export function crewTeam(id: string, name: string, color: string, trim = "#1d1f23"): Team {
  return {
    id: `crew-${id}`,
    league: "pro",
    name,
    nickname: "",
    abbrev: name.slice(0, 3).toUpperCase(),
    city: "",
    state: "",
    colors: { primary: color, secondary: trim, accent: "#ffffff" },
    logo: { shape: "circle", icon: "star", monogram: name.slice(0, 2).toUpperCase(), stripe: false },
    conferenceId: "park",
    prestige: 0.5,
    arena: { name: "Park", capacity: 0 },
  };
}

/** Two shirt colors that read clearly against each other (light vs dark). */
export const SIDE_COLORS: [string, string] = ["#f4f4f2", "#1f4e9a"];
