// The summer between high school seasons: a June camp you choose, then July AAU showcase games
// with a club team (elite circuit for ranked prospects). Clubs are synthetic teams built here.
import { assignJerseys, generatePlayer } from "@/engine/player";
import { Rng, clamp } from "@/engine/rng";
import type { Player, Position, RatingKey, Team } from "@/engine/types";
import { iso } from "../calendar";
import type { Career, HsSeason, IsoDate, ScheduledGame } from "../types";

export interface Camp {
  id: string;
  name: string;
  blurb: string;
  boosts: Partial<Record<RatingKey, number>>;
  exposure: number;
  /** Invite only: needs a national rank at or better than this. */
  inviteRank?: number;
}

export const CAMPS: Camp[] = [
  {
    id: "shooting",
    name: "Desert Shooting Camp",
    blurb: "Thousands of reps with a shooting coach.",
    boosts: { three: 3, midRange: 3, freeThrow: 2 },
    exposure: 0.4,
  },
  {
    id: "handles",
    name: "Ball-Handling Academy",
    blurb: "Handles, footwork and reading the pick-and-roll.",
    boosts: { ballHandle: 3, speedWithBall: 2, passAccuracy: 2, passVision: 1 },
    exposure: 0.4,
  },
  {
    id: "bigs",
    name: "Big Man Camp",
    blurb: "Post moves, rim protection and rebounding position.",
    boosts: { postControl: 3, closeShot: 2, block: 2, defReb: 2 },
    exposure: 0.4,
  },
  {
    id: "defense",
    name: "Lockdown Defense Camp",
    blurb: "Stance, closeouts and help rotations.",
    boosts: { perimeterD: 3, interiorD: 2, steal: 2, hustle: 1 },
    exposure: 0.4,
  },
  {
    id: "athletic",
    name: "Speed and Strength Camp",
    blurb: "Weight room, sprints and plyometrics.",
    boosts: { strength: 3, speed: 2, accel: 2, vertical: 2, stamina: 1 },
    exposure: 0.3,
  },
  {
    id: "elite",
    name: "Elite 100 Camp",
    blurb: "The country's top prospects, with college coaches watching every drill.",
    boosts: { iq: 2, clutch: 2, layup: 1, three: 1, perimeterD: 1 },
    exposure: 1.5,
    inviteRank: 300,
  },
];

export const campDate = (year: number) => iso(year + 1, 6, 16);
export const showcaseDates = (year: number): IsoDate[] => [iso(year + 1, 7, 11), iso(year + 1, 7, 12), iso(year + 1, 7, 14)];

export function campsFor(c: Career) {
  const rank = c.hs.seasons.at(-1)?.ranking?.national ?? null;
  return CAMPS.map((camp) => ({ ...camp, invited: !camp.inviteRank || (rank !== null && rank <= camp.inviteRank) }));
}

/** Applies a camp: rating boosts (never past caps), a little XP and exposure. */
export function attendCamp(c: Career, campId: string): Career {
  const s = c.hs.seasons.at(-1)!;
  const camp = CAMPS.find((x) => x.id === campId)!;
  const ratings = { ...c.player.ratings };
  for (const [k, v] of Object.entries(camp.boosts) as [RatingKey, number][]) ratings[k] = Math.min(c.player.caps[k], ratings[k] + v);
  const summer = { ...(s.summer ?? {}), camp: { id: camp.id, name: camp.name, boosts: camp.boosts, exposure: camp.exposure } };
  const date = campDate(s.year);
  return {
    ...c,
    date: date > c.date ? date : c.date,
    player: { ...c.player, ratings },
    hs: { ...c.hs, seasons: [...c.hs.seasons.slice(0, -1), { ...s, summer }] },
    log: [...c.log, { date, text: `Attended the ${camp.name}.`, kind: "milestone" }],
  };
}

const CLUB_NAMES = [
  "Arizona Elite",
  "Desert Heat",
  "Valley Kings",
  "Grand Canyon Select",
  "Sonoran Storm",
  "Saguaro Hoops",
  "Copper State Prep",
  "Phoenix Rise",
];
const OPP_CLUBS = [
  "Texas Titans",
  "SoCal Supreme",
  "Bay Area Hoopers",
  "Nevada Rebels Club",
  "Utah Prospects",
  "Colorado Summit",
  "New Mexico Lobos Club",
  "Oregon Rain",
  "Chicago Hustle",
  "Atlanta Pressure",
];

function clubTeam(name: string, rng: Rng, prestige: number): Team {
  const palette = [
    ["#0b3d91", "#ffb627", "#ffffff"],
    ["#8b1e3f", "#f2f5f8", "#111111"],
    ["#0f5132", "#f2c14e", "#ffffff"],
    ["#2b2d42", "#ef233c", "#edf2f4"],
    ["#5a189a", "#ffd60a", "#ffffff"],
    ["#d35400", "#1b1b1b", "#ffffff"],
  ][rng.int(0, 5)];
  const words = name.split(" ");
  return {
    id: `aau-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`,
    league: "hs",
    name: words.slice(0, -1).join(" ") || name,
    nickname: words.at(-1)!,
    abbrev: words
      .map((w) => w[0])
      .join("")
      .slice(0, 3)
      .toUpperCase(),
    city: "Phoenix",
    state: "AZ",
    colors: { primary: palette[0], secondary: palette[1], accent: palette[2] },
    logo: {
      shape: rng.pick(["shield", "circle", "hex", "diamond"] as const),
      icon: rng.pick(["star", "flame", "bolt", "crown"] as const),
      monogram: words
        .map((w) => w[0])
        .join("")
        .slice(0, 2),
      stripe: rng.chance(0.5),
    },
    conferenceId: "aau",
    tier: "6A",
    prestige,
    arena: { name: "Showcase Court 3", capacity: 600 },
    levels: ["varsity"],
  };
}

/** The club you play for and its roster (strength scales with how good you are and the circuit). */
export function clubRoster(team: Team, target: number, year: number, gradeOfUser: number): Player[] {
  const rng = new Rng(`${team.id}:${year}:roster`);
  const slots: Position[] = ["PG", "SG", "SF", "PF", "C", "SG", "SF", "PF", "PG", "C"];
  const players = slots.map((pos, i) =>
    generatePlayer(rng, {
      pos,
      targetOvr: clamp(Math.round(target - (i < 5 ? 0 : 5) + rng.normal(0, 3)), 30, 90),
      age: 14 + (gradeOfUser - 9) + 1,
      league: "hs",
      teamId: team.id,
      classYear: (["FR", "SO", "JR", "SR"] as const)[Math.min(3, gradeOfUser - 9 + 1)],
      hometownPool: team.id.includes("arizona") || team.id.includes("desert") ? "az" : "us",
      idPrefix: `${team.id}-${year}`,
    }),
  );
  assignJerseys(rng, players);
  return players;
}

export interface Showcase {
  club: Team;
  opponents: Team[];
  elite: boolean;
  target: number;
}

/** The AAU setup for this summer, deterministic for the career and year. */
export function showcaseFor(c: Career, s: HsSeason): Showcase {
  const rng = new Rng(`${c.seed}:aau:${s.year}`);
  const elite = (s.ranking?.national ?? 9999) <= 1200;
  const club = clubTeam(rng.pick(CLUB_NAMES), rng, elite ? 0.8 : 0.5);
  const opponents = rng
    .shuffle([...OPP_CLUBS])
    .slice(0, 3)
    .map((n) => clubTeam(n, rng, elite ? 0.8 : 0.5));
  // talent: varsity-level players for your age, better on the elite circuit
  const target = 44 + (s.grade - 9) * 5 + (elite ? 8 : 0);
  return { club, opponents, elite, target };
}

export function scheduleShowcase(c: Career): Career {
  const s = c.hs.seasons.at(-1)!;
  const sc = showcaseFor(c, s);
  const games: ScheduledGame[] = showcaseDates(s.year).map((date, i) => ({
    id: `aau-${s.year}-${i}`,
    date,
    level: "varsity",
    homeId: i % 2 ? sc.opponents[i].id : sc.club.id,
    awayId: i % 2 ? sc.club.id : sc.opponents[i].id,
    kind: "scrimmage",
    label: `${sc.elite ? "Elite circuit" : "Summer showcase"} game ${i + 1}`,
    neutral: true,
  }));
  const summer = { ...(s.summer ?? {}), club: { name: `${sc.club.name} ${sc.club.nickname}`, elite: sc.elite }, showcase: games };
  return { ...c, hs: { ...c.hs, seasons: [...c.hs.seasons.slice(0, -1), { ...s, summer }] } };
}

/** Exposure from a showcase game: how much college coaches noticed (0..1). */
export const showcaseExposure = (gameScore: number, elite: boolean) => clamp((gameScore + 2) / 22, 0, 1) * (elite ? 1 : 0.6);
