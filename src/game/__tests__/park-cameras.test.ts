// Every camera at every park: the same sweep as cameras.test.ts (all modes, zoom and height extremes, the ball
// all over the floor, free throws and every replay camera) against each park's Blender world, plus the
// edge-of-the-map check: no camera may ever see past the end of the world.
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { boardX, courtFor, type CourtSpec, rimPos } from "@/game/court";
import type { CameraMode } from "@/state/settings";
import { CAMERA_HEIGHT, CAMERA_ZOOM, type CameraPose, constrainPose, followPose, freeThrowPose, replayPose } from "@/game3d/cameraPose";
import { REPLAY_CAMS } from "@/game3d/replay";
import { PARKS } from "@/game/park/parks";
import { PARK_VENUE, PARK_WORLD } from "@/game3d/park/world";

const NEAR = 0.6;
const BLOCK = 1.5;
const MODES: CameraMode[] = ["broadcast", "2k", "low", "baseline", "player", "skycam"];
/** The widest screen we design for (ultrawide monitors see the most to the sides). */
const ASPECT = 21 / 9;

interface World {
  all: number[];
  /** The near terrain (it isn't solid for cameras, but it must stay under the court). */
  ground: number[];
  opaque: number[];
  /** Radius the terrain actually reaches (from the GLB), in every direction. */
  groundRadius: number;
  /** Height of the terrain the cameras look out over. */
  groundY: number;
}
const worlds = new Map<string, World>();

async function loadPark(id: string): Promise<World> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const doc = await io.read(path.join("public/models/parks", `${id}.glb`));
  const all: number[] = [];
  const opaque: number[] = [];
  const ground: number[] = [];
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  let groundRadius = Infinity;
  let groundY = 0;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    m.fromArray(node.getWorldMatrix());
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? "";
      const pos = prim.getAttribute("POSITION")!;
      const idx = prim.getIndices()?.getArray();
      const count = idx ? idx.length : pos.getCount();
      const el: number[] = [];
      // the far terrain: the smallest distance its outer rim reaches is how far the world goes
      if (/^(Desert|Sand|Grass|Asphalt|DirtGrass)_Far$/.test(name)) {
        let rim = 0,
          ys = 0,
          n = 0;
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, el);
          const p = new THREE.Vector3(el[0], el[1], el[2]).applyMatrix4(m);
          pts.push(p);
          rim = Math.max(rim, Math.hypot(p.x, p.z));
        }
        // outer ring vertices: within 1% of the max radius; the world reaches the closest of them... and the
        // straight edges between them (a polygon's inscribed radius)
        const ring = pts.filter((p) => Math.hypot(p.x, p.z) > rim * 0.99);
        const inscribed = rim * Math.cos(Math.PI / Math.max(3, ring.length));
        groundRadius = Math.min(groundRadius, inscribed);
        for (const p of pts) if (Math.hypot(p.x, p.z) < 400) ((ys += p.y), n++);
        groundY = n ? ys / n : groundY;
        continue;
      }
      // the terrain and the sky are never in a camera's way; the fence is see-through
      if (/^(Desert|Sand|Grass|Asphalt|DirtGrass|Water|Mountain)/.test(name)) {
        if (!name.startsWith("Mountain"))
          for (let i = 0; i < count; i++) {
            pos.getElement(idx ? idx[i] : i, el);
            v.set(el[0], el[1], el[2]).applyMatrix4(m);
            ground.push(v.x, v.y, v.z);
          }
        continue;
      }
      const chain = name === "ChainLink";
      for (let i = 0; i < count; i++) {
        pos.getElement(idx ? idx[i] : i, el);
        v.set(el[0], el[1], el[2]).applyMatrix4(m);
        all.push(v.x, v.y, v.z);
        if (!chain) opaque.push(v.x, v.y, v.z);
      }
    }
  }
  return { all, opaque, ground, groundRadius, groundY };
}

function boxTris(out: number[], c: [number, number, number], s: [number, number, number]) {
  const g = new THREE.BoxGeometry(...s).translate(...c).toNonIndexed();
  out.push(...(g.getAttribute("position").array as Float32Array));
}

/** Hoops (outdoor poles) and the crowd, mirroring Hoop.tsx and Spectators.tsx. */
function extras(id: string, court: CourtSpec) {
  const out: number[] = [];
  const spots = JSON.parse(fs.readFileSync(path.join("public/models/parks", `${id}.spots.json`), "utf8")) as Record<string, number[]>;
  for (const [kind, a] of Object.entries(spots)) {
    if (!Array.isArray(a)) continue;
    // a cheering spectator, arms up
    for (let i = 0; i < a.length; i += 4)
      boxTris(out, [a[i] / 100, a[i + 1] / 100 + (kind === "sit" ? 0.7 : 1.0), a[i + 2] / 100], [0.55, kind === "sit" ? 1.4 : 2.0, 0.55]);
  }
  for (const side of [1, -1] as const) {
    const bx = boardX(court, side);
    boxTris(out, [bx, court.boardBottom + court.boardHeight / 2, 0], [0.06, court.boardHeight, court.boardWidth]);
    boxTris(out, [bx + side * 1.15, (court.boardBottom + court.boardHeight * 0.5) / 2, 0], [0.22, court.boardBottom + court.boardHeight * 0.5, 0.22]);
  }
  return out;
}

function bvh(tris: number[], extra: number[]) {
  const arr = new Float32Array(tris.length + extra.length);
  arr.set(tris);
  arr.set(extra, tris.length);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
  return new MeshBVH(g);
}

function allPoses(court: CourtSpec): { label: string; pose: CameraPose }[] {
  const out: { label: string; pose: CameraPose }[] = [];
  const zooms = [CAMERA_ZOOM.min, 1, CAMERA_ZOOM.max];
  const heights = [CAMERA_HEIGHT.min, 1, CAMERA_HEIGHT.max];
  const xs = Array.from({ length: 7 }, (_, i) => -court.halfL + (i * 2 * court.halfL) / 6);
  const zs = [-court.halfW, 0, court.halfW];
  for (const mode of MODES)
    for (const zoom of zooms)
      for (const h of heights)
        for (const side of [1, -1] as const)
          for (const x of xs)
            for (const z of zs)
              out.push({
                label: `${mode} z${zoom} h${h} side${side} ball(${x.toFixed(1)},${z.toFixed(1)})`,
                pose: followPose(mode, zoom, h, court, { x, z }, side, { x, z }),
              });
  for (const fs of [1, -1] as const)
    out.push({ label: `free throw ${fs}`, pose: freeThrowPose(court, { x: fs * (court.halfL - court.ftLineFromBaseline), z: 0 }, fs) });
  for (const { id } of REPLAY_CAMS)
    for (const side of [1, -1] as const)
      for (const x of xs)
        for (const z of zs)
          for (let a = 0; a < Math.PI * 2; a += id === "orbit" ? Math.PI / 6 : 7)
            out.push({
              label: `replay ${id} rim${side} at(${x.toFixed(1)},${z.toFixed(1)}) a${a.toFixed(2)}`,
              pose: replayPose(id, court, { x, z, y: 0 }, { x, z }, rimPos(court, side).x, a),
            });
  return out;
}

/** Directions through the edges and corners of the frame (and its center). */
function frameRays(p: CameraPose) {
  const cam = new THREE.PerspectiveCamera(p.fov, ASPECT, 0.5, PARK_WORLD.cameraFar);
  cam.position.copy(p.pos);
  cam.lookAt(p.look);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  const dirs: THREE.Vector3[] = [];
  for (const sx of [-1, -0.5, 0, 0.5, 1])
    for (const sy of [-1, -0.5, 0, 0.5, 1]) {
      const d = new THREE.Vector3(sx, sy, 0.5).unproject(cam).sub(cam.position).normalize();
      dirs.push(d);
    }
  return dirs;
}

const court = courtFor("hs");

describe("park worlds have no edge a camera can see", () => {
  it("the world's numbers close the horizon", () => {
    const maxCam = Math.hypot(PARK_VENUE.interior.x, PARK_VENUE.interior.z);
    // the sky dome (which travels with the camera) is always inside the far plane
    expect(PARK_WORLD.skyRadius).toBeLessThan(PARK_WORLD.cameraFar);
    // the terrain's edge is always beyond the far plane, wherever the camera is
    expect(PARK_WORLD.groundRadius).toBeGreaterThan(PARK_WORLD.cameraFar + maxCam);
    // anything far enough to be clipped is already fully fogged into the horizon color
    expect(PARK_WORLD.fogFar).toBeLessThan(PARK_WORLD.cameraFar - maxCam);
    expect(PARK_WORLD.fogNear).toBeLessThan(PARK_WORLD.fogFar);
  });
});

describe("park worlds leave the court to the engine", () => {
  beforeAll(async () => {
    await MeshoptDecoder.ready;
    for (const p of PARKS) if (!worlds.has(p.id)) worlds.set(p.id, await loadPark(p.id));
  });
  for (const park of PARKS)
    it(`${park.name}: nothing in the model sits on top of the court`, () => {
      const w = worlds.get(park.id)!;
      const over: string[] = [];
      // the court surface is drawn at y = 0.006; the ground under it must stay below that
      const tris = [...w.all, ...w.ground];
      for (let i = 0; i < tris.length; i += 9) {
        // any corner of the triangle over the court (terrain triangles are big)
        const cx = (tris[i] + tris[i + 3] + tris[i + 6]) / 3,
          cy = Math.max(tris[i + 1], tris[i + 4], tris[i + 7]),
          cz = (tris[i + 2] + tris[i + 5] + tris[i + 8]) / 3;
        if (Math.abs(cx) < court.halfL + 2.4 && Math.abs(cz) < court.halfW + 2 && cy > 0.003 && cy < 2.0)
          over.push(`(${cx.toFixed(1)}, ${cy.toFixed(3)}, ${cz.toFixed(1)})`);
      }
      expect(over.slice(0, 3), `${over.length} triangles over the court`).toEqual([]);
    });
});

describe("park cameras", () => {
  beforeAll(async () => {
    await MeshoptDecoder.ready;
    for (const p of PARKS) worlds.set(p.id, await loadPark(p.id));
  });

  for (const park of PARKS)
    it(`${park.name}: every camera stays clear of the world and never sees its edge`, () => {
      const w = worlds.get(park.id)!;
      expect(w.groundRadius, "terrain reaches past the far plane").toBeGreaterThan(
        PARK_WORLD.cameraFar + Math.hypot(PARK_VENUE.interior.x, PARK_VENUE.interior.z),
      );
      const ex = extras(park.id, court);
      const all = bvh(w.all, ex);
      const opaque = bvh(w.opaque, ex);
      const ray = new THREE.Ray();
      const hit = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
      const failures = new Map<string, string>();
      const note = (kind: string, msg: string) => {
        if (!failures.has(kind)) failures.set(kind, msg);
      };
      for (const { label, pose } of allPoses(court)) {
        const p = constrainPose(PARK_VENUE, court, pose);
        const kind = label
          .split(" ")
          .slice(0, label.startsWith("replay") ? 2 : 1)
          .join(" ");
        const near = all.closestPointToPoint(p.pos, hit, 0, NEAR);
        if (near && near.distance < NEAR)
          note(
            `${kind} (near)`,
            `${label}: ${near.distance.toFixed(2)} m from geometry at (${p.pos.x.toFixed(1)}, ${p.pos.y.toFixed(1)}, ${p.pos.z.toFixed(1)})`,
          );
        const d = p.look.clone().sub(p.pos);
        const len = d.length();
        ray.set(p.pos, d.normalize());
        const first = opaque.raycastFirst(ray, THREE.DoubleSide);
        if (first && first.distance < Math.min(BLOCK, len * 0.5))
          note(
            `${kind} (view)`,
            `${label}: view blocked ${first.distance.toFixed(1)} m out at (${p.pos.x.toFixed(1)}, ${p.pos.y.toFixed(1)}, ${p.pos.z.toFixed(1)})`,
          );
        // the edge of the map: every ray that heads down has to land on terrain inside the world (or go past
        // the far plane, where the clipped terrain is fogged into the sky); rays that head up meet the sky dome
        for (const dir of frameRays(p)) {
          if (dir.y >= 0) continue;
          const t = (p.pos.y - w.groundY) / -dir.y;
          if (t >= PARK_WORLD.cameraFar) continue;
          const x = p.pos.x + dir.x * t,
            z = p.pos.z + dir.z * t;
          if (Math.hypot(x, z) > w.groundRadius) note(`${kind} (edge)`, `${label}: sees past the terrain at (${x.toFixed(0)}, ${z.toFixed(0)})`);
        }
      }
      expect([...failures.values()], `${park.name}`).toEqual([]);
    });
});
