"use client";
// Outdoor parks for Play in the Park. The world around the court (terrain to the horizon, fences, buildings,
// trees, bleachers, props) is built in Blender (scripts/blender/build_parks.py); this draws the court, the sky,
// the lights and the crowd, and keeps every camera inside a closed world (see PARK_WORLD).
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { type CourtSpec, rimPos } from "@/game/court";
import { Rng } from "@/engine/rng";
import type { Park, ParkTime } from "@/game/park/parks";
import { asset } from "@/lib/site";
import { floorSize } from "../courtTexture";
import { drawParkCourt } from "./parkTexture";
import type { Match } from "@/game/sim/match";
import { BALLS_PER_RACK, isMoney, ThreePointDrill } from "@/game/sim/drill";
import { Spectators, spotsUrl } from "./Spectators";

type Quality = "low" | "medium" | "high" | "ultra";

export { PARK_VENUE, PARK_WORLD } from "./world";
import { PARK_WORLD } from "./world";

interface SkyLook {
  top: string;
  horizon: string;
  sun: { dir: [number, number, number]; color: string; intensity: number; disc: string; size: number };
  hemi: { sky: string; ground: string; intensity: number };
}

const SKY: Record<ParkTime, SkyLook> = {
  day: {
    top: "#3f86d4",
    horizon: "#d8e6ef",
    sun: { dir: [0.45, 0.8, 0.4], color: "#fff3df", intensity: 2.7, disc: "#fff8e6", size: 60 },
    hemi: { sky: "#dcecff", ground: "#9c8a6c", intensity: 0.95 },
  },
  sunset: {
    top: "#2b3a70",
    horizon: "#f3a06a",
    sun: { dir: [-0.35, 0.16, -0.92], color: "#ffb36e", intensity: 2.1, disc: "#ffd28c", size: 95 },
    hemi: { sky: "#ffd1aa", ground: "#4b3a33", intensity: 0.7 },
  },
  night: {
    top: "#050914",
    horizon: "#1b2640",
    sun: { dir: [0.25, 0.7, -0.6], color: "#cfdcff", intensity: 0.55, disc: "#e8eeff", size: 32 },
    hemi: { sky: "#5a6a96", ground: "#0c0c0c", intensity: 0.1 },
  },
};

export const parkSky = (park: Park) => SKY[park.time];
export const parkUrl = (id: string) => asset(`/models/parks/${id}.glb`);

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
/** Gradient sky, sun or moon, and stars at night: a dome that travels with the camera. */
function SkyDome({ look, night }: { look: SkyLook; night: boolean }) {
  const group = useRef<THREE.Group>(null);
  const R = PARK_WORLD.skyRadius;
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { top: { value: new THREE.Color(look.top) }, horizon: { value: new THREE.Color(look.horizon) } },
        vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        // below the horizon the dome is the fog color, so the far terrain fades into it with no seam
        fragmentShader:
          "uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float h = max(vP.y, 0.0); vec3 c = mix(horizon, top, pow(min(1.0, h * 1.5), 0.6)); gl_FragColor = vec4(c, 1.0); }",
      }),
    [look],
  );
  useDispose(mat);
  const stars = useMemo(() => {
    const rng = new Rng("stars");
    const pts: number[] = [];
    for (let i = 0; i < 900; i++) {
      const th = rng.range(0, Math.PI * 2),
        ph = rng.range(0.08, 1.45);
      pts.push(Math.cos(th) * Math.cos(ph) * R * 0.95, Math.sin(ph) * R * 0.95, Math.sin(th) * Math.cos(ph) * R * 0.95);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [R]);
  useDispose(stars);
  const d = new THREE.Vector3(...look.sun.dir).normalize().multiplyScalar(R * 0.9);
  useFrame(({ camera }) => group.current?.position.copy(camera.position));
  return (
    <group ref={group}>
      <mesh material={mat} renderOrder={-10} frustumCulled={false}>
        <sphereGeometry args={[R, 48, 24]} />
      </mesh>
      <mesh position={[d.x, d.y, d.z]} renderOrder={-9} frustumCulled={false}>
        <sphereGeometry args={[look.sun.size, 24, 12]} />
        <meshBasicMaterial color={look.sun.disc} fog={false} toneMapped={false} depthWrite={false} />
      </mesh>
      {night && (
        <points geometry={stars} renderOrder={-9} frustumCulled={false}>
          <pointsMaterial color="#dfe6ff" size={1.2} sizeAttenuation={false} fog={false} depthWrite={false} />
        </points>
      )}
    </group>
  );
}

/** The camera sees as far as the world goes (and no farther). */
function FarPlane() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  useEffect(() => {
    const before = camera.far;
    camera.far = PARK_WORLD.cameraFar;
    camera.updateProjectionMatrix();
    return () => {
      camera.far = before;
      camera.updateProjectionMatrix();
    };
  }, [camera]);
  return null;
}

// ------------------------------------------------------------------ lights
export function ParkLights({ park, shadows }: { park: Park; shadows: boolean }) {
  const key = useRef<THREE.DirectionalLight>(null);
  const look = SKY[park.time];
  useEffect(() => {
    const l = key.current;
    if (!l) return;
    l.shadow.mapSize.set(2048, 2048);
    const cam = l.shadow.camera as THREE.OrthographicCamera;
    cam.left = -26;
    cam.right = 26;
    cam.top = 20;
    cam.bottom = -20;
    cam.near = 1;
    cam.far = 160;
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 0.02;
    l.target.position.set(0, 0, 0);
    l.target.updateMatrixWorld();
  }, []);
  const sun = new THREE.Vector3(...look.sun.dir).normalize().multiplyScalar(70);
  const night = park.time === "night";
  return (
    <>
      <hemisphereLight args={[look.hemi.sky, look.hemi.ground, look.hemi.intensity]} />
      {/* at night the court lights cast the shadows: a key light straight overhead stands in for them */}
      <directionalLight
        ref={key}
        position={night ? [2, 40, 4] : [sun.x, sun.y, sun.z]}
        intensity={night ? 0.32 : look.sun.intensity}
        color={night ? "#fff2dc" : look.sun.color}
        castShadow={shadows}
      />
    </>
  );
}

// ------------------------------------------------------------------ court
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
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]} receiveShadow>
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial map={tex} roughness={park.surface.finish === "asphalt" ? 0.95 : 0.7} metalness={0} />
    </mesh>
  );
}

// ------------------------------------------------------------------ the world
/** Rolling waves for the ocean: a normal map that drifts toward the shore. */
function waveNormals() {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const img = g.createImageData(S, S);
  const rng = new Rng("waves");
  const waves = Array.from({ length: 7 }, () => ({ kx: rng.int(1, 4), kz: rng.int(1, 6), a: rng.range(0.4, 1), p: rng.range(0, 6.28) }));
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let dx = 0,
        dz = 0;
      for (const wv of waves) {
        const ph = ((wv.kx * x + wv.kz * y) / S) * Math.PI * 2 + wv.p;
        dx += Math.cos(ph) * wv.kx * wv.a;
        dz += Math.cos(ph) * wv.kz * wv.a;
      }
      const i = (y * S + x) * 4;
      img.data[i] = 128 + dx * 9;
      img.data[i + 1] = 128 + dz * 9;
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(160, 160);
  return t;
}

function ParkWorld({ park, quality }: { park: Park; quality: Quality }) {
  const gltf = useGLTF(parkUrl(park.id)) as unknown as GLTF;
  const night = park.time === "night";
  const waves = useMemo(() => (park.setting === "beach" ? waveNormals() : null), [park.setting]);
  useEffect(() => () => waves?.dispose(), [waves]);
  const { root, lights } = useMemo(() => {
    const root = gltf.scene.clone(true);
    const lights: THREE.Vector3[] = [];
    const glow = park.time === "night" ? 2.2 : park.time === "sunset" ? 1.1 : 0.0;
    root.traverse((o) => {
      if (o.name.startsWith("Light_")) lights.push(o.getWorldPosition(new THREE.Vector3()));
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      const name = mat.name;
      const ground = /^(Desert|Sand|Grass|Asphalt|DirtGrass|Concrete|Sidewalk|Water|Mountain)/.test(name);
      m.receiveShadow = true;
      m.castShadow = !ground && quality !== "low";
      if (name === "ChainLink") {
        mat.transparent = false;
        mat.alphaTest = 0.5;
        mat.side = THREE.DoubleSide;
        m.castShadow = false;
      } else if (name === "Water") {
        m.material = new THREE.MeshStandardMaterial({
          color: mat.color,
          roughness: 0.12,
          metalness: 0.15,
          normalMap: waves,
          normalScale: new THREE.Vector2(0.6, 0.6),
        });
      } else if (name.startsWith("Glow_")) {
        // lamps are off in the daytime; neon and string lights glow from sunset on
        mat.emissiveIntensity = name === "Glow_Neon" || name === "Glow_Cyan" ? Math.max(0.6, glow) : name === "Glow_City" ? glow * 0.3 : glow;
        mat.toneMapped = glow === 0;
      } else if (name.startsWith("Win_")) {
        mat.emissiveIntensity = night ? 1.1 : 0.2;
      }
    });
    return { root, lights };
  }, [gltf, park, night, quality, waves]);
  useFrame((_, dt) => {
    if (waves) waves.offset.y += dt * 0.004;
  });
  return (
    <group>
      <primitive object={root} />
      {night && lights.slice(0, 4).map((p, i) => <pointLight key={i} position={p} intensity={190} distance={42} decay={2} color="#ffe9c4" />)}
    </group>
  );
}

export function ParkScene({
  park,
  court,
  quality,
  exciteRef,
  reactRef,
}: {
  park: Park;
  court: CourtSpec;
  quality: Quality;
  exciteRef: React.RefObject<number>;
  reactRef: React.RefObject<[number, number]>;
}) {
  const look = SKY[park.time];
  const light = useMemo(
    () => ({
      sunDir: new THREE.Vector3(...(park.time === "night" ? ([0.1, 1, 0.2] as const) : look.sun.dir)),
      sun: new THREE.Color(park.time === "night" ? "#fff2dc" : look.sun.color).multiplyScalar(park.time === "night" ? 0.55 : look.sun.intensity * 0.32),
      sky: new THREE.Color(look.hemi.sky).multiplyScalar(look.hemi.intensity * (park.time === "night" ? 2.2 : 0.62)),
      ground: new THREE.Color(look.hemi.ground).multiplyScalar(look.hemi.intensity * 0.5),
    }),
    [park, look],
  );
  return (
    <group>
      <FarPlane />
      <SkyDome look={look} night={park.time === "night"} />
      <ParkWorld park={park} quality={quality} />
      <ParkCourt court={court} park={park} quality={quality} />
      <Spectators park={park} quality={quality} light={light} exciteRef={exciteRef} reactRef={reactRef} />
    </group>
  );
}

/** Warm the caches for a park before the game screen opens. */
export function preloadPark(id: string) {
  useGLTF.preload(parkUrl(id));
  void useLoader.preload(THREE.FileLoader, spotsUrl(id));
}

// ------------------------------------------------------------------ 3-point contest racks
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
