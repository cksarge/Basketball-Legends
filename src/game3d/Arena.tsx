"use client";
import { useFrame, useLoader } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BENCH_SEATS, benchSeat, type CourtSpec, tableSeats } from "@/game/court";
import type { Team } from "@/engine/types";
import { Rng } from "@/engine/rng";
import { LAST_NAMES } from "@/engine/names";
import { drawCourt, drawRoughness, FLOOR_MARGIN, floorSize, loadImage, shade } from "./courtTexture";
import { displayFont } from "@/lib/fonts";
import { logoImageSrc } from "@/ui/logo";
import { type ArenaKind, type SeatKind, type VenueVariant, venueStretch, venueUrl } from "./arena/variants";

export type { ArenaKind } from "./arena/variants";
type Quality = "low" | "medium" | "high" | "ultra";
type ScoreRef = React.RefObject<{ h: number; a: number; period: string; clock: string }>;

// --------------------------------------------------------------- floor
export function CourtFloor({ court, home, quality, kind }: { court: CourtSpec; home: Team; quality: Quality; kind: ArenaKind }) {
  const { w, h } = floorSize(court);
  const [tex, setTex] = useState<THREE.CanvasTexture | null>(null);
  const rough = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 256;
    drawRoughness(c);
    const t = new THREE.CanvasTexture(c);
    return t;
  }, []);
  useEffect(() => {
    let cancelled = false;
    const res = quality === "ultra" ? 4096 : quality === "high" ? 4096 : quality === "medium" ? 2048 : 1024;
    // draw at the true aspect ratio, then resample into a power-of-two canvas:
    // GPU mipmap generation for NPOT canvases is unreliable on some drivers.
    const draw = document.createElement("canvas");
    draw.width = res;
    draw.height = Math.round((res * h) / w);
    const pot = document.createElement("canvas");
    pot.width = res;
    pot.height = res / 2;
    const t = new THREE.CanvasTexture(pot);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    drawCourt(draw, court, home, { gym: kind === "gym" }).then(() => {
      if (cancelled) return;
      const g = pot.getContext("2d")!;
      g.imageSmoothingQuality = "high";
      g.drawImage(draw, 0, 0, pot.width, pot.height);
      t.needsUpdate = true;
      setTex(t);
    });
    return () => {
      cancelled = true;
      t.dispose();
    };
  }, [court, home, quality, kind, w, h]);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial
          key={tex ? tex.uuid : "pending"}
          map={tex}
          roughnessMap={rough}
          roughness={0.5}
          metalness={0.02}
          envMapIntensity={0.7}
          color={tex ? "#ffffff" : "#c99055"}
        />
      </mesh>
      {/* surrounding floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[w + 140, h + 130]} />
        <meshStandardMaterial color={kind === "gym" ? "#6b5844" : "#151b24"} roughness={0.9} />
      </mesh>
    </group>
  );
}

// --------------------------------------------------------------- seats data
/** Seat anchors from <venue>.seats.json: [x, y, z, yaw, section] per seat, x/y/z in cm, yaw in degrees. */
interface SeatData {
  v: 1;
  groups: Partial<Record<SeatKind, number[]>>;
}
interface SeatSpot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  section: number;
  kind: SeatKind;
}

function parseSeats(raw: string): SeatSpot[] {
  const d = JSON.parse(raw) as SeatData;
  const out: SeatSpot[] = [];
  for (const [kind, a] of Object.entries(d.groups) as [SeatKind, number[]][]) {
    for (let i = 0; i < a.length; i += 5)
      out.push({ x: a[i] / 100, y: a[i + 1] / 100, z: a[i + 2] / 100, yaw: (a[i + 3] * Math.PI) / 180, section: a[i + 4], kind });
  }
  return out;
}

// --------------------------------------------------------------- crowd
function crowdTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  // head
  g.beginPath();
  g.arc(32, 26, 13, 0, Math.PI * 2);
  g.fill();
  // torso + shoulders
  g.beginPath();
  g.moveTo(10, 128);
  g.lineTo(12, 62);
  g.quadraticCurveTo(14, 44, 32, 44);
  g.quadraticCurveTo(50, 44, 52, 62);
  g.lineTo(54, 128);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  return t;
}

const crowdVertex = /* glsl */ `
attribute vec3 iColor;
attribute float iPhase;
attribute float iSkin;
uniform float uTime;
uniform float uExcite;
varying vec3 vColor;
varying vec2 vUv;
varying float vSkin;
void main() {
  vUv = uv;
  vColor = iColor;
  vSkin = iSkin;
  vec3 p = position;
  float bounce = max(0.0, sin(uTime * (5.0 + iPhase * 3.0) + iPhase * 40.0)) * uExcite * 0.35;
  float stand = smoothstep(0.55, 0.9, uExcite + fract(iPhase * 13.7) * 0.25) * 0.45;
  p.y += bounce + stand;
  p.x += sin(uTime * 1.3 + iPhase * 20.0) * 0.03;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
}`;
const crowdFragment = /* glsl */ `
uniform sampler2D uMap;
varying vec3 vColor;
varying vec2 vUv;
varying float vSkin;
void main() {
  vec4 t = texture2D(uMap, vUv);
  if (t.a < 0.5) discard;
  vec3 skin = mix(vec3(0.95, 0.78, 0.65), vec3(0.32, 0.2, 0.13), vSkin);
  vec3 col = vUv.y > 0.66 ? skin : vColor;
  float shade = 0.55 + 0.45 * vUv.y;
  gl_FragColor = vec4(col * shade, 1.0);
  #include <colorspace_fragment>
}`;

function Crowd({ seats, home, away, density, exciteRef }: { seats: SeatSpot[]; home: Team; away: Team; density: number; exciteRef: React.RefObject<number> }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const rng = useMemo(() => new Rng(`crowd:${home.id}`), [home.id]);
  const chosen = useMemo(() => seats.filter(() => rng.next() < density), [seats, density, rng]);
  const geom = useMemo(() => {
    const g = new THREE.PlaneGeometry(0.5, 1.0);
    g.translate(0, 0.62, 0.06);
    const n = chosen.length;
    const col = new Float32Array(n * 3),
      ph = new Float32Array(n),
      skin = new Float32Array(n);
    const palette = [
      home.colors.primary,
      home.colors.primary,
      home.colors.secondary,
      "#ffffff",
      "#20252e",
      "#3a4a63",
      "#7a2b2b",
      away.colors.primary,
      "#d9d4c7",
      "#556b2f",
    ];
    chosen.forEach((_, i) => {
      const c = new THREE.Color(palette[Math.floor(rng.next() * palette.length)]);
      c.offsetHSL(0, 0, rng.range(-0.08, 0.06));
      col.set([c.r, c.g, c.b], i * 3);
      ph[i] = rng.next();
      skin[i] = rng.next();
    });
    g.setAttribute("iColor", new THREE.InstancedBufferAttribute(col, 3));
    g.setAttribute("iPhase", new THREE.InstancedBufferAttribute(ph, 1));
    g.setAttribute("iSkin", new THREE.InstancedBufferAttribute(skin, 1));
    return g;
  }, [chosen, home, away, rng]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: crowdVertex,
        fragmentShader: crowdFragment,
        uniforms: { uTime: { value: 0 }, uExcite: { value: 0.2 }, uMap: { value: crowdTexture() } },
      }),
    [],
  );
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const o = new THREE.Object3D();
    chosen.forEach((s, i) => {
      o.position.set(s.x, s.y, s.z);
      o.rotation.set(0, s.yaw, 0);
      o.scale.setScalar(0.92 + ((i * 7919) % 100) / 600);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [chosen]);
  useEffect(
    () => () => {
      geom.dispose();
    },
    [geom],
  );
  useFrame((st, dt) => {
    mat.uniforms.uTime.value = st.clock.elapsedTime;
    const target = exciteRef.current ?? 0.2;
    mat.uniforms.uExcite.value = THREE.MathUtils.damp(mat.uniforms.uExcite.value, target, 2.5, dt);
  });
  if (!chosen.length) return null;
  return <instancedMesh ref={mesh} args={[geom, mat, chosen.length]} frustumCulled={false} />;
}

// --------------------------------------------------------------- team dressing
function luminance(hex: string) {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** Seat colour for a section/tier, chosen per team so every venue looks like its own building. */
function seatColorFn(home: Team, venue: VenueVariant) {
  const rng = new Rng(`seats:${home.id}:${venue.id}`);
  const primary = new THREE.Color(home.colors.primary);
  const dark = new THREE.Color(shade(home.colors.primary, 0.5));
  const second = luminance(home.colors.secondary) > 0.8 ? new THREE.Color("#c3c7ce") : new THREE.Color(home.colors.secondary);
  const charcoal = new THREE.Color("#2a2d33");
  const schemes = venue.kind === "gym" ? ["primary", "sections", "primary"] : ["primary", "dark", "sections", "tiers", "charcoal", "tiers"];
  const scheme = rng.pick(schemes);
  return (section: number) => {
    const tier = Math.floor(section / 1000),
      sec = section % 1000;
    switch (scheme) {
      case "dark":
        return dark;
      case "sections":
        return sec % 2 === 0 ? primary : second;
      case "tiers":
        return tier % 2 === 0 ? primary : dark;
      case "charcoal":
        return tier === 0 ? primary : charcoal;
      default:
        return primary;
    }
  };
}

function textCanvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function fitFont(g: CanvasRenderingContext2D, text: string, max: number, size: number, weight = 900) {
  g.font = `${weight} ${size}px ${displayFont()}`;
  while (g.measureText(text).width > max && size > 10) {
    size -= 2;
    g.font = `${weight} ${size}px ${displayFont()}`;
  }
  return size;
}

interface BannerSpec {
  top: string;
  big: string;
  bottom: string;
}

/** Championship and retired-number banners, scaled by program strength. */
function teamBanners(home: Team, venue: VenueVariant, slots: number): BannerSpec[] {
  const rng = new Rng(`banners:${home.id}`);
  const n = Math.max(2, Math.min(slots, Math.round(slots * (0.2 + home.prestige * 0.85))));
  const years = new Set<number>();
  const year = () => {
    for (let k = 0; k < 20; k++) {
      const y = 1962 + rng.int(0, 63);
      if (!years.has(y)) {
        years.add(y);
        return y;
      }
    }
    return 2000 + rng.int(0, 25);
  };
  const out: BannerSpec[] = [];
  const retired = Math.min(n - 1, Math.round(n * 0.3));
  for (let i = 0; i < n - retired; i++) {
    const big = String(year());
    if (venue.kind === "gym") {
      const state = rng.next() < 0.25 + home.prestige * 0.4;
      out.push({ top: state ? "STATE CHAMPIONS" : "REGION CHAMPIONS", big, bottom: home.tier ? `CLASS ${home.tier}` : "BOYS BASKETBALL" });
    } else if (home.league === "college" && venue.kind === "college") {
      const r = rng.next();
      const top = r < 0.08 + home.prestige * 0.15 ? "NATIONAL CHAMPIONS" : r < 0.45 ? "CONFERENCE CHAMPIONS" : "NATIONAL TOURNAMENT";
      out.push({ top, big, bottom: home.nickname.toUpperCase() });
    } else {
      const r = rng.next();
      out.push({ top: r < 0.3 + home.prestige * 0.3 ? "CHAMPIONS" : "CONFERENCE CHAMPIONS", big, bottom: home.name.toUpperCase() });
    }
  }
  for (let i = 0; i < retired; i++) out.push({ top: "RETIRED", big: String(rng.int(0, 55)), bottom: rng.pick(LAST_NAMES).toUpperCase() });
  out.sort((a, b) => (a.top === "RETIRED" ? 1 : 0) - (b.top === "RETIRED" ? 1 : 0) || Number(a.big) - Number(b.big));
  return out;
}

function bannerTexture(home: Team, b: BannerSpec) {
  return textCanvas(256, 480, (g) => {
    const retired = b.top === "RETIRED";
    g.fillStyle = retired ? home.colors.secondary : home.colors.primary;
    g.fillRect(0, 0, 256, 480);
    const fg = retired ? home.colors.primary : luminance(home.colors.primary) > 0.75 ? "#11151c" : "#ffffff";
    g.fillStyle = home.colors.accent;
    g.fillRect(0, 400, 256, 80);
    g.fillStyle = retired ? home.colors.primary : home.colors.secondary;
    g.fillRect(0, 388, 256, 12);
    // pointed bottom
    g.clearRect(0, 470, 256, 10);
    g.fillStyle = fg;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const words = b.top.split(" ");
    fitFont(g, words[0], 220, 38);
    g.fillText(words[0], 128, 70);
    if (words[1]) {
      fitFont(g, words[1], 220, 38);
      g.fillText(words[1], 128, 116);
    }
    fitFont(g, b.big, 220, retired ? 170 : 92);
    g.fillText(b.big, 128, retired ? 260 : 240);
    g.fillStyle = luminance(home.colors.accent) > 0.6 ? "#11151c" : "#ffffff";
    fitFont(g, b.bottom, 230, 30, 800);
    g.fillText(b.bottom, 128, 440);
  });
}

function wordmarkTexture(home: Team, venue: VenueVariant) {
  const text = venue.kind === "gym" ? `HOME OF THE ${home.nickname}`.toUpperCase() : `${home.name} ${home.nickname}`.toUpperCase();
  return textCanvas(2048, 170, (g) => {
    g.textAlign = "center";
    g.textBaseline = "middle";
    fitFont(g, text, 1960, 140);
    g.lineWidth = 10;
    g.strokeStyle = luminance(home.colors.secondary) > 0.8 ? shade(home.colors.primary, 0.4) : home.colors.secondary;
    g.strokeText(text, 1024, 92);
    g.fillStyle = home.colors.primary;
    g.fillText(text, 1024, 92);
  });
}

/** LED ribbon: two 4:1 panels side by side; the GLB's U runs in panel widths. */
function ribbonTexture(home: Team) {
  const pw = 1024,
    ph = 256;
  const t = textCanvas(pw * 2, ph, (g) => {
    const panels: [string, string, string][] = [
      ["#0b0f15", home.colors.secondary === "#ffffff" ? home.colors.primary : home.colors.secondary, "BASKETBALL LEGENDS"],
      [home.colors.primary, home.colors.accent, `${home.name} ${home.nickname}`.toUpperCase()],
    ];
    panels.forEach(([bg, fg, text], i) => {
      const x0 = i * pw;
      g.fillStyle = bg;
      g.fillRect(x0, 0, pw, ph);
      g.fillStyle = fg;
      g.textAlign = "center";
      g.textBaseline = "middle";
      const size = fitFont(g, text, pw * 0.88, 150);
      g.fillText(text, x0 + pw / 2, ph / 2 + size * 0.04);
      // thin LED-style top and bottom rails
      g.fillStyle = "rgba(255,255,255,0.12)";
      g.fillRect(x0, 0, pw, 6);
      g.fillRect(x0, ph - 6, pw, 6);
    });
  });
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Copy a (possibly quantized) glTF geometry into plain float attributes with the node transform baked in. */
function floatGeometry(src: THREE.BufferGeometry, m: THREE.Matrix4) {
  const g = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "uv"] as const) {
    const a = src.getAttribute(name);
    if (!a) continue;
    const arr = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(i, k);
    g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  if (src.index) g.setIndex(Array.from(src.index.array));
  g.applyMatrix4(m);
  return g;
}

interface SeatModelPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  tinted: boolean;
}

interface DressedVenue {
  root: THREE.Group;
  seatModels: Partial<Record<SeatKind, SeatModelPart[]>>;
  screen: THREE.MeshBasicMaterial;
  dispose: () => void;
}

/** Clone the venue and paint it for the home team. */
function dressVenue(scene: THREE.Group, venue: VenueVariant, home: Team): DressedVenue {
  const root = scene.clone(true);
  root.updateMatrixWorld(true);
  const owned: { dispose(): void }[] = [];
  const mats = new Map<string, THREE.Material>();
  const teamColor: Record<string, string> = {
    Team_Primary: home.colors.primary,
    Team_Secondary: luminance(home.colors.secondary) > 0.85 ? "#e9ebee" : home.colors.secondary,
    Team_Dark: shade(home.colors.primary, 0.35),
    Team_Pad: home.colors.primary,
    Team_Curtain: shade(home.colors.primary, 0.75),
    Team_Bleacher: shade(home.colors.primary, 0.8),
    Team_WallPaint: home.colors.primary,
  };
  const screenCanvas = document.createElement("canvas");
  screenCanvas.width = 512;
  screenCanvas.height = 288;
  // glTF UVs put v = 0 at the top, so every texture laid on the venue's own quads skips the Y flip
  const screenTex = new THREE.CanvasTexture(screenCanvas);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  screenTex.flipY = false;
  const screen = new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false, side: THREE.DoubleSide });
  // one-sided: the GLB carries a separately mapped face for each viewing side
  const ribbon = new THREE.MeshBasicMaterial({ map: ribbonTexture(home), toneMapped: false });
  ribbon.map!.repeat.set(0.5, 1);
  ribbon.map!.flipY = false;
  owned.push(screenTex, screen, ribbon, ribbon.map!);

  const remap = (m: THREE.Material): THREE.Material => {
    const hit = mats.get(m.name);
    if (hit) return hit;
    let out: THREE.Material = m;
    if (m.name === "Screen") out = screen;
    else if (m.name === "Ribbon") out = ribbon;
    else if (m.name in teamColor) {
      const c = (m as THREE.MeshStandardMaterial).clone();
      c.color.set(teamColor[m.name]);
      out = c;
      owned.push(c);
    } else if (m.name === "Glass") {
      const c = (m as THREE.MeshStandardMaterial).clone();
      c.depthWrite = false;
      out = c;
      owned.push(c);
    }
    mats.set(m.name, out);
    return out;
  };

  const seatModels: DressedVenue["seatModels"] = {};
  const banners: THREE.Mesh[] = [];
  const remove: THREE.Object3D[] = [];
  root.traverse((o) => {
    const name = o.name;
    if (name.startsWith("SeatModel_")) {
      const kind = name.slice("SeatModel_".length) as SeatKind;
      const parts: SeatModelPart[] = [];
      const inv = new THREE.Matrix4().copy(o.matrixWorld).invert();
      o.traverse((c) => {
        const mesh = c as THREE.Mesh;
        if (!mesh.isMesh) return;
        const rel = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
        const geometry = floatGeometry(mesh.geometry, rel);
        const src = mesh.material as THREE.MeshStandardMaterial;
        const tinted = src.name === "Seat";
        const material = src.clone();
        if (tinted) material.color.set("#ffffff");
        parts.push({ geometry, material, tinted });
        owned.push(geometry, material);
      });
      seatModels[kind] = parts;
      remove.push(o);
      return;
    }
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    if (name.startsWith("Banner_")) banners.push(mesh);
    else if (name.startsWith("WallLogo_") || name.startsWith("WallName_")) {
      /* textured below */
    } else mesh.material = Array.isArray(mesh.material) ? mesh.material.map(remap) : remap(mesh.material);
  });
  for (const o of remove) o.removeFromParent();

  // banners
  banners.sort((a, b) => a.name.localeCompare(b.name));
  const specs = teamBanners(home, venue, banners.length);
  banners.forEach((b, i) => {
    if (i >= specs.length) {
      b.visible = false;
      return;
    }
    const map = bannerTexture(home, specs[i]);
    map.flipY = false;
    const m = new THREE.MeshStandardMaterial({ map, roughness: 0.85, side: THREE.DoubleSide, transparent: true, alphaTest: 0.5 });
    b.material = m;
    owned.push(map, m);
  });
  // wordmarks and logos
  const word = wordmarkTexture(home, venue);
  word.flipY = false;
  owned.push(word);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (o.name.startsWith("WallName_")) {
      const m = new THREE.MeshStandardMaterial({ map: word, roughness: 0.9, transparent: true, alphaTest: 0.4 });
      mesh.material = m;
      owned.push(m);
    } else if (o.name.startsWith("WallLogo_")) {
      const m = new THREE.MeshStandardMaterial({ roughness: 0.8, transparent: true, alphaTest: 0.4, visible: false });
      mesh.material = m;
      owned.push(m);
      loadImage(logoImageSrc(home.logo, home.colors, 1024))
        .then((img) => {
          const t = new THREE.Texture(img);
          t.colorSpace = THREE.SRGBColorSpace;
          t.flipY = false;
          t.anisotropy = 4;
          t.needsUpdate = true;
          m.map = t;
          m.visible = true;
          m.needsUpdate = true;
          owned.push(t);
        })
        .catch(() => {
          /* the wall stays plain if the logo can't be rasterized */
        });
    }
  });
  return { root, seatModels, screen, dispose: () => owned.forEach((d) => d.dispose()) };
}

/** Instanced chairs / bleacher seats, coloured by the team's seating scheme. */
function SeatRows({ seats, models, home, venue }: { seats: SeatSpot[]; models: DressedVenue["seatModels"]; home: Team; venue: VenueVariant }) {
  const meshes = useMemo(() => {
    const color = seatColorFn(home, venue);
    const out: THREE.InstancedMesh[] = [];
    const o = new THREE.Object3D();
    for (const [kind, parts] of Object.entries(models) as [SeatKind, SeatModelPart[]][]) {
      const list = seats.filter((s) => s.kind === kind);
      if (!list.length) continue;
      for (const p of parts) {
        const im = new THREE.InstancedMesh(p.geometry, p.material, list.length);
        list.forEach((s, i) => {
          o.position.set(s.x, s.y, s.z);
          o.rotation.set(0, s.yaw, 0);
          o.updateMatrix();
          im.setMatrixAt(i, o.matrix);
          if (p.tinted) im.setColorAt(i, color(s.section));
        });
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.receiveShadow = true;
        out.push(im);
      }
    }
    return out;
  }, [seats, models, home, venue]);
  useEffect(() => () => meshes.forEach((m) => m.dispose()), [meshes]);
  return (
    <>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </>
  );
}

// --------------------------------------------------------------- scoreboards
/** Draws the live score onto every Screen face: a classic scoreboard in small gyms, video boards elsewhere. */
function ScreenDriver({ mat, scoreRef, home, away, venue }: { mat: THREE.MeshBasicMaterial; scoreRef: ScoreRef; home: Team; away: Team; venue: VenueVariant }) {
  const last = useRef("");
  const classic = venue.style.scoreboards === "wall";
  useFrame(() => {
    const s = scoreRef.current;
    const tex = mat.map as THREE.CanvasTexture | null;
    if (!s || !tex) return;
    const key = `${mat.uuid}-${s.h}-${s.a}-${s.period}-${s.clock}`;
    if (key === last.current) return;
    last.current = key;
    const canvas = tex.image as HTMLCanvasElement;
    const g = canvas.getContext("2d")!;
    const W = canvas.width,
      H = canvas.height;
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    if (classic) {
      g.fillStyle = "#07090c";
      g.fillRect(0, 0, W, H);
      g.fillStyle = "#141820";
      g.fillRect(10, 10, W - 20, H - 20);
      g.fillStyle = "#e9e4d8";
      g.font = `800 30px ${displayFont()}`;
      g.fillText("HOME", 96, 54);
      g.fillText("GUEST", W - 96, 54);
      g.fillText("PERIOD", W / 2, 186);
      g.fillStyle = "#ffb627";
      g.font = `900 92px ${displayFont()}`;
      g.fillText(String(s.h), 96, 150);
      g.fillText(String(s.a), W - 96, 150);
      g.fillStyle = "#ff3b2f";
      g.font = `900 78px ${displayFont()}`;
      g.fillText(s.clock, W / 2, 124);
      g.fillStyle = "#ffb627";
      g.font = `900 64px ${displayFont()}`;
      g.fillText(s.period.replace(/^Q/, ""), W / 2, 254);
      g.fillStyle = "#e9e4d8";
      g.font = `800 26px ${displayFont()}`;
      g.fillText(home.abbrev, 96, 214);
      g.fillText(away.abbrev, W - 96, 214);
    } else {
      g.fillStyle = "#05080d";
      g.fillRect(0, 0, W, H);
      const half = (team: Team, x: number, score: number) => {
        g.fillStyle = team.colors.primary;
        g.fillRect(x, 20, 236, 170);
        g.fillStyle = "#fff";
        g.font = `900 40px ${displayFont()}`;
        g.fillText(team.abbrev, x + 118, 66);
        g.font = `900 104px ${displayFont()}`;
        g.fillText(String(score), x + 118, 172);
      };
      half(away, 14, s.a);
      half(home, 262, s.h);
      g.fillStyle = "#ffb627";
      g.font = `800 54px ${displayFont()}`;
      g.fillText(`${s.period}  ${s.clock}`, 256, 254);
    }
    tex.needsUpdate = true;
  });
  return null;
}

// --------------------------------------------------------------- arena
export interface ArenaProps {
  court: CourtSpec;
  home: Team;
  away: Team;
  venue: VenueVariant;
  quality: Quality;
  crowdDensity: number;
  exciteRef: React.RefObject<number>;
  scoreRef: ScoreRef;
}

export function Arena({ court, home, away, venue, quality, crowdDensity, exciteRef, scoreRef }: ArenaProps) {
  const urls = venueUrl(venue.id);
  const gltf = useGLTF(urls.glb) as unknown as GLTF;
  const rawSeats = useLoader(THREE.FileLoader, urls.seats) as string;
  const seats = useMemo(() => parseSeats(rawSeats), [rawSeats]);
  const dressed = useMemo(() => dressVenue(gltf.scene, venue, home), [gltf.scene, venue, home]);
  useEffect(() => () => dressed.dispose(), [dressed]);
  const sx = venueStretch(venue, court);
  // turnout: big programs pack the building
  const turnout = venue.kind === "pro" ? 0.82 + home.prestige * 0.18 : venue.kind === "college" ? 0.6 + home.prestige * 0.4 : 0.5 + home.prestige * 0.45;
  // Courtside boards: each panel is 4:1 on the canvas and drawn 3.6 m x 0.9 m on the
  // board, so the text keeps its proportions instead of being squeezed.
  const BOARD_H = 0.9,
    PANEL_W = BOARD_H * 4;
  const boardTex = useMemo(() => {
    const t = ribbonTexture(home);
    // one texture = two panels; repeat so each panel spans PANEL_W meters
    t.repeat.set((court.length * 0.9) / (PANEL_W * 2), 1);
    return t;
  }, [home, court.length, PANEL_W]);
  useEffect(() => () => boardTex.dispose(), [boardTex]);

  return (
    <group>
      <CourtFloor court={court} home={home} quality={quality} kind={venue.kind} />
      <group scale={[sx, 1, 1]}>
        <primitive object={dressed.root} />
        {quality !== "low" && <SeatRows seats={seats} models={dressed.seatModels} home={home} venue={venue} />}
        <Crowd seats={seats} home={home} away={away} density={Math.min(1, crowdDensity * turnout)} exciteRef={exciteRef} />
      </group>
      {venue.style.adBoards &&
        [1, -1].map((s) => (
          <mesh key={s} position={[0, 0.45, s * (court.halfW + FLOOR_MARGIN.z + 0.6)]} rotation={[0, s > 0 ? Math.PI : 0, 0]}>
            <planeGeometry args={[court.length * 0.9, BOARD_H]} />
            <meshBasicMaterial map={boardTex} toneMapped={false} />
          </mesh>
        ))}
      <BenchArea court={court} home={home} away={away} />
      <ScreenDriver mat={dressed.screen} scoreRef={scoreRef} home={home} away={away} venue={venue} />
    </group>
  );
}

/** Scorer's table, bench chairs (seat height matches Players' SEAT_HEIGHT), coolers and towels. */
function BenchArea({ court, home, away }: { court: CourtSpec; home: Team; away: Team }) {
  const chairs = useMemo(() => {
    // one chair = metal frame + cushion + back pad, instanced 2 x BENCH_SEATS
    const leg = (x: number, z: number) => new THREE.BoxGeometry(0.035, 0.42, 0.035).translate(x, 0.21, z);
    const frame = mergeGeometries([
      leg(-0.2, -0.19),
      leg(0.2, -0.19),
      leg(-0.2, 0.19),
      leg(0.2, 0.19),
      new THREE.BoxGeometry(0.035, 0.6, 0.035).translate(-0.2, 0.72, -0.21),
      new THREE.BoxGeometry(0.035, 0.6, 0.035).translate(0.2, 0.72, -0.21),
      new THREE.BoxGeometry(0.46, 0.04, 0.44).translate(0, 0.42, 0),
    ])!;
    const cushion = new THREE.BoxGeometry(0.46, 0.08, 0.44).translate(0, 0.46, 0);
    const back = new THREE.BoxGeometry(0.46, 0.4, 0.07).translate(0, 0.82, -0.23);
    const crewSeats = tableSeats(court);
    const n = BENCH_SEATS * 2 + crewSeats.length;
    const frameMesh = new THREE.InstancedMesh(frame, new THREE.MeshStandardMaterial({ color: "#2a2e35", metalness: 0.7, roughness: 0.35 }), n);
    const padMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.55 });
    const cushionMesh = new THREE.InstancedMesh(cushion, padMat, n);
    const backMesh = new THREE.InstancedMesh(back, padMat, n);
    const m = new THREE.Matrix4();
    let k = 0;
    for (const ti of [0, 1] as const) {
      const col = new THREE.Color(ti === 0 ? home.colors.primary : away.colors.primary);
      for (let i = 0; i < BENCH_SEATS; i++, k++) {
        const p = benchSeat(court, ti, i);
        m.makeTranslation(p.x, 0, p.z);
        for (const im of [frameMesh, cushionMesh, backMesh]) im.setMatrixAt(k, m);
        cushionMesh.setColorAt(k, col);
        backMesh.setColorAt(k, col);
      }
    }
    // the table crew's chairs, in neutral black
    for (const p of crewSeats) {
      m.makeTranslation(p.x, 0, p.z);
      for (const im of [frameMesh, cushionMesh, backMesh]) im.setMatrixAt(k, m);
      cushionMesh.setColorAt(k, new THREE.Color("#1b1d21"));
      backMesh.setColorAt(k, new THREE.Color("#1b1d21"));
      k++;
    }
    for (const im of [frameMesh, cushionMesh, backMesh]) {
      im.castShadow = true;
      im.receiveShadow = true;
      im.instanceMatrix.needsUpdate = true;
    }
    return [frameMesh, cushionMesh, backMesh];
  }, [court, home, away]);
  useEffect(
    () => () => {
      for (const c of chairs) {
        c.geometry.dispose();
        (c.material as THREE.Material).dispose();
      }
    },
    [chairs],
  );

  const tableTex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 2048;
    c.height = 256;
    const g = c.getContext("2d")!;
    g.fillStyle = "#07090d";
    g.fillRect(0, 0, 2048, 256);
    const third = 2048 / 3;
    const cells: [string, string, string][] = [
      [away.colors.primary, away.colors.accent, away.name.toUpperCase()],
      ["#0b0f15", "#ffb627", "BASKETBALL LEGENDS"],
      [home.colors.primary, home.colors.accent, home.name.toUpperCase()],
    ];
    cells.forEach(([bg, fg, text], i) => {
      g.fillStyle = bg;
      g.fillRect(i * third + 8, 10, third - 16, 236);
      g.fillStyle = fg;
      g.textAlign = "center";
      g.textBaseline = "middle";
      fitFont(g, text, third * 0.86, 120);
      g.fillText(text, i * third + third / 2, 132);
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [home, away]);
  const tableZ = -(court.halfW + 1.25);
  const tableW = Math.min(7, court.halfL * 0.75);
  return (
    <group>
      {chairs.map((c, i) => (
        <primitive key={i} object={c} />
      ))}
      {/* scorer's table: LED front, dark top, a row of monitors */}
      <mesh position={[0, 0.39, tableZ]} castShadow receiveShadow>
        <boxGeometry args={[tableW, 0.78, 0.7]} />
        <meshStandardMaterial color="#111419" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.39, tableZ + 0.352]}>
        <planeGeometry args={[tableW, 0.7]} />
        <meshBasicMaterial map={tableTex} toneMapped={false} />
      </mesh>
      {Array.from({ length: 5 }, (_, i) => (
        <mesh key={i} position={[(i - 2) * (tableW / 5.5), 0.93, tableZ - 0.1]} rotation={[0.25, 0, 0]} castShadow>
          <boxGeometry args={[0.5, 0.32, 0.04]} />
          <meshStandardMaterial color="#1a1d22" roughness={0.4} />
        </mesh>
      ))}
      {/* coolers and towel stacks at the end of each bench */}
      {([0, 1] as const).map((ti) => {
        const p = benchSeat(court, ti, BENCH_SEATS);
        const col = ti === 0 ? home.colors.primary : away.colors.primary;
        return (
          <group key={ti} position={[p.x, 0, p.z]}>
            <mesh position={[0, 0.3, 0]} castShadow>
              <cylinderGeometry args={[0.2, 0.2, 0.6, 20]} />
              <meshStandardMaterial color="#e8eaed" roughness={0.35} />
            </mesh>
            <mesh position={[0, 0.63, 0]}>
              <cylinderGeometry args={[0.21, 0.21, 0.07, 20]} />
              <meshStandardMaterial color={col} roughness={0.4} />
            </mesh>
            <mesh position={[ti === 0 ? 0.42 : -0.42, 0.12, 0]} castShadow>
              <boxGeometry args={[0.36, 0.24, 0.3]} />
              <meshStandardMaterial color="#f4f4f2" roughness={0.95} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
