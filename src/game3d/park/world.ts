// The park world's size, shared by the scene (ParkScene.tsx) and the camera test (src/game/__tests__/cameras.test.ts).
import type { VenueVariant } from "../arena/variants";

/**
 * The park world is closed by construction, so no camera can ever see past its edge:
 *  - the terrain reaches `groundRadius` in every direction, farther than the camera can see (`cameraFar`),
 *    so its edge is always clipped away;
 *  - the sky dome follows the camera and sits inside the far plane, so it is behind everything, everywhere;
 *  - fog reaches the horizon color by `fogFar`, before anything can be clipped, so distant mountains and
 *    buildings melt into the sky instead of being cut off.
 * src/game/__tests__/cameras.test.ts checks these against every camera pose and the actual terrain.
 */
export const PARK_WORLD = { groundRadius: 2600, cameraFar: 2500, skyRadius: 2200, fogNear: 160, fogFar: 2300 };

/** The camera's box for an open-air court (no stands or roof to stay out of). */
export const PARK_VENUE: VenueVariant = {
  id: "park",
  kind: "park",
  label: "Park",
  native: "hs",
  tiers: [],
  walls: { x: 40, z: 34 },
  ceiling: 60,
  girderY: 0,
  interior: { x: 38, z: 34, y: 40 },
  lightY: 9,
  style: { wall: "#000000", scoreboards: "wall", adBoards: false, banners: 0 },
};
