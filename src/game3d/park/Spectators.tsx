"use client";
// Park spectators: real 3D people (the player model posed and baked in Blender, scripts/blender/build_crowd.py),
// instanced by the hundred at the spots each park exports. Everyone has their own clothes; on a big play
// some of them jump up cheering or clap, and they settle back into standing around.
import { useFrame, useLoader } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Rng } from "@/engine/rng";
import type { Park } from "@/game/park/parks";
import { asset } from "@/lib/site";

export const CROWD_GLB = asset("/models/parks/crowd.glb");
export const spotsUrl = (id: string) => asset(`/models/parks/${id}.spots.json`);

type SpotKind = "stand" | "sit" | "lean";
interface Spot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  kind: SpotKind;
}

export function parseSpots(raw: string): Spot[] {
  const d = JSON.parse(raw) as Record<SpotKind, number[]>;
  const out: Spot[] = [];
  for (const kind of ["stand", "sit", "lean"] as const) {
    const a = d[kind] ?? [];
    for (let i = 0; i < a.length; i += 4) out.push({ x: a[i] / 100, y: a[i + 1] / 100, z: a[i + 2] / 100, yaw: (a[i + 3] * Math.PI) / 180, kind });
  }
  return out;
}

const BASE: Record<SpotKind, string[]> = {
  stand: ["idle", "idle", "crossed", "crossed", "hips", "phone", "point"],
  lean: ["lean"],
  sit: ["sit"],
};
const REACT: Record<SpotKind, string[]> = { stand: ["cheer", "cheer", "clap"], lean: ["cheer", "clap"], sit: ["sitcheer"] };
const SKIN = ["#f1d0b5", "#e2b48f", "#c98f62", "#a86b42", "#8a5232", "#6b3e25", "#4f2c1a"];
const HAIR = ["#141414", "#2b1a10", "#4a2e19", "#6e4a2a", "#a07040", "#8a8a8a"];
const PANTS = ["#1d1f23", "#2a3550", "#5a5f66", "#3b2f2a", "#14365e", "#7a6a55", "#d8c9a8"];
const SHOES = ["#f4f4f2", "#1d1f23", "#c8102e", "#1f4e9a", "#8d9399"];

interface Slot {
  meshes: THREE.InstancedMesh[];
  attrs: Record<string, THREE.InstancedBufferAttribute>;
  matrix: THREE.InstancedBufferAttribute;
}

interface Person {
  spot: Spot;
  base: string;
  react: string;
  hair: "short" | "bald";
  /** How excited the crowd has to be before this person gets up (0..1). */
  threshold: number;
  colors: number[]; // skin, shirt, pants, shoes, hair (rgb each)
  tee: number;
  longPants: number;
  scale: number;
  phase: number;
}

const vertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec3 iSkin;
attribute vec3 iShirt;
attribute vec3 iPants;
attribute vec3 iShoes;
attribute vec3 iHair;
attribute vec2 iFlags;
attribute float iPhase;
uniform float uTime;
uniform float uExcite;
uniform float uCheer;
uniform float uRegion;
varying vec3 vColor;
varying vec3 vNormal2;
void main() {
  float region = uRegion;
  vec3 c = iSkin;
  if (region == 1.0) c = iShirt;
  else if (region == 2.0) c = iPants;
  else if (region == 3.0) c = iShoes;
  else if (region == 4.0) c = iHair;
  else if (region == 5.0) c = mix(iSkin, iShirt, iFlags.x);
  else if (region == 6.0) c = mix(iSkin, iPants, iFlags.y);
  vColor = c;
  vec3 p = position;
  // weight shifts while waiting, a bounce when the crowd is into it, jumping when they cheer
  float sway = sin(uTime * (0.6 + iPhase * 0.5) + iPhase * 30.0);
  p.x += sway * 0.025 * p.y;
  float bounce = max(0.0, sin(uTime * (4.0 + iPhase * 2.0) + iPhase * 40.0)) * uExcite * 0.06;
  float jump = max(0.0, sin(uTime * (7.0 + iPhase * 3.0) + iPhase * 25.0)) * uCheer * 0.16;
  p.y += bounce + jump;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  vNormal2 = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  gl_Position = projectionMatrix * mv;
  vec4 mvPosition = mv;
  #include <fog_vertex>
}`;
const fragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSky;
uniform vec3 uGround;
varying vec3 vColor;
varying vec3 vNormal2;
void main() {
  vec3 n = normalize(vNormal2);
  vec3 ambient = mix(uGround, uSky, n.y * 0.5 + 0.5);
  vec3 lit = vColor * (ambient + uSunColor * max(0.0, dot(n, uSunDir)));
  gl_FragColor = vec4(lit, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export interface SpectatorLight {
  sunDir: THREE.Vector3;
  sun: THREE.Color;
  sky: THREE.Color;
  ground: THREE.Color;
}

export function Spectators({
  park,
  quality,
  light,
  exciteRef,
  reactRef,
}: {
  park: Park;
  quality: "low" | "medium" | "high" | "ultra";
  light: SpectatorLight;
  exciteRef: React.RefObject<number>;
  reactRef: React.RefObject<[number, number]>;
}) {
  const gltf = useGLTF(CROWD_GLB) as unknown as GLTF;
  const raw = useLoader(THREE.FileLoader, spotsUrl(park.id)) as string;
  const spots = useMemo(() => parseSpots(raw), [raw]);
  // each pose is one node with a primitive per body region (material Crowd_R<n>)
  const meshes = useMemo(() => {
    const out = new Map<string, { geo: THREE.BufferGeometry; region: number }[]>();
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      let node: THREE.Object3D | null = m;
      while (node && !node.name.startsWith("Crowd_")) node = node.parent;
      const region = Number(/Crowd_R(\d)/.exec((m.material as THREE.Material).name)?.[1] ?? -1);
      if (!node || region < 0) return;
      const key = node.name.replace(/_\d+$/, "");
      const list = out.get(key) ?? [];
      list.push({ geo: m.geometry, region });
      out.set(key, list);
    });
    return out;
  }, [gltf]);

  // who's here and what they're wearing (the same people every time at this park)
  const people = useMemo(() => {
    const rng = new Rng(`spectators:${park.id}`);
    const fill = park.crowd.density * (quality === "low" ? 0.45 : quality === "medium" ? 0.75 : 1);
    const rgb = (hex: string) => new THREE.Color(hex).toArray() as number[];
    const out: Person[] = [];
    for (const spot of spots) {
      if (rng.next() > fill) continue;
      const shirt = new THREE.Color(rng.pick(park.crowd.palette)).offsetHSL(0, 0, rng.range(-0.06, 0.06));
      out.push({
        spot,
        base: rng.pick(BASE[spot.kind]),
        react: rng.pick(REACT[spot.kind]),
        hair: rng.chance(0.7) ? "short" : "bald",
        threshold: 0.15 + rng.next() * 0.8,
        colors: [...rgb(rng.pick(SKIN)), ...shirt.toArray(), ...rgb(rng.pick(PANTS)), ...rgb(rng.pick(SHOES)), ...rgb(rng.pick(HAIR))],
        tee: rng.chance(0.65) ? 1 : 0,
        longPants: rng.chance(0.45) ? 1 : 0,
        // the model is 2 m tall: everyday heights from about 5'4" to 6'4"
        scale: rng.range(0.82, 0.97),
        phase: rng.next(),
      });
    }
    return out;
  }, [spots, park, quality]);

  // one material per body region; they share the animated uniforms
  const shared = useMemo(
    () => ({
      uTime: { value: 0 },
      uExcite: { value: 0.2 },
      uCheer: { value: 0 },
      uSunDir: { value: light.sunDir.clone().normalize() },
      uSunColor: { value: light.sun.clone() },
      uSky: { value: light.sky.clone() },
      uGround: { value: light.ground.clone() },
    }),
    [light],
  );
  const mats = useMemo(
    () =>
      Array.from(
        { length: 7 },
        (_, region) =>
          new THREE.ShaderMaterial({
            vertexShader: vertex,
            fragmentShader: fragment,
            fog: true,
            uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...shared, uRegion: { value: region } },
          }),
      ),
    [shared],
  );
  useEffect(() => () => mats.forEach((m) => m.dispose()), [mats]);

  // one instanced mesh per pose and hair; each person sits in exactly one (base or cheering) at a time
  const slots = useMemo(() => {
    const keys = new Set<string>();
    for (const p of people) {
      keys.add(`Crowd_${p.base}_${p.hair}`);
      keys.add(`Crowd_${p.react}_${p.hair}`);
    }
    const out = new Map<string, Slot>();
    for (const k of keys) {
      const parts = meshes.get(k);
      if (!parts) continue;
      const cap = people.length;
      const attr = (n: number) => new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n);
      const attrs: Record<string, THREE.InstancedBufferAttribute> = {
        iSkin: attr(3),
        iShirt: attr(3),
        iPants: attr(3),
        iShoes: attr(3),
        iHair: attr(3),
        iFlags: attr(2),
        iPhase: attr(1),
      };
      const matrix = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16);
      const regionMeshes = parts.map(({ geo, region }) => {
        const g = geo.clone();
        for (const [n, a] of Object.entries(attrs)) g.setAttribute(n, a);
        const m = new THREE.InstancedMesh(g, mats[region], cap);
        m.instanceMatrix = matrix;
        m.count = 0;
        m.frustumCulled = false;
        return m;
      });
      out.set(k, { meshes: regionMeshes, attrs, matrix });
    }
    return out;
  }, [people, meshes, mats]);
  useEffect(
    () => () => {
      for (const sl of slots.values()) for (const m of sl.meshes) m.geometry.dispose();
    },
    [slots],
  );

  const group = useRef<THREE.Group>(null);
  const standing = useRef<boolean[] | null>(null);
  const cheer = useRef(0);

  const assign = (up: boolean[]) => {
    const fill = new Map<string, number>();
    const o = new THREE.Object3D();
    people.forEach((p, i) => {
      const key = `Crowd_${up[i] ? p.react : p.base}_${p.hair}`;
      const sl = slots.get(key);
      if (!sl) return;
      const k = fill.get(key) ?? 0;
      fill.set(key, k + 1);
      o.position.set(p.spot.x, p.spot.y, p.spot.z);
      o.rotation.set(0, p.spot.yaw, 0);
      o.scale.setScalar(p.scale);
      o.updateMatrix();
      o.matrix.toArray(sl.matrix.array, k * 16);
      (["iSkin", "iShirt", "iPants", "iShoes", "iHair"] as const).forEach((n, j) =>
        sl.attrs[n].setXYZ(k, p.colors[j * 3], p.colors[j * 3 + 1], p.colors[j * 3 + 2]),
      );
      sl.attrs.iFlags.setXY(k, p.tee, p.longPants);
      sl.attrs.iPhase.setX(k, p.phase);
    });
    for (const [key, sl] of slots) {
      const n = fill.get(key) ?? 0;
      for (const m of sl.meshes) m.count = n;
      sl.matrix.needsUpdate = true;
      for (const a of Object.values(sl.attrs)) a.needsUpdate = true;
    }
  };

  useEffect(() => {
    const g = group.current;
    if (!g) return;
    for (const sl of slots.values()) for (const m of sl.meshes) g.add(m);
    const up = people.map(() => false);
    standing.current = up;
    assign(up);
    return () => {
      for (const sl of slots.values()) for (const m of sl.meshes) g.remove(m);
    };
    // assign only reads the current slots/people
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, people]);

  const tick = useRef(0);
  useFrame((st, dt) => {
    shared.uTime.value = st.clock.elapsedTime;
    // the park crowd cheers for good basketball, whoever plays it
    const r = reactRef.current ?? [0, 0];
    const target = Math.max(r[0], r[1]) * park.crowd.loudness * 1.3;
    cheer.current = THREE.MathUtils.damp(cheer.current, target, target > cheer.current ? 8 : 1.2, dt);
    shared.uCheer.value = cheer.current;
    shared.uExcite.value = THREE.MathUtils.damp(shared.uExcite.value, (exciteRef.current ?? 0.2) * park.crowd.loudness, 2, dt);
    tick.current += dt;
    if (tick.current < 0.12 || !standing.current) return;
    tick.current = 0;
    const up = people.map((p) => cheer.current > p.threshold);
    if (up.some((u, i) => u !== standing.current![i])) {
      standing.current = up;
      assign(up);
    }
  });

  return <group ref={group} />;
}

useGLTF.preload(CROWD_GLB);
