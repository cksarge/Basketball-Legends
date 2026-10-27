// Every camera in every venue: sweeps the gameplay cameras (all modes, zoom and height
// extremes, the ball all over the floor, both directions), huddle and free-throw shots and
// all replay cameras through each Blender venue on both court lengths, and fails if a camera
// ends up within the near plane of any geometry or has something right in front of the lens.
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { boardX, BENCH_SEATS, benchSeat, courtFor, type CourtSpec, huddleSpot, rimPos } from "@/game/court";
import type { CameraMode } from "@/state/settings";
import { ALL_VARIANTS, variant, type VariantId, type VenueVariant, venueStretch } from "@/game3d/arena/variants";
import { CAMERA_HEIGHT, CAMERA_ZOOM, type CameraPose, constrainPose, followPose, freeThrowPose, huddlePose, replayPose } from "@/game3d/cameraPose";
import { REPLAY_CAMS } from "@/game3d/replay";
import { FLOOR_MARGIN } from "@/game3d/courtTexture";

const NEAR = 0.6; // camera near plane is 0.5 m
const BLOCK = 1.5; // an obstruction this close to the lens fills the shot
const MODES: CameraMode[] = ["broadcast", "2k", "low", "baseline", "player", "skycam"];

interface Solids {
  /** Everything a camera may not touch. */
  all: MeshBVH;
  /** Opaque geometry only (no glass), for line of sight. */
  opaque: MeshBVH;
}

const venueTris = new Map<VariantId, { all: number[]; opaque: number[] }>();

/** World-space triangles of the venue GLB (minus the seat models the engine instances). */
async function loadVenue(id: VariantId) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const doc = await io.read(path.join("public/models/arenas", `${id}.glb`));
  const all: number[] = [];
  const opaque: number[] = [];
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || node.getName().startsWith("SeatModel_")) continue;
    m.fromArray(node.getWorldMatrix());
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION")!;
      const idx = prim.getIndices()?.getArray();
      const glass = prim.getMaterial()?.getName() === "Glass";
      const count = idx ? idx.length : pos.getCount();
      const el: number[] = [];
      for (let i = 0; i < count; i++) {
        pos.getElement(idx ? idx[i] : i, el);
        v.set(el[0], el[1], el[2]).applyMatrix4(m);
        all.push(v.x, v.y, v.z);
        if (!glass) opaque.push(v.x, v.y, v.z);
      }
    }
  }
  return { all, opaque };
}

function boxTris(out: number[], c: [number, number, number], s: [number, number, number]) {
  const g = new THREE.BoxGeometry(...s).translate(...c).toNonIndexed();
  out.push(...(g.getAttribute("position").array as Float32Array));
}

/** Courtside furniture, hoops and the crowd, mirroring Arena.tsx and Hoop.tsx. */
function extras(v: VenueVariant, court: CourtSpec, sx: number) {
  const out: number[] = [];
  const seats = JSON.parse(fs.readFileSync(path.join("public/models/arenas", `${v.id}.seats.json`), "utf8")) as { groups: Record<string, number[]> };
  for (const a of Object.values(seats.groups))
    for (let i = 0; i < a.length; i += 5) boxTris(out, [(a[i] / 100) * sx, a[i + 1] / 100 + 0.95, a[i + 2] / 100], [0.5, 1.9, 0.5]); // a fan standing up
  const tableZ = -(court.halfW + 1.25);
  boxTris(out, [0, 0.55, tableZ], [Math.min(7, court.halfL * 0.75), 1.1, 0.7]);
  for (const ti of [0, 1] as const)
    for (let i = 0; i <= BENCH_SEATS; i++) {
      const p = benchSeat(court, ti, i);
      boxTris(out, [p.x, 0.7, p.z], [0.55, 1.4, 0.6]); // seated player
    }
  if (v.style.adBoards) for (const s of [1, -1]) boxTris(out, [0, 0.45, s * (court.halfW + FLOOR_MARGIN.z + 0.6)], [court.length * 0.9, 0.9, 0.06]);
  for (const side of [1, -1] as const) {
    const bx = boardX(court, side),
      bb = court.boardBottom,
      bh = court.boardHeight;
    boxTris(out, [bx, bb + bh / 2, 0], [0.06, bh, court.boardWidth]);
    if (v.kind === "gym") boxTris(out, [bx + side * 0.35, (bb + bh + v.girderY) / 2, 0], [0.1, v.girderY - bb - bh, 0.1]);
    else {
      boxTris(out, [bx + side * 1.25, (bb + 0.5) / 2 + 0.3, 0], [0.36, bb + 0.1, 0.36]);
      boxTris(out, [bx + side * 1.7, 0.4, 0], [1.6, 0.8, 1.25]);
    }
  }
  return out;
}

function bvh(tris: number[], sx: number, extra: number[]) {
  const arr = new Float32Array(tris.length + extra.length);
  for (let i = 0; i < tris.length; i += 3) {
    arr[i] = tris[i] * sx;
    arr[i + 1] = tris[i + 1];
    arr[i + 2] = tris[i + 2];
  }
  arr.set(extra, tris.length);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
  return new MeshBVH(g);
}

function solidsFor(v: VenueVariant, court: CourtSpec): Solids {
  const t = venueTris.get(v.id)!;
  const sx = venueStretch(v, court);
  const ex = extras(v, court, sx);
  return { all: bvh(t.all, sx, ex), opaque: bvh(t.opaque, sx, ex) };
}

/** Every camera pose the game can produce on this court (before the venue limits). */
function allPoses(court: CourtSpec): { label: string; pose: CameraPose }[] {
  const out: { label: string; pose: CameraPose }[] = [];
  const zooms = [CAMERA_ZOOM.min, 1, CAMERA_ZOOM.max];
  const heights = [CAMERA_HEIGHT.min, 1, CAMERA_HEIGHT.max];
  const xs = Array.from({ length: 9 }, (_, i) => -court.halfL + (i * 2 * court.halfL) / 8);
  const zs = [-court.halfW, -court.halfW / 2, 0, court.halfW / 2, court.halfW];
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
  for (const ti of [0, 1] as const) out.push({ label: `huddle ${ti}`, pose: huddlePose(huddleSpot(court, ti, 2)) });
  for (const fs of [1, -1] as const) {
    const ftX = fs * (court.halfL - court.ftLineFromBaseline);
    out.push({ label: `free throw ${fs}`, pose: freeThrowPose(court, { x: ftX, z: 0 }, fs) });
  }
  for (const { id } of REPLAY_CAMS)
    for (const side of [1, -1] as const)
      for (const x of xs)
        for (const z of zs)
          for (let a = 0; a < Math.PI * 2; a += id === "orbit" ? Math.PI / 6 : 7) {
            const rimX = rimPos(court, side).x;
            out.push({
              label: `replay ${id} rim${side} at(${x.toFixed(1)},${z.toFixed(1)}) a${a.toFixed(2)}`,
              pose: replayPose(id, court, { x, z, y: 0 }, { x, z }, rimX, a),
            });
          }
  return out;
}

const ray = new THREE.Ray();
const hit = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };

function check(v: VenueVariant, court: CourtSpec, solids: Solids) {
  const failures: string[] = [];
  for (const { label, pose } of allPoses(court)) {
    const p = constrainPose(v, court, pose);
    const near = solids.all.closestPointToPoint(p.pos, hit, 0, NEAR);
    if (near && near.distance < NEAR)
      failures.push(`${label}: ${near.distance.toFixed(2)} m from geometry at (${p.pos.x.toFixed(1)}, ${p.pos.y.toFixed(1)}, ${p.pos.z.toFixed(1)})`);
    // nothing right in front of the lens (a camera pressed against or inside something)
    const d = p.look.clone().sub(p.pos);
    const len = d.length();
    ray.set(p.pos, d.normalize());
    const first = solids.opaque.raycastFirst(ray, THREE.DoubleSide);
    if (first && first.distance < Math.min(BLOCK, len * 0.5))
      failures.push(
        `${label}: view blocked ${first.distance.toFixed(1)} m out of ${len.toFixed(1)} m at (${p.pos.x.toFixed(1)}, ${p.pos.y.toFixed(1)}, ${p.pos.z.toFixed(1)})`,
      );
  }
  return failures;
}

describe("cameras never intersect a venue", () => {
  beforeAll(async () => {
    await MeshoptDecoder.ready;
    for (const id of ALL_VARIANTS) venueTris.set(id, await loadVenue(id));
  });

  for (const id of ALL_VARIANTS)
    for (const league of ["hs", "pro"] as const)
      it(`${id} on a ${league === "hs" ? "high school" : "college/pro"} court`, () => {
        const v = variant(id);
        const court = courtFor(league);
        const failures = check(v, court, solidsFor(v, court));
        // one example per camera kind keeps the report readable
        const byKind = new Map<string, string>();
        for (const f of failures) {
          const kind =
            f
              .split(" ")
              .slice(0, f.startsWith("replay") ? 2 : 1)
              .join(" ") + (f.includes("view blocked") ? " (view)" : " (near)");
          if (!byKind.has(kind)) byKind.set(kind, f);
        }
        expect([...byKind.values()], `${failures.length} bad camera poses`).toEqual([]);
      });
});
