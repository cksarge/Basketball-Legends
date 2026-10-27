// Procedural hardwood court texture: planks, grain, team paint, regulation lines, logos.
import type { CourtSpec } from "@/game/court";
import type { Team } from "@/engine/types";
import { Rng } from "@/engine/rng";
import { logoImageSrc } from "@/ui/logo";
import { displayFont } from "@/lib/fonts";

export const FLOOR_MARGIN = { x: 2.6, z: 2.2 }; // apron beyond the lines (m)

export function floorSize(c: CourtSpec) {
  return { w: c.length + FLOOR_MARGIN.x * 2, h: c.width + FLOOR_MARGIN.z * 2 };
}

function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((n & 255) * f)));
  return `rgb(${r},${g},${b})`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

export async function drawCourt(canvas: HTMLCanvasElement, c: CourtSpec, home: Team, opts: { woodTone?: "light" | "honey" | "dark"; gym?: boolean } = {}) {
  const { w: FW, h: FH } = floorSize(c);
  const W = canvas.width,
    H = canvas.height;
  const ppm = W / FW; // pixels per meter
  const g = canvas.getContext("2d")!;
  const rng = new Rng(`court:${home.id}`);
  const tone = opts.woodTone ?? (opts.gym ? "light" : "honey");
  const woodBase = tone === "light" ? "#d9b07a" : tone === "dark" ? "#a26a3a" : "#cf9a5e";

  // world (x,z) -> canvas px; floor centered
  const X = (x: number) => (x + FW / 2) * ppm;
  const Z = (z: number) => (z + FH / 2) * ppm;

  // --- planks (run along the length of the court)
  const plankW = 0.057 * ppm; // ~2.25 in
  g.fillStyle = woodBase;
  g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += plankW) {
    let x = -rng.range(0, 2) * ppm;
    while (x < W) {
      const len = rng.range(0.6, 2.4) * ppm;
      const f = 0.9 + rng.next() * 0.2;
      g.fillStyle = shade(woodBase.length === 7 ? woodBase : "#cf9a5e", f);
      g.fillRect(x, y, len, plankW);
      // grain streaks
      g.globalAlpha = 0.08;
      g.strokeStyle = shade(woodBase, 0.6);
      g.lineWidth = 1;
      for (let k = 0; k < 3; k++) {
        const gy = y + rng.range(0.15, 0.85) * plankW;
        g.beginPath();
        g.moveTo(x, gy);
        g.bezierCurveTo(x + len * 0.3, gy + rng.range(-2, 2), x + len * 0.7, gy + rng.range(-2, 2), x + len, gy);
        g.stroke();
      }
      g.globalAlpha = 0.25;
      g.fillStyle = shade(woodBase, 0.55);
      g.fillRect(x + len - 1, y, 1.2, plankW); // end joint
      g.globalAlpha = 1;
      x += len;
    }
    g.globalAlpha = 0.18;
    g.fillStyle = shade(woodBase, 0.5);
    g.fillRect(0, y + plankW - 0.8, W, 0.8);
    g.globalAlpha = 1;
  }

  const pri = home.colors.primary,
    sec = home.colors.secondary;
  const lineCol = "#f6f4ef";
  const lw = Math.max(2, 0.05 * ppm);

  // --- apron outside the boundary in team color
  g.fillStyle = pri;
  g.globalAlpha = 0.92;
  g.fillRect(0, 0, W, Z(-c.halfW));
  g.fillRect(0, Z(c.halfW), W, H - Z(c.halfW));
  g.fillRect(0, 0, X(-c.halfL), H);
  g.fillRect(X(c.halfL), 0, W - X(c.halfL), H);
  g.globalAlpha = 1;

  // --- painted lanes + center circle fill
  for (const side of [1, -1]) {
    const base = side * c.halfL;
    const ft = side * (c.halfL - c.laneLength);
    g.fillStyle = pri;
    g.globalAlpha = 0.88;
    g.fillRect(Math.min(X(base), X(ft)), Z(-c.laneWidth / 2), Math.abs(X(base) - X(ft)), c.laneWidth * ppm);
    g.globalAlpha = 1;
  }
  g.fillStyle = sec;
  g.globalAlpha = 0.5;
  g.beginPath();
  g.arc(X(0), Z(0), c.centerCircle * ppm, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;

  // --- lines
  g.strokeStyle = lineCol;
  g.lineWidth = lw;
  g.strokeRect(X(-c.halfL), Z(-c.halfW), c.length * ppm, c.width * ppm);
  g.beginPath();
  g.moveTo(X(0), Z(-c.halfW));
  g.lineTo(X(0), Z(c.halfW));
  g.stroke();
  g.beginPath();
  g.arc(X(0), Z(0), c.centerCircle * ppm, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(X(0), Z(0), 2 * 0.3048 * ppm, 0, Math.PI * 2);
  g.stroke();

  for (const side of [1, -1] as const) {
    const base = side * c.halfL;
    const rimX = side * (c.halfL - c.rimFromBaseline);
    const ftX = side * (c.halfL - c.laneLength);
    // lane outline
    g.strokeRect(Math.min(X(base), X(ftX)), Z(-c.laneWidth / 2), Math.abs(X(base) - X(ftX)), c.laneWidth * ppm);
    // free-throw circle (solid outer half, dashed inner half)
    const ftR = 6 * 0.3048;
    g.beginPath();
    g.arc(X(ftX), Z(0), ftR * ppm, side > 0 ? Math.PI / 2 : -Math.PI / 2, side > 0 ? (Math.PI * 3) / 2 : Math.PI / 2);
    g.stroke();
    g.setLineDash([0.4 * ppm, 0.35 * ppm]);
    g.beginPath();
    g.arc(X(ftX), Z(0), ftR * ppm, side > 0 ? -Math.PI / 2 : Math.PI / 2, side > 0 ? Math.PI / 2 : (Math.PI * 3) / 2);
    g.stroke();
    g.setLineDash([]);
    // lane hash marks
    for (const d of [7, 8, 11, 14]) {
      const hx = side * (c.halfL - d * 0.3048);
      for (const zs of [-1, 1]) {
        g.beginPath();
        g.moveTo(X(hx), Z((zs * c.laneWidth) / 2));
        g.lineTo(X(hx), Z(zs * (c.laneWidth / 2 + 0.15)));
        g.stroke();
      }
    }
    // restricted area arc (not used in HS)
    if (c.league !== "hs") {
      g.beginPath();
      g.arc(X(rimX), Z(0), c.restrictedRadius * ppm, side > 0 ? Math.PI / 2 : -Math.PI / 2, side > 0 ? (Math.PI * 3) / 2 : Math.PI / 2);
      g.stroke();
    }
    // three-point line: corners + arc
    const cornerEndX = rimX - side * c.cornerLineLen;
    for (const zs of [-1, 1]) {
      g.beginPath();
      g.moveTo(X(base), Z(zs * c.cornerZ));
      g.lineTo(X(cornerEndX), Z(zs * c.cornerZ));
      g.stroke();
    }
    const a0 = Math.asin(Math.min(1, c.cornerZ / c.threeRadius));
    g.beginPath();
    if (side > 0) g.arc(X(rimX), Z(0), c.threeRadius * ppm, Math.PI - a0 + 0, Math.PI + a0, false);
    else g.arc(X(rimX), Z(0), c.threeRadius * ppm, -a0, a0, false);
    g.stroke();
    // coaching box / sideline hash at 28 ft
    for (const zs of [-1, 1]) {
      const hx = side * (c.halfL - 28 * 0.3048);
      g.beginPath();
      g.moveTo(X(hx), Z(zs * c.halfW));
      g.lineTo(X(hx), Z(zs * (c.halfW - 0.9)));
      g.stroke();
    }
  }

  // --- logos and wordmarks
  try {
    const img = await loadImage(logoImageSrc(home.logo, home.colors, 1024));
    const s = c.centerCircle * 1.7 * ppm;
    g.globalAlpha = 0.92;
    g.drawImage(img, X(0) - s / 2, Z(0) - s / 2, s, s);
    // smaller logos on each wing
    const s2 = 1.6 * ppm;
    for (const side of [1, -1]) {
      g.globalAlpha = 0.5;
      g.drawImage(img, X(side * c.halfL * 0.48) - s2 / 2, Z(-c.halfW * 0.62) - s2 / 2, s2, s2);
    }
    g.globalAlpha = 1;
  } catch {
    /* logo failed to rasterize; court still renders */
  }

  // baseline wordmarks (read from the sidelines' perspective)
  g.fillStyle = lineCol;
  g.font = `900 ${0.9 * ppm}px ${displayFont()}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (const side of [1, -1]) {
    g.save();
    g.translate(X(side * (c.halfL + FLOOR_MARGIN.x * 0.5)), Z(0));
    g.rotate(side > 0 ? -Math.PI / 2 : Math.PI / 2);
    g.fillText((side > 0 ? home.nickname : home.name).toUpperCase(), 0, 0);
    g.restore();
  }
  // near/far sideline text
  g.font = `800 ${0.55 * ppm}px ${displayFont()}`;
  g.globalAlpha = 0.85;
  g.fillText("BASKETBALL LEGENDS", X(-c.halfL * 0.45), Z(c.halfW + FLOOR_MARGIN.z * 0.5));
  g.fillText(`${home.name.toUpperCase()} ${home.nickname.toUpperCase()}`, X(c.halfL * 0.45), Z(c.halfW + FLOOR_MARGIN.z * 0.5));
  g.globalAlpha = 1;

  // lacquer sheen variation
  const grad = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.6);
  grad.addColorStop(0, "rgba(255,255,255,0.05)");
  grad.addColorStop(1, "rgba(0,0,0,0.12)");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
}

/** A low-frequency roughness map so reflections break up like real lacquer. */
export function drawRoughness(canvas: HTMLCanvasElement) {
  const g = canvas.getContext("2d")!;
  const W = canvas.width,
    H = canvas.height;
  const rng = new Rng("rough");
  g.fillStyle = "rgb(90,90,90)";
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 900; i++) {
    const v = 70 + rng.int(0, 60);
    g.fillStyle = `rgba(${v},${v},${v},0.25)`;
    const x = rng.range(0, W),
      y = rng.range(0, H),
      r = rng.range(6, 40);
    g.beginPath();
    g.ellipse(x, y, r * 3, r, 0, 0, Math.PI * 2);
    g.fill();
  }
}
