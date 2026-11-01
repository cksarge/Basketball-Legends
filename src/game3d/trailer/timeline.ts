// The main menu trailer: a fixed shot list, so it plays the same way every time.
// Everything here is plain math, so the staging can be tested without a screen.

export type ShotId = "break" | "dunk" | "interview" | "park" | "halfcourt" | "legend";

export interface Shot {
  id: ShotId;
  /** Seconds on screen. */
  duration: number;
  /** Crowd energy (0..1). */
  crowd: number;
  /** How bright the house lights are (0..1). */
  lights: number;
}

export const SHOTS: Shot[] = [
  { id: "break", duration: 4.2, crowd: 0.6, lights: 1 },
  { id: "dunk", duration: 4.4, crowd: 1, lights: 1 },
  { id: "interview", duration: 6, crowd: 0.35, lights: 0.8 },
  { id: "park", duration: 5.6, crowd: 0.5, lights: 1 },
  { id: "halfcourt", duration: 7.4, crowd: 0.5, lights: 1 },
  { id: "legend", duration: 8.4, crowd: 0.8, lights: 0.1 },
];

export const LOOP = SHOTS.reduce((a, s) => a + s.duration, 0);
/** Seconds each cut takes to fade through black. */
export const FADE = 0.3;

/** Which shot is on screen at a time in the loop, and how far into it. */
export function shotAt(time: number) {
  let t = ((time % LOOP) + LOOP) % LOOP;
  for (let index = 0; index < SHOTS.length; index++) {
    if (t < SHOTS[index].duration) return { index, shot: SHOTS[index], local: t };
    t -= SHOTS[index].duration;
  }
  return { index: 0, shot: SHOTS[0], local: 0 };
}

/** Black over the picture at the head and tail of each shot (0 clear, 1 black). */
export function fadeAt(local: number, duration: number) {
  return Math.max(0, 1 - Math.min(local, duration - local) / FADE);
}

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const smooth = (v: number) => {
  const k = clamp01(v);
  return k * k * (3 - 2 * k);
};

export type Vec3 = [number, number, number];

/** A ball in flight: straight across the floor, up and over in a parabola. */
export function ballArc(from: Vec3, to: Vec3, apex: number, k: number): Vec3 {
  const t = clamp01(k);
  const h = apex - Math.max(from[1], to[1]);
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t + 4 * h * t * (1 - t), from[2] + (to[2] - from[2]) * t];
}

/** The dribble: the ball drops from the hand and comes back up. */
export const dribbleHeight = (local: number, beat = 2.4) => 0.12 + 0.82 * Math.abs(Math.cos(local * beat * Math.PI));

export interface Camera {
  pos: Vec3;
  look: Vec3;
  fov: number;
}

/** Where the half-court shot leaves the hand, and when. */
export const HALFCOURT = { release: 1.5, flight: 3, hero: [0, 0, 0] as Vec3, apex: 8.2 };
export const PARK_SHOT = { start: 0.6, release: 1.15, flight: 1.5 };

/** The camera for every shot. `rim` is the near basket; `ball` and `hero` are where they are this frame. */
export function cameraFor(id: ShotId, local: number, rim: Vec3, hero: Vec3, ball: Vec3): Camera {
  // a little life in the hand-held shots
  const shake: Vec3 = [Math.sin(local * 2.1) * 0.04, Math.sin(local * 3.3) * 0.03, Math.cos(local * 1.7) * 0.04];
  switch (id) {
    case "break":
      // alongside the ball, low, with the crowd streaking behind
      return { pos: [hero[0] - 2.6 + shake[0], 0.7 + shake[1], -6.2 + shake[2]], look: [hero[0] + 0.7, 1.2, hero[2]], fov: 30 };
    case "dunk":
      return { pos: [rim[0] - 3.4 - local * 0.08, 0.5, -3.6 + local * 0.1], look: [rim[0] - 0.4, 2.75, 0], fov: 34 };
    case "interview":
      // from the waist up, over the reporter's microphone
      return { pos: [3.5, 1.5, 5.3 - local * 0.14], look: [3, 1.5, 2], fov: 26 };
    case "park":
      return { pos: [hero[0] - 2.8 + local * 0.2, 0.55, hero[2] + 2.6], look: [hero[0] + 3.2, 2.5, hero[2] - 0.8], fov: 42 };
    case "halfcourt": {
      if (local < HALFCOURT.release) return { pos: [-4.6 + local * 0.6, 1, 1.1], look: [0.6, 1.8, 0], fov: 34 };
      // alongside the ball in flight, then waiting at the rim as it comes down
      const k = smooth((local - HALFCOURT.release) / HALFCOURT.flight);
      const at: Vec3 = [rim[0] - 4.2, 3, -4.6];
      const follow: Vec3 = [ball[0] - 2.5, Math.max(1.6, ball[1] - 1.1), -7.2];
      return {
        pos: [follow[0] + (at[0] - follow[0]) * k, follow[1] + (at[1] - follow[1]) * k, follow[2] + (at[2] - follow[2]) * k],
        look: [ball[0] + (rim[0] - ball[0]) * k * k * k, ball[1] + (rim[1] - ball[1]) * k * k * k, 0],
        fov: 34 - k * 6,
      };
    }
    case "legend": {
      const k = smooth(local / 8);
      const a = 2.6 + k * 0.9;
      const r = 3.8 + k * 5;
      return { pos: [Math.sin(a) * r, 1 + k * 3.6, Math.cos(a) * r], look: [0, 1.25, 0], fov: 32 };
    }
  }
}

/** Where the hero is on the shots that move the camera with them. */
export const breakHeroX = (local: number) => -9 + local * 5.2;
export const parkHero = (rim: Vec3): Vec3 => [rim[0] - 6.6, 0, 1.8];

/** The half-court shot's ball, for following it in flight. */
export function halfcourtBall(local: number, rim: Vec3): Vec3 {
  const k = (local - HALFCOURT.release) / HALFCOURT.flight;
  if (k <= 0) return [0.3, 2, 0];
  return k < 1 ? ballArc([0.35, 2.4, 0], rim, HALFCOURT.apex, k) : [rim[0], Math.max(0.12, rim[1] - (k - 1) * 3.2), 0];
}

/** Every camera the trailer uses, sampled across each shot, for the camera checks. */
export function trailerCameras(arenaRim: Vec3, parkRim: Vec3) {
  const out: { id: ShotId; t: number; cam: Camera }[] = [];
  for (const s of SHOTS) {
    const rim = s.id === "park" ? parkRim : arenaRim;
    for (let t = 0; t <= s.duration; t += 0.1) {
      const hero: Vec3 = s.id === "break" ? [breakHeroX(t), 0, 0.4] : s.id === "park" ? parkHero(rim) : [0, 0, 0];
      out.push({ id: s.id, t, cam: cameraFor(s.id, t, rim, hero, s.id === "halfcourt" ? halfcourtBall(t, rim) : [0, 1, 0]) });
    }
  }
  return out;
}
