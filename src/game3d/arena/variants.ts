// Venue designs built in Blender (scripts/blender/build_arenas.py) from variants.json.
// This module picks the venue for a team and answers camera questions about it.
import spec from "./variants.json";
import type { Team } from "@/engine/types";
import { hashString } from "@/engine/rng";
import type { CourtSpec } from "@/game/court";
import { FLOOR_MARGIN, floorSize } from "../courtTexture";
import { asset } from "@/lib/site";

export type ArenaKind = "pro" | "college" | "gym";
export type SeatKind = "chair" | "backed" | "bench";

export interface BankTier {
  type: "bank";
  side: "near" | "far" | "left" | "right";
  rows: number;
  depth: number;
  rise: number;
  start: number;
  y0: number;
  length: number;
  seat: SeatKind;
}
export interface BowlTier {
  type: "bowl";
  rows: number;
  depth: number;
  rise: number;
  start: number;
  y0: number;
  radius: number;
  seat: SeatKind;
}
export type Tier = BankTier | BowlTier;

export interface VenueVariant {
  id: VariantId;
  kind: ArenaKind;
  label: string;
  native: "hs" | "pro";
  tiers: Tier[];
  walls: { x: number; z: number };
  ceiling: number;
  /** Underside of the roof structure the gym baskets hang from. */
  girderY: number;
  /** Box the camera must stay inside (half extents, before the X stretch): the walls, or in multi-deck venues the back of the lower bowl so it never drifts into suites or concourses. */
  interior: { x: number; z: number; y: number };
  lightY: number;
  style: {
    wall: string;
    scoreboards: "wall" | "video" | "centerSmall" | "center" | "videoBig" | "halo";
    adBoards: boolean;
    banners: number;
    stage?: boolean;
    roof?: "girders" | "joists" | "arch" | "flat";
    bleacher?: "wood" | "team";
  };
}

const VARIANTS = spec.variants as unknown as Record<string, Omit<VenueVariant, "id">>;
export type VariantId = "gym_small" | "gym_classic" | "gym_modern" | "college_fieldhouse" | "college_arena" | "pro_bowl" | "pro_modern";

export function variant(id: VariantId): VenueVariant {
  return { id, ...VARIANTS[id] } as VenueVariant;
}

export const ALL_VARIANTS = Object.keys(VARIANTS) as VariantId[];

/** The home team's venue at a given level: sized by its capacity, the rest chosen per team. */
export function pickVariant(kind: ArenaKind, team: Team): VariantId {
  const h = hashString(`venue:${team.id}`) % 100;
  const cap = team.arena.capacity;
  if (kind === "gym") {
    if (team.league === "hs") {
      if (cap < 1000) return "gym_small";
      if (cap >= 2600) return "gym_modern";
      return h < 65 ? "gym_classic" : "gym_modern";
    }
    return h < 34 ? "gym_small" : h < 67 ? "gym_classic" : "gym_modern";
  }
  if (kind === "college") {
    if (team.league === "college") {
      if (cap >= 9000) return "college_arena";
      if (cap < 5000) return "college_fieldhouse";
    }
    return h < 50 ? "college_fieldhouse" : "college_arena";
  }
  return h < 50 ? "pro_bowl" : "pro_modern";
}

export function venueUrl(id: VariantId) {
  return { glb: asset(`/models/arenas/${id}.glb`), seats: asset(`/models/arenas/${id}.seats.json`) };
}

function nativeHalf(v: VenueVariant) {
  const length = (v.native === "hs" ? 84 : 94) * 0.3048;
  return { fw2: length / 2 + FLOOR_MARGIN.x, fh2: 25 * 0.3048 + FLOOR_MARGIN.z };
}

/** X stretch that fits the venue around this court (1 on its native court). */
export function venueStretch(v: VenueVariant, court: CourtSpec) {
  return floorSize(court).w / 2 / nativeHalf(v).fw2;
}

const HEAD_ROOM = 2.6; // a fan jumping out of their seat, plus the near-plane margin

/**
 * Lowest the camera may sit at (x, z) without ending up inside a seating tier.
 * `y` is the camera's intended height: upper tiers only count when the camera is up at
 * their level (beneath them is open concourse).
 */
export function venueClearance(v: VenueVariant, court: CourtSpec, x: number, y: number, z: number) {
  const { fw2, fh2 } = nativeHalf(v);
  const lx = x / venueStretch(v, court);
  let min = 0;
  v.tiers.forEach((t, i) => {
    let d: number;
    if (t.type === "bowl") {
      d = Math.max(Math.abs(lx) - (fw2 + t.start), Math.abs(z) - (fh2 + t.start));
    } else {
      const along = t.side === "near" || t.side === "far" ? lx : z;
      if (Math.abs(along) > t.length / 2 + 0.6) return;
      const out = t.side === "near" ? z : t.side === "far" ? -z : t.side === "left" ? -lx : lx;
      d = out - ((t.side === "near" || t.side === "far" ? fh2 : fw2) + t.start);
      // behind the back row the camera still has to clear the top row's fans
    }
    // just short of the front row still counts: those fans are within arm's reach of the lens
    if (d <= -0.4) return;
    if (i > 0 && y < t.y0 - 1.3) return;
    // look one step up the rake: the fans in the row behind sit higher and right beside the lens
    const row = Math.min(t.rows - 1, Math.max(0, Math.floor((d + 0.8) / t.depth)));
    min = Math.max(min, t.y0 + row * t.rise + HEAD_ROOM);
  });
  return min;
}

/** Highest the camera may go at depth z: the interior box, or under the fieldhouse's arched trusses. */
export function venueCeiling(v: VenueVariant, z: number) {
  if (v.style.roof !== "arch") return v.interior.y;
  // matches build_arenas.py: a circular vault from the walls (girderY) to the apex (ceiling),
  // with the truss's bottom chord 1.6 m under the roof
  const rise = v.ceiling - v.girderY,
    Z = v.walls.z;
  const R = (Z * Z + rise * rise) / (2 * rise);
  const archY = v.ceiling - R + Math.sqrt(Math.max(0, R * R - z * z));
  return Math.min(v.interior.y, archY - 1.6 - 0.9);
}

/** Box (half extents) the camera must stay inside, stretched to this court. */
export function venueInterior(v: VenueVariant, court: CourtSpec) {
  const sx = venueStretch(v, court);
  return { x: v.interior.x * sx, y: v.interior.y, z: v.interior.z };
}
