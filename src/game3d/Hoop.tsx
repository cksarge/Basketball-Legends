"use client";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { boardX, type CourtSpec, rimPos } from "@/game/court";
import type { Team } from "@/engine/types";
import { displayFont } from "@/lib/fonts";

// ------------------------------------------------------------------- net sim
const NET_COLS = 12,
  NET_ROWS = 6,
  NET_DEPTH = 0.42;

class NetSim {
  p: THREE.Vector3[] = [];
  prev: THREE.Vector3[] = [];
  rest: THREE.Vector3[] = [];
  links: [number, number, number][] = [];
  constructor(
    public center: THREE.Vector3,
    public rimR: number,
  ) {
    for (let r = 0; r <= NET_ROWS; r++) {
      const t = r / NET_ROWS;
      const rad = rimR * (1 - 0.42 * t);
      for (let c = 0; c < NET_COLS; c++) {
        const ang = ((c + (r % 2) * 0.5) / NET_COLS) * Math.PI * 2;
        const v = new THREE.Vector3(center.x + Math.cos(ang) * rad, center.y - t * NET_DEPTH, center.z + Math.sin(ang) * rad);
        this.p.push(v.clone());
        this.prev.push(v.clone());
        this.rest.push(v.clone());
      }
    }
    const id = (r: number, c: number) => r * NET_COLS + ((c + NET_COLS) % NET_COLS);
    for (let r = 0; r < NET_ROWS; r++) {
      for (let c = 0; c < NET_COLS; c++) {
        const a = id(r, c);
        for (const b of [id(r + 1, c), id(r + 1, c + (r % 2 ? 1 : -1))]) {
          this.links.push([a, b, this.rest[a].distanceTo(this.rest[b])]);
        }
      }
    }
  }
  step(dt: number, ball: THREE.Vector3 | null, ballR: number) {
    const g = -9.81 * dt * dt;
    for (let i = NET_COLS; i < this.p.length; i++) {
      const cur = this.p[i],
        prv = this.prev[i];
      const vx = (cur.x - prv.x) * 0.96,
        vy = (cur.y - prv.y) * 0.96,
        vz = (cur.z - prv.z) * 0.96;
      prv.copy(cur);
      cur.x += vx;
      cur.y += vy + g;
      cur.z += vz;
      // spring back toward rest shape
      cur.lerp(this.rest[i], 0.02);
      if (ball) {
        const d = cur.distanceTo(ball);
        if (d < ballR + 0.012)
          cur
            .sub(ball)
            .setLength(ballR + 0.012)
            .add(ball);
      }
    }
    for (let it = 0; it < 4; it++) {
      for (const [a, b, len] of this.links) {
        const pa = this.p[a],
          pb = this.p[b];
        const d = pa.distanceTo(pb) || 1e-6;
        const diff = (d - len) / d;
        const fixedA = a < NET_COLS;
        if (fixedA) pb.lerp(pa, diff);
        else {
          const off = new THREE.Vector3().subVectors(pb, pa).multiplyScalar(diff * 0.5);
          pa.add(off);
          pb.sub(off);
        }
      }
    }
  }
}

function Net({ sim, ballRef }: { sim: NetSim; ballRef: React.RefObject<THREE.Vector3 | null> }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const geom = useMemo(() => new THREE.CylinderGeometry(0.0045, 0.0045, 1, 4, 1, true), []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#f4f4f4", roughness: 0.9 }), []);
  useFrame((_, dt) => {
    sim.step(Math.min(dt, 1 / 30), ballRef.current, 0.12);
    const m = mesh.current;
    if (!m) return;
    sim.links.forEach(([a, b], i) => {
      const pa = sim.p[a],
        pb = sim.p[b];
      tmp.position.copy(pa).add(pb).multiplyScalar(0.5);
      const dir = new THREE.Vector3().subVectors(pb, pa);
      tmp.scale.set(1, dir.length(), 1);
      tmp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geom, mat, sim.links.length]} castShadow frustumCulled={false} />;
}

// ---------------------------------------------------------------- shot clock
function useLedTexture() {
  return useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { canvas, tex };
  }, []);
}

function drawLed(canvas: HTMLCanvasElement, shot: string, game: string) {
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#0a0a0a";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.font = `900 84px ${displayFont()}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#ff3b2f";
  g.shadowColor = "#ff3b2f";
  g.shadowBlur = 14;
  g.fillText(shot, 128, 52);
  g.font = `800 32px ${displayFont()}`;
  g.fillStyle = "#ffb627";
  g.shadowColor = "#ffb627";
  g.fillText(game, 128, 108);
}

// ----------------------------------------------------------------------- hoop
export interface HoopProps {
  court: CourtSpec;
  side: 1 | -1;
  team: Team;
  ceilingHung?: boolean;
  ballRef: React.RefObject<THREE.Vector3 | null>;
  clockRef: React.RefObject<{ shot: number; game: number }>;
  rimShake: React.RefObject<number[]>;
}

export function Hoop({ court, side, team, ceilingHung, ballRef, clockRef, rimShake }: HoopProps) {
  const rim = rimPos(court, side);
  const bx = boardX(court, side);
  const sim = useMemo(() => new NetSim(new THREE.Vector3(rim.x, rim.y - 0.01, rim.z), court.rimRadius), [rim.x, rim.y, rim.z, court.rimRadius]);
  const led = useLedTexture();
  const rimGroup = useRef<THREE.Group>(null);
  const lastDraw = useRef("");

  const boardMat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({ color: "#dfefff", roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, clearcoat: 1, depthWrite: false }),
    [],
  );
  const lineMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#ffffff" }), []);
  const padMat = useMemo(() => new THREE.MeshStandardMaterial({ color: team.colors.primary, roughness: 0.7 }), [team.colors.primary]);
  const steel = useMemo(() => new THREE.MeshStandardMaterial({ color: "#2b2f36", roughness: 0.45, metalness: 0.6 }), []);
  const rimMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#ff5a1f", roughness: 0.35, metalness: 0.4 }), []);

  useEffect(
    () => () => {
      led.tex.dispose();
    },
    [led],
  );

  useFrame(() => {
    const c = clockRef.current;
    if (c) {
      const shot = c.shot >= 10 || c.shot <= 0 ? String(Math.max(0, Math.ceil(c.shot))) : c.shot.toFixed(1);
      const m = Math.floor(c.game / 60),
        sec = Math.floor(c.game % 60);
      const game = c.game >= 60 ? `${m}:${String(sec).padStart(2, "0")}` : c.game.toFixed(1);
      const key = shot + game;
      if (key !== lastDraw.current) {
        drawLed(led.canvas, shot, game);
        led.tex.needsUpdate = true;
        lastDraw.current = key;
      }
    }
    // rim shake after hard contact
    const shake = rimShake.current?.[side === 1 ? 0 : 1] ?? 0;
    if (rimGroup.current) {
      rimGroup.current.rotation.z = Math.sin(performance.now() * 0.06) * shake * 0.05;
      rimGroup.current.position.y = -shake * 0.02;
    }
    if (rimShake.current) rimShake.current[side === 1 ? 0 : 1] = Math.max(0, shake - 0.04);
  });

  const bw = court.boardWidth,
    bh = court.boardHeight,
    bb = court.boardBottom;
  const boardCenterY = bb + bh / 2;
  const facing = side; // board faces -side*x direction
  const innerW = 2 * 0.3048,
    innerH = 1.5 * 0.3048;
  const stripe = 0.05;
  const frame = (w: number, h: number, y: number, t: number) => (
    <group position={[bx - facing * 0.02, y, 0]} rotation={[0, Math.PI / 2, 0]}>
      <mesh position={[0, h / 2 - t / 2, 0]} material={lineMat}>
        <planeGeometry args={[w, t]} />
      </mesh>
      <mesh position={[0, -h / 2 + t / 2, 0]} material={lineMat}>
        <planeGeometry args={[w, t]} />
      </mesh>
      <mesh position={[w / 2 - t / 2, 0, 0]} material={lineMat}>
        <planeGeometry args={[t, h]} />
      </mesh>
      <mesh position={[-w / 2 + t / 2, 0, 0]} material={lineMat}>
        <planeGeometry args={[t, h]} />
      </mesh>
    </group>
  );

  return (
    <group>
      {/* glass */}
      <mesh position={[bx, boardCenterY, 0]} material={boardMat}>
        <boxGeometry args={[0.03, bh, bw]} />
      </mesh>
      {frame(bw, bh, boardCenterY, stripe)}
      {frame(innerW, innerH, rim.y + 0.03 + innerH / 2, stripe * 0.8)}
      {/* board padding along the bottom */}
      <mesh position={[bx, bb - 0.03, 0]} material={padMat}>
        <boxGeometry args={[0.08, 0.07, bw + 0.04]} />
      </mesh>
      {/* shot clock on top of the board */}
      <group position={[bx + side * 0.02, bb + bh + 0.22, 0]}>
        <mesh material={steel}>
          <boxGeometry args={[0.16, 0.36, 0.7]} />
        </mesh>
        <mesh position={[-side * 0.081, 0, 0]} rotation={[0, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}>
          <planeGeometry args={[0.64, 0.32]} />
          <meshBasicMaterial map={led.tex} toneMapped={false} />
        </mesh>
      </group>
      {/* rim + net hooks */}
      <group ref={rimGroup}>
        <mesh position={[rim.x, rim.y, rim.z]} rotation={[Math.PI / 2, 0, 0]} material={rimMat} castShadow>
          <torusGeometry args={[court.rimRadius, 0.0095, 10, 48]} />
        </mesh>
        <mesh position={[(rim.x + bx) / 2 + side * 0.03, rim.y - 0.02, 0]} material={rimMat}>
          <boxGeometry args={[Math.abs(bx - rim.x) - court.rimRadius + 0.06, 0.03, 0.12]} />
        </mesh>
      </group>
      <Net sim={sim} ballRef={ballRef} />
      {/* support */}
      {ceilingHung ? (
        <group>
          <mesh position={[bx + side * 0.35, bb + bh + 2.2, 0]} material={steel}>
            <boxGeometry args={[0.08, 4.4, 0.08]} />
          </mesh>
          <mesh position={[bx + side * 1.4, bb + bh + 2.2, 0]} rotation={[0, 0, side * 0.45]} material={steel}>
            <boxGeometry args={[0.06, 5, 0.06]} />
          </mesh>
        </group>
      ) : (
        <group>
          <mesh position={[bx + side * 0.6, bb + 0.25, 0]} rotation={[0, 0, side * -0.35]} material={steel}>
            <boxGeometry args={[1.3, 0.12, 0.14]} />
          </mesh>
          <mesh position={[bx + side * 1.25, (bb + 0.5) / 2 + 0.3, 0]} material={padMat} castShadow>
            <boxGeometry args={[0.36, bb + 0.1, 0.36]} />
          </mesh>
          <mesh position={[bx + side * 1.7, 0.4, 0]} material={padMat} castShadow receiveShadow>
            <boxGeometry args={[1.6, 0.8, 1.25]} />
          </mesh>
        </group>
      )}
    </group>
  );
}
