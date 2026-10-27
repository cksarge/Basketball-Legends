"use client";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { BENCH_SEATS, benchSeat, type CourtSpec, tableSeats } from "@/game/court";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Team } from "@/engine/types";
import { Rng } from "@/engine/rng";
import { drawCourt, drawRoughness, FLOOR_MARGIN, floorSize } from "./courtTexture";
import { displayFont } from "@/lib/fonts";

export type ArenaKind = "pro" | "college" | "gym";

// --------------------------------------------------------------- floor
export function CourtFloor({ court, home, quality, kind }: { court: CourtSpec; home: Team; quality: "low" | "medium" | "high" | "ultra"; kind: ArenaKind }) {
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
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]} receiveShadow>
        <planeGeometry args={[w + 30, h + 30]} />
        <meshStandardMaterial color={kind === "gym" ? "#6b5844" : "#151b24"} roughness={0.9} />
      </mesh>
    </group>
  );
}

// --------------------------------------------------------------- bowl
interface SeatSpot {
  pos: THREE.Vector3;
  face: number;
  row: number;
}

function roundedRectPath(hx: number, hz: number, r: number, n = 18): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const corners = [
    [hx - r, hz - r, 0],
    [-(hx - r), hz - r, Math.PI / 2],
    [-(hx - r), -(hz - r), Math.PI],
    [hx - r, -(hz - r), Math.PI * 1.5],
  ];
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * (Math.PI / 2);
      pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cz + Math.sin(a) * r));
    }
  }
  return pts;
}

function buildBowl(opts: { hx: number; hz: number; radius: number; rows: number; depth: number; rise: number; y0: number; gap?: number }) {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const seats: SeatSpot[] = [];
  let vi = 0;
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, n: THREE.Vector3) => {
    for (const v of [a, b, c, d]) {
      positions.push(v.x, v.y, v.z);
      normals.push(n.x, n.y, n.z);
    }
    indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
    vi += 4;
  };
  for (let r = 0; r < opts.rows; r++) {
    const off = r * opts.depth;
    const path = roundedRectPath(opts.hx + off, opts.hz + off, opts.radius + off);
    const path2 = roundedRectPath(opts.hx + off + opts.depth, opts.hz + off + opts.depth, opts.radius + off + opts.depth);
    const y = opts.y0 + r * opts.rise;
    for (let i = 0; i < path.length; i++) {
      const j = (i + 1) % path.length;
      const a = new THREE.Vector3(path[i].x, y, path[i].y),
        b = new THREE.Vector3(path[j].x, y, path[j].y);
      const c = new THREE.Vector3(path2[j].x, y, path2[j].y),
        d = new THREE.Vector3(path2[i].x, y, path2[i].y);
      quad(a, b, c, d, new THREE.Vector3(0, 1, 0));
      // riser to the next row
      const c2 = c.clone().setY(y + opts.rise),
        d2 = d.clone().setY(y + opts.rise);
      const nrm = new THREE.Vector3(-(path2[i].x + path2[j].x), 0, -(path2[i].y + path2[j].y)).normalize();
      quad(d, c, c2, d2, nrm);
    }
    // seats along the row centre, every 0.55 m of arc length (gaps for aisles)
    const mid = path.map((pt, i) => new THREE.Vector2().lerpVectors(pt, path2[i], 0.55));
    let carry = 0,
      count = 0;
    for (let i = 0; i < mid.length; i++) {
      const pa = mid[i],
        pb = mid[(i + 1) % mid.length];
      const segLen = pa.distanceTo(pb);
      let d = carry;
      while (d < segLen) {
        const pt = new THREE.Vector2().lerpVectors(pa, pb, d / segLen);
        if (++count % 16 !== 0) seats.push({ pos: new THREE.Vector3(pt.x, y, pt.y), face: Math.atan2(-pt.x, -pt.y), row: r });
        d += 0.55;
      }
      carry = d - segLen;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  g.setIndex(indices);
  return { geometry: g, seats };
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
    g.translate(0, 0.62, 0);
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
      o.position.copy(s.pos);
      o.rotation.set(0, s.face, 0);
      o.scale.setScalar(0.92 + ((i * 7919) % 100) / 600);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [chosen]);
  useFrame((st, dt) => {
    mat.uniforms.uTime.value = st.clock.elapsedTime;
    const target = exciteRef.current ?? 0.2;
    mat.uniforms.uExcite.value = THREE.MathUtils.damp(mat.uniforms.uExcite.value, target, 2.5, dt);
  });
  if (!chosen.length) return null;
  return <instancedMesh ref={mesh} args={[geom, mat, chosen.length]} frustumCulled={false} />;
}

// --------------------------------------------------------------- jumbotron
function Jumbotron({
  y,
  scoreRef,
  home,
  away,
}: {
  y: number;
  scoreRef: React.RefObject<{ h: number; a: number; period: string; clock: string }>;
  home: Team;
  away: Team;
}) {
  const { canvas, tex } = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 288;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { canvas, tex };
  }, []);
  const last = useRef("");
  useFrame(() => {
    const s = scoreRef.current;
    if (!s) return;
    const key = `${s.h}-${s.a}-${s.period}-${s.clock}`;
    if (key === last.current) return;
    last.current = key;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#05080d";
    g.fillRect(0, 0, 512, 288);
    const half = (team: Team, x: number, score: number) => {
      g.fillStyle = team.colors.primary;
      g.fillRect(x, 20, 236, 170);
      g.fillStyle = "#fff";
      g.font = `900 40px ${displayFont()}`;
      g.textAlign = "center";
      g.fillText(team.abbrev, x + 118, 66);
      g.font = `900 104px ${displayFont()}`;
      g.fillText(String(score), x + 118, 172);
    };
    half(away, 14, s.a);
    half(home, 262, s.h);
    g.fillStyle = "#ffb627";
    g.font = `800 54px ${displayFont()}`;
    g.textAlign = "center";
    g.fillText(`${s.period}  ${s.clock}`, 256, 254);
    tex.needsUpdate = true;
  });
  const frameMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#11151c", roughness: 0.5, metalness: 0.5 }), []);
  return (
    <group position={[0, y, 0]}>
      <mesh material={frameMat}>
        <boxGeometry args={[5.6, 3.4, 4.4]} />
      </mesh>
      {[0, 1, 2, 3].map((k) => {
        const ang = (k * Math.PI) / 2;
        const d = k % 2 === 0 ? 2.21 : 2.81;
        const w = k % 2 === 0 ? 5.3 : 4.1;
        return (
          <mesh key={k} position={[Math.sin(ang) * d, 0, Math.cos(ang) * d]} rotation={[0, ang, 0]}>
            <planeGeometry args={[w, 3.0]} />
            <meshBasicMaterial map={tex} toneMapped={false} />
          </mesh>
        );
      })}
      <mesh position={[0, -2.1, 0]} material={frameMat}>
        <cylinderGeometry args={[2.2, 2.6, 0.8, 24]} />
      </mesh>
    </group>
  );
}

// --------------------------------------------------------------- arena
export interface ArenaProps {
  court: CourtSpec;
  home: Team;
  away: Team;
  kind: ArenaKind;
  quality: "low" | "medium" | "high" | "ultra";
  crowdDensity: number;
  exciteRef: React.RefObject<number>;
  scoreRef: React.RefObject<{ h: number; a: number; period: string; clock: string }>;
}

export function Arena({ court, home, away, kind, quality, crowdDensity, exciteRef, scoreRef }: ArenaProps) {
  const { w, h } = floorSize(court);
  const lower = useMemo(
    () =>
      buildBowl({
        hx: w / 2 + 1.6,
        hz: h / 2 + 1.6,
        radius: 4,
        rows: kind === "gym" ? 9 : kind === "college" ? 16 : 20,
        depth: 0.82,
        rise: kind === "gym" ? 0.38 : 0.42,
        y0: 0.45,
      }),
    [w, h, kind],
  );
  const upper = useMemo(
    () =>
      kind === "gym"
        ? null
        : buildBowl({
            hx: w / 2 + 1.6 + 20 * 0.82 + 2.5,
            hz: h / 2 + 1.6 + 20 * 0.82 + 2.5,
            radius: 10,
            rows: kind === "pro" ? 18 : 10,
            depth: 0.85,
            rise: 0.6,
            y0: 12.5,
          }),
    [w, h, kind],
  );
  const seatMat = useMemo(() => new THREE.MeshStandardMaterial({ color: kind === "gym" ? "#9a7b55" : "#1d2430", roughness: 0.85 }), [kind]);
  const seats = useMemo(() => [...lower.seats, ...(upper?.seats ?? [])], [lower, upper]);
  const roofY = kind === "gym" ? 11 : 32;
  // Courtside boards: each panel is 4:1 on the canvas and drawn 3.6 m x 0.9 m on the
  // board, so the text keeps its proportions instead of being squeezed.
  const BOARD_H = 0.9,
    PANEL_W = BOARD_H * 4;
  const ribbonTex = useMemo(() => {
    const c = document.createElement("canvas");
    const pw = 1024,
      ph = 256;
    c.width = pw * 2;
    c.height = ph;
    const g = c.getContext("2d")!;
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
      let size = 150;
      g.font = `900 ${size}px ${displayFont()}`;
      while (g.measureText(text).width > pw * 0.88 && size > 60) {
        size -= 6;
        g.font = `900 ${size}px ${displayFont()}`;
      }
      g.fillText(text, x0 + pw / 2, ph / 2 + size * 0.04);
      // thin LED-style top and bottom rails
      g.fillStyle = "rgba(255,255,255,0.12)";
      g.fillRect(x0, 0, pw, 6);
      g.fillRect(x0, ph - 6, pw, 6);
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.anisotropy = 8;
    // one texture = two panels; repeat so each panel spans PANEL_W meters
    t.repeat.set((court.length * 0.9) / (PANEL_W * 2), 1);
    return t;
  }, [home, court.length, PANEL_W]);

  return (
    <group>
      <CourtFloor court={court} home={home} quality={quality} kind={kind} />
      <mesh geometry={lower.geometry} material={seatMat} receiveShadow />
      {upper && <mesh geometry={upper.geometry} material={seatMat} />}
      <Crowd seats={seats} home={home} away={away} density={crowdDensity * (kind === "gym" ? 0.75 : 0.95)} exciteRef={exciteRef} />
      {/* courtside ad boards */}
      {[1, -1].map((s) => (
        <mesh key={s} position={[0, 0.45, s * (court.halfW + FLOOR_MARGIN.z + 0.6)]} rotation={[0, s > 0 ? Math.PI : 0, 0]}>
          <planeGeometry args={[court.length * 0.9, BOARD_H]} />
          <meshBasicMaterial map={ribbonTex} toneMapped={false} />
        </mesh>
      ))}
      <BenchArea court={court} home={home} away={away} />
      {/* walls and roof */}
      <mesh position={[0, roofY / 2 - 0.3, 0]}>
        <boxGeometry args={[w + (kind === "gym" ? 18 : 70), roofY, h + (kind === "gym" ? 18 : 70)]} />
        <meshStandardMaterial attach="material" color={kind === "gym" ? "#cfc6b6" : "#06080c"} roughness={0.95} side={THREE.BackSide} />
      </mesh>
      {kind === "gym" && <GymDressing w={w} h={h} home={home} />}
      {kind !== "gym" && <Jumbotron y={14} scoreRef={scoreRef} home={home} away={away} />}
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
      let size = 120;
      g.font = `900 ${size}px ${displayFont()}`;
      while (g.measureText(text).width > third * 0.86 && size > 40) {
        size -= 4;
        g.font = `900 ${size}px ${displayFont()}`;
      }
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

function GymDressing({ w, h, home }: { w: number; h: number; home: Team }) {
  // championship banners and a painted wall stripe
  const banners = useMemo(() => {
    const rng = new Rng(`banners:${home.id}`);
    const n = 3 + rng.int(0, 5);
    return Array.from({ length: n }, (_, i) => ({ x: -w / 2 + 4 + i * 3.2, year: 1985 + rng.int(0, 38) }));
  }, [home.id, w]);
  const tex = (txt: string) => {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 256;
    const g = c.getContext("2d")!;
    g.fillStyle = home.colors.primary;
    g.fillRect(0, 0, 128, 256);
    g.fillStyle = home.colors.secondary;
    g.fillRect(0, 210, 128, 46);
    g.fillStyle = "#fff";
    g.textAlign = "center";
    g.font = `900 26px ${displayFont()}`;
    g.fillText("STATE", 64, 70);
    g.fillText("CHAMPIONS", 64, 100);
    g.font = `900 44px ${displayFont()}`;
    g.fillText(txt, 64, 160);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return (
    <group>
      {banners.map((b, i) => (
        <mesh key={i} position={[b.x, 7.5, -(h / 2 + 8.9)]}>
          <planeGeometry args={[1.4, 2.8]} />
          <meshStandardMaterial map={tex(String(b.year))} roughness={0.9} />
        </mesh>
      ))}
      <mesh position={[0, 2.2, -(h / 2 + 8.95)]}>
        <planeGeometry args={[w + 17, 0.6]} />
        <meshStandardMaterial color={home.colors.primary} roughness={0.9} />
      </mesh>
    </group>
  );
}
