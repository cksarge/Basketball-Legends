"use client";
// Outdoor parks for Play in the Park, built procedurally: sky, court, fences, light poles, and a backdrop
// for each setting (desert, city cage, beach, neighborhood, rooftop).
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type CourtSpec, rimPos } from "@/game/court";
import { Rng } from "@/engine/rng";
import type { Park, ParkTime } from "@/game/park/parks";
import { floorSize } from "../courtTexture";
import { drawChainLink, drawParkCourt, drawWindows } from "./parkTexture";
import type { VenueVariant } from "../arena/variants";
import type { Match } from "@/game/sim/match";
import { BALLS_PER_RACK, isMoney, ThreePointDrill } from "@/game/sim/drill";

type Quality = "low" | "medium" | "high" | "ultra";

interface SkyLook {
  top: string;
  horizon: string;
  ground: string;
  sun: { dir: [number, number, number]; color: string; intensity: number; disc: string; size: number };
  hemi: { sky: string; ground: string; intensity: number };
}

const SKY: Record<ParkTime, SkyLook> = {
  day: {
    top: "#4d8fd6",
    horizon: "#dbe8f2",
    ground: "#b9a27f",
    sun: { dir: [0.45, 0.8, 0.4], color: "#fff3df", intensity: 2.7, disc: "#fff8e6", size: 9 },
    hemi: { sky: "#dcecff", ground: "#9c8a6c", intensity: 0.95 },
  },
  sunset: {
    top: "#2f3d72",
    horizon: "#f59a5b",
    ground: "#5a4436",
    sun: { dir: [-0.35, 0.22, -0.9], color: "#ffb36e", intensity: 2.1, disc: "#ffcf86", size: 14 },
    hemi: { sky: "#ffd1aa", ground: "#4b3a33", intensity: 0.7 },
  },
  night: {
    top: "#060a18",
    horizon: "#1d2a48",
    ground: "#121212",
    sun: { dir: [0.2, 0.9, 0.3], color: "#cfdcff", intensity: 0.55, disc: "#e8eeff", size: 5 },
    hemi: { sky: "#6a7aa6", ground: "#111111", intensity: 0.14 },
  },
};

/** The camera's box for an open-air court (no stands or roof to stay out of). */
export const PARK_VENUE: VenueVariant = {
  id: "park",
  kind: "park",
  label: "Park",
  native: "hs",
  tiers: [],
  walls: { x: 40, z: 30 },
  ceiling: 60,
  girderY: 0,
  interior: { x: 38, z: 30, y: 40 },
  lightY: 9,
  style: { wall: "#000000", scoreboards: "wall", adBoards: false, banners: 0 },
};

export function parkSky(park: Park) {
  return SKY[park.time];
}

// fence lines around the court (no fence on the near, camera side: it would cover the picture)
const fenceBox = (c: CourtSpec, park: Park) => ({ x: c.halfL + (park.setting === "cage" ? 2.6 : 3.4), z: c.halfW + (park.setting === "cage" ? 2.4 : 3.2) });

function canvasTexture(w: number, h: number, draw: (c: HTMLCanvasElement) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function useDispose(x: { dispose(): void }) {
  useEffect(() => () => x.dispose(), [x]);
}

// ------------------------------------------------------------------ sky
function SkyDome({ look }: { look: SkyLook }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new THREE.Color(look.top) },
          horizon: { value: new THREE.Color(look.horizon) },
          bottom: { value: new THREE.Color(look.ground) },
        },
        vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader:
          "uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(min(1.0, h * 1.6), 0.7)) : mix(horizon, bottom, min(1.0, -h * 6.0)); gl_FragColor = vec4(c, 1.0); }",
      }),
    [look],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  const d = new THREE.Vector3(...look.sun.dir).normalize().multiplyScalar(280);
  return (
    <group>
      <mesh material={mat} renderOrder={-10}>
        <sphereGeometry args={[320, 32, 16]} />
      </mesh>
      <mesh position={[d.x, d.y, d.z]}>
        <sphereGeometry args={[look.sun.size, 24, 12]} />
        <meshBasicMaterial color={look.sun.disc} fog={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Stars() {
  const geo = useMemo(() => {
    const rng = new Rng("stars");
    const pts: number[] = [];
    for (let i = 0; i < 700; i++) {
      const th = rng.range(0, Math.PI * 2),
        ph = rng.range(0.15, 1.4);
      pts.push(Math.cos(th) * Math.cos(ph) * 300, Math.sin(ph) * 300, Math.sin(th) * Math.cos(ph) * 300);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <points geometry={geo}>
      <pointsMaterial color="#dfe6ff" size={1.1} sizeAttenuation={false} fog={false} />
    </points>
  );
}

// ------------------------------------------------------------------ lights
export function ParkLights({ park, shadows, court }: { park: Park; shadows: boolean; court: CourtSpec }) {
  const key = useRef<THREE.DirectionalLight>(null);
  const look = SKY[park.time];
  useEffect(() => {
    const l = key.current;
    if (!l) return;
    l.shadow.mapSize.set(2048, 2048);
    const cam = l.shadow.camera as THREE.OrthographicCamera;
    cam.left = -20;
    cam.right = 20;
    cam.top = 16;
    cam.bottom = -16;
    cam.near = 1;
    cam.far = 120;
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 0.02;
    l.target.position.set(0, 0, 0);
    l.target.updateMatrixWorld();
  }, []);
  const sun = new THREE.Vector3(...look.sun.dir).normalize().multiplyScalar(50);
  const night = park.time === "night";
  const poles = poleSpots(court, park);
  return (
    <>
      <hemisphereLight args={[look.hemi.sky, look.hemi.ground, look.hemi.intensity]} />
      {/* at night the court lights cast the shadows: a key light straight overhead stands in for them */}
      <directionalLight
        ref={key}
        position={night ? [2, 30, 4] : [sun.x, sun.y, sun.z]}
        intensity={night ? 0.75 : look.sun.intensity}
        color={night ? "#fff2dc" : look.sun.color}
        castShadow={shadows}
      />
      {night && poles.map((p, i) => <pointLight key={i} position={[p.x * 0.85, 8.6, p.z * 0.85]} intensity={110} distance={34} decay={2} color="#ffe9c4" />)}
    </>
  );
}

function poleSpots(c: CourtSpec, park: Park) {
  const f = fenceBox(c, park);
  return [
    { x: -f.x + 0.4, z: -f.z + 0.4 },
    { x: f.x - 0.4, z: -f.z + 0.4 },
    { x: -f.x + 0.4, z: f.z + 1.5 },
    { x: f.x - 0.4, z: f.z + 1.5 },
  ];
}

// ------------------------------------------------------------------ court + fence
function ParkCourt({ court, park, quality }: { court: CourtSpec; park: Park; quality: Quality }) {
  const { w, h } = floorSize(court);
  const res = quality === "low" ? 1024 : quality === "medium" ? 2048 : 4096;
  const tex = useMemo(
    () =>
      canvasTexture(res, res / 2, (cv) => {
        // paint at true aspect, then fit to the power-of-two canvas
        const draw = document.createElement("canvas");
        draw.width = res;
        draw.height = Math.round((res * h) / w);
        drawParkCourt(draw, court, park.surface, park.id);
        cv.getContext("2d")!.drawImage(draw, 0, 0, cv.width, cv.height);
      }),
    [court, park, res, w, h],
  );
  useDispose(tex);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} receiveShadow>
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial map={tex} roughness={park.surface.finish === "asphalt" ? 0.95 : 0.7} metalness={0} />
    </mesh>
  );
}

function Fence({ court, park }: { court: CourtSpec; park: Park }) {
  const f = fenceBox(court, park);
  const height = park.setting === "cage" ? 5.2 : park.setting === "rooftop" ? 3.2 : 3.6;
  const link = useMemo(() => canvasTexture(64, 64, drawChainLink), []);
  useDispose(link);
  const mats = useMemo(() => {
    const make = (len: number) => {
      const t = link.clone();
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(len / 0.11, height / 0.11);
      t.needsUpdate = true;
      return new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 });
    };
    return { long: make(f.x * 2), short: make(f.z * 2) };
  }, [link, f.x, f.z, height]);
  useEffect(
    () => () => {
      mats.long.map?.dispose();
      mats.short.map?.dispose();
      mats.long.dispose();
      mats.short.dispose();
    },
    [mats],
  );
  // posts every few meters, plus a top rail
  const posts = useMemo(() => {
    const pts: [number, number][] = [];
    for (let x = -f.x; x <= f.x + 0.01; x += 3) pts.push([x, -f.z]);
    for (let z = -f.z + 3; z <= f.z + 0.01; z += 3) pts.push([-f.x, z], [f.x, z]);
    const g = mergeGeometries(pts.map(([x, z]) => new THREE.CylinderGeometry(0.045, 0.045, height, 8).translate(x, height / 2, z)))!;
    return g;
  }, [f.x, f.z, height]);
  useEffect(() => () => posts.dispose(), [posts]);
  const steel = useMemo(() => new THREE.MeshStandardMaterial({ color: "#9aa1a8", metalness: 0.7, roughness: 0.4 }), []);
  useEffect(() => () => steel.dispose(), [steel]);
  return (
    <group>
      <mesh position={[0, height / 2, -f.z]} material={mats.long}>
        <planeGeometry args={[f.x * 2, height]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * f.x, height / 2, 0]} rotation={[0, Math.PI / 2, 0]} material={mats.short}>
          <planeGeometry args={[f.z * 2, height]} />
        </mesh>
      ))}
      <mesh geometry={posts} material={steel} castShadow />
      <mesh position={[0, height, -f.z]} rotation={[0, 0, Math.PI / 2]} material={steel}>
        <cylinderGeometry args={[0.035, 0.035, f.x * 2, 8]} />
      </mesh>
    </group>
  );
}

function LightPoles({ court, park }: { court: CourtSpec; park: Park }) {
  const night = park.time === "night";
  const geo = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    for (const p of poleSpots(court, park)) {
      parts.push(new THREE.CylinderGeometry(0.09, 0.13, 9, 10).translate(p.x, 4.5, p.z));
      const inward = new THREE.Vector2(-p.x, -p.z).normalize();
      parts.push(new THREE.BoxGeometry(0.9, 0.12, 0.12).translate(p.x + inward.x * 0.45, 8.9, p.z + inward.y * 0.45));
    }
    return mergeGeometries(parts)!;
  }, [court, park]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <group>
      <mesh geometry={geo} castShadow>
        <meshStandardMaterial color="#5b6168" metalness={0.6} roughness={0.5} />
      </mesh>
      {poleSpots(court, park).map((p, i) => {
        const inward = new THREE.Vector2(-p.x, -p.z).normalize();
        return (
          <mesh key={i} position={[p.x + inward.x * 0.9, 8.75, p.z + inward.y * 0.9]}>
            <boxGeometry args={[0.55, 0.22, 0.4]} />
            <meshStandardMaterial color={night ? "#fff6dd" : "#c9ced3"} emissive={night ? "#fff1cf" : "#000000"} emissiveIntensity={night ? 2.5 : 0} />
          </mesh>
        );
      })}
    </group>
  );
}

function Bench({ x, z, rot = 0 }: { x: number; z: number; rot?: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.2, 0.06, 0.42]} />
        <meshStandardMaterial color="#6b4a2f" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.75, -0.19]} castShadow>
        <boxGeometry args={[2.2, 0.32, 0.05]} />
        <meshStandardMaterial color="#6b4a2f" roughness={0.9} />
      </mesh>
      {[-0.95, 0.95].map((dx) => (
        <mesh key={dx} position={[dx, 0.22, 0]} castShadow>
          <boxGeometry args={[0.06, 0.44, 0.42]} />
          <meshStandardMaterial color="#2b2e33" metalness={0.5} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

// ------------------------------------------------------------------ settings
function scatter(rng: Rng, n: number, rMin: number, rMax: number, avoidNear = true) {
  const out: { x: number; z: number; s: number }[] = [];
  for (let i = 0; i < n * 3 && out.length < n; i++) {
    const th = rng.range(0, Math.PI * 2);
    const r = rng.range(rMin, rMax);
    const x = Math.cos(th) * r * 1.3,
      z = Math.sin(th) * r;
    // keep the camera's side (+z, in front of the court) clear
    if (avoidNear && z > 6 && Math.abs(x) < 30) continue;
    out.push({ x, z, s: rng.range(0.8, 1.3) });
  }
  return out;
}

function Ground({ color, size = 600 }: { color: string; size?: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial color={color} roughness={1} />
    </mesh>
  );
}

function Desert({ quality }: { quality: Quality }) {
  const { mountains, cacti, trees } = useMemo(() => {
    const rng = new Rng("desert");
    // a ring of mountains on the horizon
    const mParts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 26; i++) {
      const th = (i / 26) * Math.PI * 2 + rng.range(-0.1, 0.1);
      if (Math.sin(th) > 0.55) continue;
      const r = rng.range(170, 230);
      const hgt = rng.range(18, 55);
      mParts.push(new THREE.ConeGeometry(rng.range(30, 60), hgt, 5 + rng.int(0, 3)).translate(Math.cos(th) * r, hgt / 2 - 2, Math.sin(th) * r));
    }
    const cParts: THREE.BufferGeometry[] = [];
    for (const p of scatter(rng, quality === "low" ? 10 : 26, 22, 70)) {
      const h = 3.2 * p.s;
      cParts.push(new THREE.CylinderGeometry(0.28, 0.32, h, 8).translate(p.x, h / 2, p.z));
      for (const side of [-1, 1]) {
        if (!rng.chance(0.7)) continue;
        const ay = rng.range(1.2, 2.2) * p.s;
        cParts.push(new THREE.CylinderGeometry(0.17, 0.17, 0.6, 6).rotateZ(Math.PI / 2).translate(p.x + side * 0.45, ay, p.z));
        cParts.push(new THREE.CylinderGeometry(0.17, 0.17, 1.1, 6).translate(p.x + side * 0.75, ay + 0.55, p.z));
      }
    }
    const tParts: THREE.BufferGeometry[] = [];
    const leaves: THREE.BufferGeometry[] = [];
    for (const p of scatter(rng, quality === "low" ? 5 : 12, 16, 45)) {
      tParts.push(new THREE.CylinderGeometry(0.12, 0.18, 2.4 * p.s, 6).translate(p.x, 1.2 * p.s, p.z));
      leaves.push(new THREE.IcosahedronGeometry(2.2 * p.s, 1).scale(1.4, 0.7, 1.4).translate(p.x, 3 * p.s, p.z));
    }
    return {
      mountains: mergeGeometries(mParts)!,
      cacti: mergeGeometries(cParts)!,
      trees: { trunk: mergeGeometries(tParts)!, leaves: mergeGeometries(leaves)! },
    };
  }, [quality]);
  useEffect(
    () => () => {
      mountains.dispose();
      cacti.dispose();
      trees.trunk.dispose();
      trees.leaves.dispose();
    },
    [mountains, cacti, trees],
  );
  return (
    <group>
      <Ground color="#c7a77a" />
      <mesh geometry={mountains}>
        <meshStandardMaterial color="#8a6a6a" roughness={1} flatShading />
      </mesh>
      <mesh geometry={cacti} castShadow>
        <meshStandardMaterial color="#4f7a43" roughness={0.9} />
      </mesh>
      <mesh geometry={trees.trunk} castShadow>
        <meshStandardMaterial color="#7d8a4f" roughness={0.9} />
      </mesh>
      <mesh geometry={trees.leaves} castShadow>
        <meshStandardMaterial color="#9bb05a" roughness={0.9} flatShading />
      </mesh>
      {/* a shade ramada by the far sideline */}
      <group position={[-6, 0, -16]}>
        {[
          [-3, -1.6],
          [3, -1.6],
          [-3, 1.6],
          [3, 1.6],
        ].map(([x, z], i) => (
          <mesh key={i} position={[x, 1.5, z]} castShadow>
            <boxGeometry args={[0.2, 3, 0.2]} />
            <meshStandardMaterial color="#6a5440" />
          </mesh>
        ))}
        <mesh position={[0, 3.1, 0]} castShadow receiveShadow>
          <boxGeometry args={[7, 0.18, 4]} />
          <meshStandardMaterial color="#8c6d4f" roughness={0.9} />
        </mesh>
        <Bench x={0} z={0} />
      </group>
    </group>
  );
}

/** A row of buildings (instanced boxes with window textures). */
function Buildings({
  spots,
  wall,
  lit,
  seed,
}: {
  spots: { x: number; z: number; w: number; d: number; h: number }[];
  wall: string;
  lit: number;
  seed: string;
}) {
  const tex = useMemo(() => canvasTexture(256, 512, (c) => drawWindows(c, wall, lit, seed)), [wall, lit, seed]);
  useDispose(tex);
  // one texture repeat covers 12 m x 24 m of wall, so windows stay about a story tall on any building
  const geo = useMemo(
    () =>
      mergeGeometries(
        spots.map((b) => {
          const g = new THREE.BoxGeometry(b.w, b.h, b.d);
          const uv = g.getAttribute("uv") as THREE.BufferAttribute;
          for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(1, b.w / 12), uv.getY(i) * Math.max(1, b.h / 24));
          return g.translate(b.x, b.h / 2, b.z);
        }),
      )!,
    [spots],
  );
  useEffect(() => () => geo.dispose(), [geo]);
  const mat = useMemo(() => {
    const t = tex.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 1);
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({
      map: t,
      emissiveMap: lit > 0.3 ? t : null,
      emissive: lit > 0.3 ? "#ffffff" : "#000000",
      emissiveIntensity: 0.55,
      roughness: 0.85,
    });
  }, [tex, lit]);
  useEffect(
    () => () => {
      mat.map?.dispose();
      mat.dispose();
    },
    [mat],
  );
  return <mesh geometry={geo} material={mat} />;
}

function Cage({ quality }: { quality: Quality }) {
  const spots = useMemo(() => {
    const rng = new Rng("cage");
    const out: { x: number; z: number; w: number; d: number; h: number }[] = [];
    // brick walls behind the far sideline and both ends
    for (let x = -40; x <= 40; x += 10) out.push({ x, z: -24 - rng.range(0, 4), w: 10, d: 10, h: rng.range(14, 26) });
    for (const side of [-1, 1]) for (let z = -18; z <= 18; z += 10) out.push({ x: side * (32 + rng.range(0, 4)), z, w: 10, d: 10, h: rng.range(12, 24) });
    return quality === "low" ? out.filter((_, i) => i % 2 === 0) : out;
  }, [quality]);
  return (
    <group>
      <Ground color="#55585c" />
      <Buildings spots={spots} wall="#7b3f2e" lit={0.25} seed="cage" />
      <Bench x={-6} z={-12.5} />
      <Bench x={6} z={-12.5} />
    </group>
  );
}

function Palms({ spots }: { spots: { x: number; z: number; s: number }[] }) {
  const { trunk, fronds } = useMemo(() => {
    const t: THREE.BufferGeometry[] = [];
    const f: THREE.BufferGeometry[] = [];
    for (const p of spots) {
      const h = 9 * p.s;
      // a gently curved trunk in segments
      for (let k = 0; k < 6; k++) {
        const y = (k + 0.5) * (h / 6);
        t.push(new THREE.CylinderGeometry(0.2, 0.25, h / 6 + 0.05, 7).translate(p.x + Math.sin(k * 0.25) * 0.5, y, p.z));
      }
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2;
        f.push(
          new THREE.BoxGeometry(3.4, 0.05, 0.6)
            .translate(1.7, 0, 0)
            .rotateZ(-0.45)
            .rotateY(ang)
            .translate(p.x + 0.7, h, p.z),
        );
      }
    }
    return { trunk: mergeGeometries(t)!, fronds: mergeGeometries(f)! };
  }, [spots]);
  useEffect(
    () => () => {
      trunk.dispose();
      fronds.dispose();
    },
    [trunk, fronds],
  );
  return (
    <group>
      <mesh geometry={trunk} castShadow>
        <meshStandardMaterial color="#7a6248" roughness={1} />
      </mesh>
      <mesh geometry={fronds} castShadow>
        <meshStandardMaterial color="#3f6e34" roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function Beach({ quality }: { quality: Quality }) {
  const palms = useMemo(() => scatter(new Rng("beach"), quality === "low" ? 6 : 14, 18, 40), [quality]);
  return (
    <group>
      <Ground color="#e2cc98" />
      {/* the ocean beyond the far side, out to the horizon */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, -170]}>
        <planeGeometry args={[700, 280]} />
        <meshStandardMaterial color="#2c6c97" roughness={0.25} metalness={0.2} />
      </mesh>
      <Palms spots={palms} />
      {/* a lifeguard tower down the beach */}
      <group position={[24, 0, -26]}>
        {[
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ].map(([x, z], i) => (
          <mesh key={i} position={[x * 0.9, 1.4, z * 0.9]} castShadow>
            <boxGeometry args={[0.15, 2.8, 0.15]} />
            <meshStandardMaterial color="#d8d2c4" />
          </mesh>
        ))}
        <mesh position={[0, 3.6, 0]} castShadow>
          <boxGeometry args={[2.6, 1.8, 2.4]} />
          <meshStandardMaterial color="#5aa7c9" />
        </mesh>
        <mesh position={[0, 4.75, 0]} castShadow>
          <boxGeometry args={[3, 0.18, 2.8]} />
          <meshStandardMaterial color="#e94e3a" />
        </mesh>
      </group>
      <Bench x={-8} z={-13} />
    </group>
  );
}

function Neighborhood({ quality }: { quality: Quality }) {
  const { houses, roofs, trunks, crowns } = useMemo(() => {
    const rng = new Rng("hood");
    const h: THREE.BufferGeometry[] = [];
    const r: THREE.BufferGeometry[] = [];
    for (let x = -42; x <= 42; x += 12) {
      const w = rng.range(8, 10),
        hh = rng.range(5, 7.5);
      const z = -32 - rng.range(0, 3);
      h.push(new THREE.BoxGeometry(w, hh, 8).translate(x, hh / 2, z));
      r.push(
        new THREE.ConeGeometry(w * 0.75, 3, 4)
          .rotateY(Math.PI / 4)
          .scale(1, 1, 0.75)
          .translate(x, hh + 1.5, z),
      );
    }
    const t: THREE.BufferGeometry[] = [];
    const cr: THREE.BufferGeometry[] = [];
    for (const p of scatter(rng, quality === "low" ? 8 : 20, 17, 30)) {
      t.push(new THREE.CylinderGeometry(0.22, 0.3, 3.2 * p.s, 7).translate(p.x, 1.6 * p.s, p.z));
      cr.push(new THREE.IcosahedronGeometry(2.6 * p.s, 1).translate(p.x, 4.4 * p.s, p.z));
    }
    return { houses: mergeGeometries(h)!, roofs: mergeGeometries(r)!, trunks: mergeGeometries(t)!, crowns: mergeGeometries(cr)! };
  }, [quality]);
  useEffect(
    () => () => {
      for (const g of [houses, roofs, trunks, crowns]) g.dispose();
    },
    [houses, roofs, trunks, crowns],
  );
  return (
    <group>
      <Ground color="#2f4a2a" />
      {/* the street in front of the houses */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, -24]}>
        <planeGeometry args={[200, 8]} />
        <meshStandardMaterial color="#222325" roughness={1} />
      </mesh>
      <mesh geometry={houses} castShadow>
        <meshStandardMaterial color="#8a7c6c" roughness={0.9} emissive="#2a1d0c" emissiveIntensity={0.4} />
      </mesh>
      <mesh geometry={roofs} castShadow>
        <meshStandardMaterial color="#3b2f2a" roughness={0.9} flatShading />
      </mesh>
      <mesh geometry={trunks} castShadow>
        <meshStandardMaterial color="#4a3526" roughness={1} />
      </mesh>
      <mesh geometry={crowns} castShadow>
        <meshStandardMaterial color="#284a26" roughness={0.9} flatShading />
      </mesh>
      <Bench x={-5} z={-13} />
      <Bench x={5} z={-13} />
    </group>
  );
}

function Rooftop({ quality }: { quality: Quality }) {
  const spots = useMemo(() => {
    const rng = new Rng("skyline");
    const out: { x: number; z: number; w: number; d: number; h: number }[] = [];
    const n = quality === "low" ? 24 : 60;
    for (let i = 0; i < n; i++) {
      const th = rng.range(0, Math.PI * 2);
      const r = rng.range(75, 190);
      const x = Math.cos(th) * r * 1.2,
        z = Math.sin(th) * r;
      if (z > 20 && Math.abs(x) < 50) continue;
      out.push({ x, z, w: rng.range(10, 22), d: rng.range(10, 22), h: rng.range(10, 70) });
    }
    return out;
  }, [quality]);
  return (
    <group>
      {/* the garage roof, a drop to the street below, and a low parapet */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[52, 38]} />
        <meshStandardMaterial color="#5f6266" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -22, 0]}>
        <planeGeometry args={[700, 700]} />
        <meshStandardMaterial color="#141519" roughness={1} />
      </mesh>
      {[
        [0, -19, 52, 0.25],
        [-26, 0, 0.25, 38],
        [26, 0, 0.25, 38],
      ].map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, 0.5, z]} castShadow>
          <boxGeometry args={[w || 0.25, 1, d || 0.25]} />
          <meshStandardMaterial color="#77797d" roughness={0.9} />
        </mesh>
      ))}
      <group position={[0, -22, 0]}>
        <Buildings spots={spots} wall="#1c2230" lit={0.45} seed="skyline" />
      </group>
      <Bench x={-6} z={-13} />
    </group>
  );
}

export function ParkScene({ park, court, quality }: { park: Park; court: CourtSpec; quality: Quality }) {
  const look = SKY[park.time];
  return (
    <group>
      <SkyDome look={look} />
      {park.time === "night" && <Stars />}
      {park.setting === "desert" && <Desert quality={quality} />}
      {park.setting === "cage" && <Cage quality={quality} />}
      {park.setting === "beach" && <Beach quality={quality} />}
      {park.setting === "neighborhood" && <Neighborhood quality={quality} />}
      {park.setting === "rooftop" && <Rooftop quality={quality} />}
      <ParkCourt court={court} park={park} quality={quality} />
      <Fence court={court} park={park} />
      {(park.time === "night" || park.setting !== "beach") && <LightPoles court={court} park={park} />}
    </group>
  );
}

/** 3-point contest racks: a stand at each spot with its balls (the money ball in gold), emptying as you shoot. */
export function ContestRacks({ match, ballRadius }: { match: Match; ballRadius: number }) {
  const drill = match.drill instanceof ThreePointDrill ? match.drill : null;
  const balls = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(() => {
    if (!drill) return;
    drill.spots.forEach((_, r) => {
      const left = drill.ballsLeft(r);
      for (let b = 0; b < BALLS_PER_RACK; b++) {
        const m = balls.current[r * BALLS_PER_RACK + b];
        // balls come off the rack from the left; the money ball is last
        if (m) m.visible = b >= BALLS_PER_RACK - left;
      }
    });
  });
  if (!drill) return null;
  return (
    <group>
      {drill.spots.map((p, r) => {
        // the rack sits just behind the shooter's spot, turned to face the rim
        const rim = rimPos(match.state.cfg.court, match.attackSide(0));
        const out = new THREE.Vector2(p.x - rim.x, p.z - rim.z).normalize();
        const pos = new THREE.Vector3(p.x + out.x * 0.9, 0, p.z + out.y * 0.9);
        const ang = Math.atan2(out.x, out.y) + Math.PI / 2;
        return (
          <group key={r} position={pos} rotation={[0, ang, 0]}>
            <mesh position={[0, 0.42, 0]} castShadow>
              <boxGeometry args={[1.5, 0.05, 0.36]} />
              <meshStandardMaterial color="#2b2f36" metalness={0.6} roughness={0.4} />
            </mesh>
            {[-0.7, 0.7].map((x) => (
              <mesh key={x} position={[x, 0.21, 0]} castShadow>
                <boxGeometry args={[0.05, 0.42, 0.36]} />
                <meshStandardMaterial color="#2b2f36" metalness={0.6} roughness={0.4} />
              </mesh>
            ))}
            {Array.from({ length: BALLS_PER_RACK }, (_, b) => (
              <mesh key={b} ref={(m) => void (balls.current[r * BALLS_PER_RACK + b] = m)} position={[-0.56 + b * 0.28, 0.45 + ballRadius, 0]} castShadow>
                <sphereGeometry args={[ballRadius, 20, 14]} />
                <meshStandardMaterial color={isMoney(b) ? "#e9b949" : "#c8622a"} roughness={0.7} />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}
