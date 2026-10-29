// Outdoor court surfaces (worn asphalt or painted acrylic) and the chain-link fence pattern.
import type { CourtSpec } from "@/game/court";
import { Rng } from "@/engine/rng";
import type { ParkSurface } from "@/game/park/parks";
import { floorSize, shade } from "../courtTexture";

/** Paints a park court: surface, lane, lines, and wear (cracks, patches and faded paint on asphalt). */
export function drawParkCourt(canvas: HTMLCanvasElement, c: CourtSpec, surface: ParkSurface, seed: string) {
  const { w: FW, h: FH } = floorSize(c);
  const W = canvas.width,
    H = canvas.height;
  const ppm = W / FW;
  const g = canvas.getContext("2d")!;
  const rng = new Rng(`parkcourt:${seed}`);
  const X = (x: number) => (x + FW / 2) * ppm;
  const Z = (z: number) => (z + FH / 2) * ppm;
  const asphalt = surface.finish === "asphalt";

  // apron and court
  g.fillStyle = surface.apron;
  g.fillRect(0, 0, W, H);
  g.fillStyle = surface.court;
  g.fillRect(X(-c.halfL), Z(-c.halfW), c.length * ppm, c.width * ppm);

  // surface grain: aggregate speckle on asphalt, a soft mottling on acrylic
  const specks = asphalt ? 26000 : 9000;
  for (let i = 0; i < specks; i++) {
    const x = rng.range(0, W),
      y = rng.range(0, H);
    g.globalAlpha = asphalt ? rng.range(0.05, 0.16) : rng.range(0.02, 0.05);
    g.fillStyle = rng.chance(0.5) ? "#ffffff" : "#000000";
    const s = asphalt ? rng.range(0.6, 1.8) : rng.range(2, 6);
    g.fillRect(x, y, s, s);
  }
  g.globalAlpha = 1;

  // painted lanes
  for (const side of [1, -1]) {
    const base = side * c.halfL;
    const ft = side * (c.halfL - c.laneLength);
    g.fillStyle = surface.key;
    g.globalAlpha = asphalt ? 0.82 : 0.95;
    g.fillRect(Math.min(X(base), X(ft)), Z(-c.laneWidth / 2), Math.abs(X(base) - X(ft)), c.laneWidth * ppm);
  }
  g.globalAlpha = 1;

  // lines
  g.strokeStyle = surface.lines;
  g.lineWidth = Math.max(2, 0.05 * ppm);
  g.globalAlpha = asphalt ? 0.85 : 1;
  g.strokeRect(X(-c.halfL), Z(-c.halfW), c.length * ppm, c.width * ppm);
  g.beginPath();
  g.moveTo(X(0), Z(-c.halfW));
  g.lineTo(X(0), Z(c.halfW));
  g.stroke();
  g.beginPath();
  g.arc(X(0), Z(0), c.centerCircle * ppm, 0, Math.PI * 2);
  g.stroke();
  for (const side of [1, -1] as const) {
    const base = side * c.halfL;
    const rimX = side * (c.halfL - c.rimFromBaseline);
    const ftX = side * (c.halfL - c.laneLength);
    g.strokeRect(Math.min(X(base), X(ftX)), Z(-c.laneWidth / 2), Math.abs(X(base) - X(ftX)), c.laneWidth * ppm);
    const ftR = 6 * 0.3048;
    g.beginPath();
    g.arc(X(ftX), Z(0), ftR * ppm, side > 0 ? Math.PI / 2 : -Math.PI / 2, side > 0 ? (Math.PI * 3) / 2 : Math.PI / 2);
    g.stroke();
    const cornerEndX = rimX - side * c.cornerLineLen;
    for (const zs of [-1, 1]) {
      g.beginPath();
      g.moveTo(X(base), Z(zs * c.cornerZ));
      g.lineTo(X(cornerEndX), Z(zs * c.cornerZ));
      g.stroke();
    }
    const a0 = Math.asin(Math.min(1, c.cornerZ / c.threeRadius));
    g.beginPath();
    if (side > 0) g.arc(X(rimX), Z(0), c.threeRadius * ppm, Math.PI - a0, Math.PI + a0, false);
    else g.arc(X(rimX), Z(0), c.threeRadius * ppm, -a0, a0, false);
    g.stroke();
  }
  g.globalAlpha = 1;

  if (asphalt) {
    // patched repairs
    for (let i = 0; i < 7; i++) {
      g.globalAlpha = rng.range(0.25, 0.45);
      g.fillStyle = shade(surface.court.length === 7 ? surface.court : "#444444", rng.range(0.7, 0.85));
      const pw = rng.range(0.8, 2.6) * ppm,
        ph = rng.range(0.6, 1.8) * ppm;
      g.fillRect(rng.range(0, W - pw), rng.range(0, H - ph), pw, ph);
    }
    // cracks: wandering dark lines
    g.globalAlpha = 0.55;
    g.strokeStyle = "#141414";
    for (let i = 0; i < 18; i++) {
      let x = rng.range(0, W),
        y = rng.range(0, H);
      let ang = rng.range(0, Math.PI * 2);
      g.lineWidth = rng.range(0.8, 2.2);
      g.beginPath();
      g.moveTo(x, y);
      const steps = rng.int(8, 30);
      for (let k = 0; k < steps; k++) {
        ang += rng.normal(0, 0.5);
        x += Math.cos(ang) * 0.25 * ppm;
        y += Math.sin(ang) * 0.25 * ppm;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // scuffed paint where people play most: under the baskets and up top
    g.globalAlpha = 0.12;
    g.fillStyle = surface.court;
    for (const side of [1, -1]) {
      for (let i = 0; i < 40; i++) {
        const cx = X(side * (c.halfL - c.rimFromBaseline - rng.range(0.5, 5)));
        const cz = Z(rng.normal(0, 2.2));
        g.beginPath();
        g.arc(cx, cz, rng.range(0.2, 0.7) * ppm, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;
  }
}

/** One repeat of a chain-link fence: transparent diamonds on galvanized wire. */
export function drawChainLink(canvas: HTMLCanvasElement) {
  const g = canvas.getContext("2d")!;
  const S = canvas.width;
  g.clearRect(0, 0, S, S);
  g.strokeStyle = "rgba(200,205,210,0.95)";
  g.lineWidth = S * 0.045;
  g.lineCap = "round";
  for (const [x0, y0, x1, y1] of [
    [0, S / 2, S / 2, 0],
    [S / 2, 0, S, S / 2],
    [S, S / 2, S / 2, S],
    [S / 2, S, 0, S / 2],
  ]) {
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  }
}

/** Windows on a building face (lit ones glow at night). */
export function drawWindows(canvas: HTMLCanvasElement, wall: string, lit: number, seed: string) {
  const g = canvas.getContext("2d")!;
  const W = canvas.width,
    H = canvas.height;
  const rng = new Rng(`windows:${seed}`);
  g.fillStyle = wall;
  g.fillRect(0, 0, W, H);
  const cols = 8,
    rows = 16;
  const cw = W / cols,
    rh = H / rows;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const on = rng.chance(lit);
      g.fillStyle = on ? (rng.chance(0.7) ? "#ffd99a" : "#cfe6ff") : "#1b2230";
      g.globalAlpha = on ? rng.range(0.75, 1) : 0.9;
      g.fillRect(c * cw + cw * 0.2, r * rh + rh * 0.22, cw * 0.6, rh * 0.56);
    }
  g.globalAlpha = 1;
}
