// Where every camera sits, as pure functions shared by the live camera (CameraRig), the
// replay director (GameScene) and the venue collision test (src/game/__tests__/cameras.test.ts).
import * as THREE from "three";
import { boardX, type CourtSpec } from "@/game/court";
import type { CameraMode } from "@/state/settings";
import type { ReplayCam } from "./replay";
import { FLOOR_MARGIN, floorSize } from "./courtTexture";
import { type VenueVariant, venueCeiling, venueClearance, venueInterior } from "./arena/variants";

export interface CameraPose {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

export const CAMERA_ZOOM = { min: 0.7, max: 1.4 };
export const CAMERA_HEIGHT = { min: 0.6, max: 1.5 };

/** Gameplay camera following the ball (and, for the player cam, the user's player). */
export function followPose(
  mode: CameraMode,
  zoom: number,
  heightMul: number,
  c: CourtSpec,
  ball: { x: number; z: number },
  side: 1 | -1,
  ag: { x: number; z: number } | null,
): CameraPose {
  // follow the ball, biased toward the basket being attacked
  const fx = THREE.MathUtils.clamp(ball.x * 0.82 + side * 2.2, -c.halfL + 3, c.halfL - 3);
  const fz = THREE.MathUtils.clamp(ball.z * 0.25, -3, 3);
  switch (mode) {
    case "2k":
      return { look: new THREE.Vector3(fx, 1.2, fz * 1.4), pos: new THREE.Vector3(fx * 0.92, 7.5 * heightMul, c.halfW + 13 / zoom), fov: 38 / zoom };
    case "low":
      // courtside, just behind the near ad boards, at about eye level over them
      return { look: new THREE.Vector3(fx, 1.3, fz * 0.6), pos: new THREE.Vector3(fx * 0.85, 2.3 * heightMul, c.halfW + 3.35), fov: 46 / zoom };
    case "baseline":
      return {
        look: new THREE.Vector3(side * (c.halfL - 4), 1.4, ball.z * 0.4),
        pos: new THREE.Vector3(-side * (c.halfL + 6 / zoom), 6 * heightMul, ball.z * 0.3),
        fov: 45 / zoom,
      };
    case "player":
      if (ag)
        return {
          pos: new THREE.Vector3(ag.x - (side * 6.5) / zoom, 3.8 * heightMul, ag.z * 0.85),
          look: new THREE.Vector3(ag.x + side * 6, 1.4, ag.z * 0.6),
          fov: 50,
        };
      return { look: new THREE.Vector3(fx, 1.2, fz), pos: new THREE.Vector3(fx, 9, c.halfW + 18), fov: 32 / zoom };
    case "skycam":
      // over the near sideline, outside the halo board's ring and inside the catwalk ring
      return { look: new THREE.Vector3(fx, 0, fz), pos: new THREE.Vector3(fx - side * 2, (22 * heightMul) / zoom, c.halfW + 2.8), fov: 45 };
    default:
      return { look: new THREE.Vector3(fx, 1.1, fz), pos: new THREE.Vector3(fx * 0.85, 9.5 * heightMul, c.halfW + 17 / zoom), fov: 30 / zoom };
  }
}

/** Breaks: looking in on a team huddle at `spot` (huddleSpot's centre). */
export function huddlePose(spot: { cx: number; cz: number }): CameraPose {
  // from the centre-court side, so the camera never ends up under a basket
  const s = Math.sign(spot.cx) || 1;
  return { pos: new THREE.Vector3(spot.cx - s * 2.5, 3.0, spot.cz + 7.5), look: new THREE.Vector3(spot.cx, 1.2, spot.cz), fov: 36 };
}

/** Free throws: behind and beside the shooter, looking at the rim. */
export function freeThrowPose(c: CourtSpec, shooter: { x: number; z: number }, fs: 1 | -1): CameraPose {
  return {
    pos: new THREE.Vector3(shooter.x - fs * 6.5, 2.6, shooter.z + 4.5),
    look: new THREE.Vector3(fs * (c.halfL - c.rimFromBaseline), 2.4, 0),
    fov: 40,
  };
}

/**
 * Replay cameras. `t` is the framed player (or ball), `b` the ball, `rimX` the basket the
 * framed team attacks, `orbit` the orbit camera's running angle.
 */
export function replayPose(
  cam: ReplayCam,
  c: CourtSpec,
  t: { x: number; z: number; y: number },
  b: { x: number; z: number },
  rimX: number,
  orbit: number,
): CameraPose {
  const sign = Math.sign(rimX) || 1;
  const look = new THREE.Vector3(t.x * 0.6 + b.x * 0.4, 1.3 + t.y * 0.6, t.z * 0.6 + b.z * 0.4);
  switch (cam) {
    case "orbit": {
      const a = orbit + (sign > 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
      // circles on the floor: near the corners it tightens instead of swinging into the front rows
      const f = floorSize(c);
      const x = THREE.MathUtils.clamp(t.x + Math.sin(a) * 6.5, -f.w / 2 + 0.4, f.w / 2 - 0.4);
      const z = THREE.MathUtils.clamp(t.z + Math.cos(a) * 6.5, -f.h / 2 + 0.4, f.h / 2 - 0.4);
      return { pos: new THREE.Vector3(x, 2.4, z), look, fov: 40 };
    }
    case "baseline":
      return { pos: new THREE.Vector3(sign * (c.halfL + 3.5), 2.1, t.z * 0.4), look, fov: 34 };
    case "rim":
      return { pos: new THREE.Vector3(rimX - sign * 0.8, 6.2, 1.8), look: look.set(t.x * 0.5 + rimX * 0.5, 1.2, t.z * 0.5), fov: 50 };
    case "courtside":
      // on the near apron in front of the ad boards (the far side has the benches and table)
      return { pos: new THREE.Vector3(t.x - sign * 2.5, 1.25, c.halfW + FLOOR_MARGIN.z * 0.8), look, fov: 36 };
    default:
      return { pos: new THREE.Vector3(b.x * 0.85, 9.5, c.halfW + 17), look: look.set(b.x, 1.1, b.z * 0.25), fov: 30 };
  }
}

const tmp = new THREE.Vector3();

/**
 * Keep a camera out of the stands and inside the building. When the camera has to be pulled
 * in, the lens widens so the shot keeps its framing. Returns a new pose.
 */
export function constrainPose(venue: VenueVariant, c: CourtSpec, pose: CameraPose): CameraPose {
  const pos = pose.pos.clone();
  let fov = pose.fov;
  const before = pos.distanceTo(pose.look);
  const box = venueInterior(venue, c);
  pos.x = THREE.MathUtils.clamp(pos.x, -box.x, box.x);
  pos.z = THREE.MathUtils.clamp(pos.z, -box.z, box.z);
  pos.y = Math.min(Math.max(pos.y, venueClearance(venue, c, pos.x, pos.y, pos.z)), venueCeiling(venue, pos.z));
  clearBaskets(venue, c, pos);
  clearParkFence(venue, pos);
  const after = Math.max(1, pos.distanceTo(pose.look));
  if (after < before - 1e-3) fov = Math.min(75, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * (before / after))));
  return { pos, look: pose.look, fov };
}

/**
 * Keep the lens off the backboards and their supports: a camera that wanders onto a basket
 * (player cam near the baseline, low presets) rises over the top of the board.
 */
function clearBaskets(venue: VenueVariant, c: CourtSpec, pos: THREE.Vector3) {
  for (const side of [1, -1] as const) {
    const bx = boardX(c, side);
    const top = c.boardBottom + c.boardHeight;
    // the board, its shot clock and the arm/pole behind it, plus room behind so a camera
    // never sits right up against the back of the board
    const behind = (venue.kind === "gym" ? 0.6 : 2.6) + 1.0;
    const lo = Math.min(bx - side * 0.7, bx + side * behind),
      hi = Math.max(bx - side * 0.7, bx + side * behind);
    // in gyms the drop pipe runs all the way up to the girder
    const ceil = venue.kind === "gym" ? venue.girderY + 0.8 : top + 1.2;
    if (pos.x > lo && pos.x < hi && Math.abs(pos.z) < c.boardWidth / 2 + 0.8 && pos.y < ceil) {
      // gyms: move sideways off the pipe; arenas: rise over the board
      if (venue.kind === "gym") pos.z = Math.sign(pos.z || 1) * (c.boardWidth / 2 + 0.8);
      else pos.y = top + 1.2;
    }
  }
}

/** The same limits for a point in flight between two targets (no lens change). */
export function constrainPoint(venue: VenueVariant, c: CourtSpec, p: THREE.Vector3) {
  const box = venueInterior(venue, c);
  tmp.set(THREE.MathUtils.clamp(p.x, -box.x, box.x), 0, THREE.MathUtils.clamp(p.z, -box.z, box.z));
  tmp.y = Math.min(Math.max(p.y, venueClearance(venue, c, tmp.x, p.y, tmp.z)), venueCeiling(venue, tmp.z));
  clearBaskets(venue, c, tmp);
  clearParkFence(venue, tmp);
  return p.copy(tmp);
}

/**
 * Parks: the end fences stand just past the baselines (15.4 m from center court at the cage, 16.2 m elsewhere,
 * up to 10.8 m to each side). A camera never parks in the wire: it steps back outside the fence and looks
 * through it.
 */
export const PARK_FENCE_SLAB = { from: 14.7, to: 17.7, halfZ: 11.5, farZ: -9.0, overY: 6.5 };
function clearParkFence(venue: VenueVariant, pos: THREE.Vector3) {
  if (venue.kind !== "park") return;
  // the far fence has spectators packed against it: low cameras (replay orbits) stay on the court side of it
  if (pos.z < PARK_FENCE_SLAB.farZ && pos.y < PARK_FENCE_SLAB.overY) pos.z = PARK_FENCE_SLAB.farZ;
  const ax = Math.abs(pos.x);
  if (ax > PARK_FENCE_SLAB.from && ax < PARK_FENCE_SLAB.to && Math.abs(pos.z) < PARK_FENCE_SLAB.halfZ) pos.x = Math.sign(pos.x) * PARK_FENCE_SLAB.to;
}
