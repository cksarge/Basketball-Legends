"use client";
import { forwardRef, useMemo } from "react";
import * as THREE from "three";

function ballTexture() {
  const W = 1024,
    H = 512;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#d4622a";
  g.fillRect(0, 0, W, H);
  // pebble grain
  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    img.data[i] += n;
    img.data[i + 1] += n * 0.6;
    img.data[i + 2] += n * 0.4;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = "#1a0f0a";
  g.lineWidth = 7;
  // equator and the great circle through the poles
  g.beginPath();
  g.moveTo(0, H / 2);
  g.lineTo(W, H / 2);
  g.stroke();
  for (const x of [W * 0.25, W * 0.75]) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, H);
    g.stroke();
  }
  // the two curved seams
  for (const off of [0, 0.5]) {
    g.beginPath();
    for (let i = 0; i <= 200; i++) {
      const u = i / 200;
      const v = 0.5 + 0.36 * Math.cos((u + off) * Math.PI * 2);
      if (i === 0) g.moveTo(u * W, v * H);
      else g.lineTo(u * W, v * H);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export const BallMesh = forwardRef<THREE.Mesh, { radius: number }>(function BallMesh({ radius }, ref) {
  const tex = useMemo(() => ballTexture(), []);
  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[radius, 32, 20]} />
      <meshStandardMaterial map={tex} roughness={0.62} metalness={0} />
    </mesh>
  );
});
