// Canvas textures for jerseys and shorts. Jersey UVs are cylindrical:
// u = 0.25 front center, 0.75 back center, seam under the right arm; v = 0 hem, 1 neckline.
import * as THREE from "three";
import type { Team } from "@/engine/types";
import { logoImageSrc } from "@/ui/logo";
import { displayFont } from "@/lib/fonts";

export type UniformStyle = "home" | "away" | "alt";

export interface UniformColors { base: string; trim: string; text: string; outline: string }

export function uniformColors(team: Team, style: UniformStyle): UniformColors {
  const c = team.colors;
  if (style === "home") return { base: lighten(c.accent, 0), trim: c.primary, text: c.primary, outline: c.secondary };
  if (style === "alt") return { base: c.secondary, trim: c.primary, text: c.primary, outline: c.accent };
  return { base: c.primary, trim: c.secondary, text: c.accent, outline: c.secondary };
}

function lighten(hex: string, amt: number) {
  const col = new THREE.Color(hex);
  col.lerp(new THREE.Color("#ffffff"), amt);
  return `#${col.getHexString()}`;
}

/** Luminance distance check so text is always readable on the base color. */
export function contrastOk(a: string, b: string) {
  const la = new THREE.Color(a), lb = new THREE.Color(b);
  const L = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return Math.abs(L(la) - L(lb)) > 0.22;
}

const FONT_STACK = () => displayFont();
const logoImages = new Map<string, HTMLImageElement>();

function teamLogoImage(team: Team): HTMLImageElement {
  let img = logoImages.get(team.id);
  if (!img) {
    img = new Image();
    img.src = logoImageSrc(team.logo, team.colors, 256);
    logoImages.set(team.id, img);
  }
  return img;
}

export function drawJersey(canvas: HTMLCanvasElement, team: Team, style: UniformStyle, number: number, lastName: string) {
  const W = canvas.width, H = canvas.height;
  const g = canvas.getContext("2d")!;
  const col = uniformColors(team, style);
  const text = contrastOk(col.text, col.base) ? col.text : contrastOk(col.outline, col.base) ? col.outline : "#111111";
  g.fillStyle = col.base;
  g.fillRect(0, 0, W, H);
  // subtle mesh fabric texture
  g.globalAlpha = 0.06;
  for (let y = 0; y < H; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < W; x += 4) { g.fillStyle = "#000"; g.fillRect(x, y, 1, 1); }
  g.globalAlpha = 1;
  // side panels under the arms (u = 0 / 0.5 / 1)
  g.fillStyle = col.trim;
  for (const u of [0, 0.5, 1]) g.fillRect(u * W - W * 0.025, 0, W * 0.05, H);
  g.fillStyle = col.outline;
  for (const u of [0, 0.5, 1]) { g.fillRect(u * W - W * 0.034, 0, W * 0.007, H); g.fillRect(u * W + W * 0.027, 0, W * 0.007, H); }
  // neckline / armhole trim band at the top
  g.fillStyle = col.trim;
  g.fillRect(0, 0, W, H * 0.035);
  g.fillStyle = col.outline;
  g.fillRect(0, H * 0.035, W, H * 0.008);
  // hem
  g.fillStyle = col.trim;
  g.fillRect(0, H * 0.97, W, H * 0.03);

  const drawText = (str: string, cx: number, cy: number, size: number, maxW: number, opts: { arch?: number } = {}) => {
    g.save();
    g.font = `900 ${size}px ${FONT_STACK()}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const w = g.measureText(str).width;
    const sx = Math.min(1, maxW / w);
    g.translate(cx, cy);
    g.scale(sx, 1);
    if (opts.arch) {
      // simple arched wordmark: draw letter by letter on an arc
      const letters = [...str];
      const total = g.measureText(str).width;
      let x = -total / 2;
      for (const ch of letters) {
        const cw = g.measureText(ch).width;
        const t = (x + cw / 2) / (total / 2);
        g.save();
        g.translate(x + cw / 2, -opts.arch * (1 - t * t));
        g.rotate(t * 0.12);
        stroke(ch, 0, 0, size);
        g.restore();
        x += cw;
      }
    } else {
      stroke(str, 0, 0, size);
    }
    g.restore();
  };
  const stroke = (str: string, x: number, y: number, size: number) => {
    g.lineJoin = "round";
    g.lineWidth = size * 0.12;
    g.strokeStyle = col.outline === text ? col.trim : col.outline;
    g.strokeText(str, x, y);
    g.fillStyle = text;
    g.fillText(str, x, y);
  };

  const front = W * 0.25, back = W * 0.75;
  const word = (team.league === "pro" ? team.name.split(" ").slice(-1)[0] : team.nickname).toUpperCase();
  drawText(word.length > 11 ? team.abbrev : word, front, H * 0.3, H * 0.13, W * 0.34, { arch: H * 0.04 });
  drawText(String(number), front, H * 0.58, H * 0.3, W * 0.22);
  drawText(lastName.toUpperCase(), back, H * 0.2, H * 0.1, W * 0.3, { arch: H * 0.02 });
  drawText(String(number), back, H * 0.5, H * 0.36, W * 0.26);
  // small team logo near the front neckline
  const img = teamLogoImage(team);
  if (img.complete && img.naturalWidth) g.drawImage(img, front - H * 0.045, H * 0.06, H * 0.09, H * 0.09);
}

export function drawShorts(canvas: HTMLCanvasElement, team: Team, style: UniformStyle) {
  const W = canvas.width, H = canvas.height;
  const g = canvas.getContext("2d")!;
  const col = uniformColors(team, style);
  g.fillStyle = col.base;
  g.fillRect(0, 0, W, H);
  // waistband (top = waist)
  g.fillStyle = col.trim;
  g.fillRect(0, 0, W, H * 0.1);
  // side stripes
  for (const u of [0, 0.5, 1]) {
    g.fillStyle = col.trim;
    g.fillRect(u * W - W * 0.04, 0, W * 0.08, H);
    g.fillStyle = col.outline;
    g.fillRect(u * W - W * 0.01, 0, W * 0.02, H);
  }
  // hem band
  g.fillStyle = col.trim;
  g.fillRect(0, H * 0.92, W, H * 0.08);
  // logo on the front left leg (character's left = u slightly above 0.25)
  const img = teamLogoImage(team);
  if (img.complete && img.naturalWidth) g.drawImage(img, W * 0.31, H * 0.55, H * 0.22, H * 0.22);
}

export function makeCanvasTexture(w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.wrapS = THREE.RepeatWrapping;
  tex.flipY = false; // glTF UV convention (origin top-left)
  return { canvas, tex };
}

/** Officials: grey and black vertical stripes, black collar band, number on the back. */
export function drawOfficialJersey(canvas: HTMLCanvasElement, number: number) {
  const W = canvas.width, H = canvas.height;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#e9e9e6";
  g.fillRect(0, 0, W, H);
  const stripes = 28;
  g.fillStyle = "#121212";
  for (let i = 0; i < stripes; i++) g.fillRect((i / stripes) * W, 0, W / stripes / 2, H);
  // collar and armhole band, hem
  g.fillStyle = "#121212";
  g.fillRect(0, 0, W, H * 0.05);
  g.fillRect(0, H * 0.965, W, H * 0.035);
  // number on the back in a white patch so it reads over the stripes
  const cx = W * 0.75, cy = H * 0.55;
  g.fillStyle = "#e9e9e6";
  g.fillRect(cx - W * 0.075, cy - H * 0.17, W * 0.15, H * 0.32);
  g.fillStyle = "#121212";
  g.font = `900 ${Math.round(H * 0.26)}px ${FONT_STACK()}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(String(number), cx, cy + H * 0.01);
  // small league crest on the chest
  g.fillStyle = "#121212";
  g.beginPath();
  g.arc(W * 0.31, H * 0.72, H * 0.035, 0, Math.PI * 2);
  g.fill();
}

/** Solid team-colored polo for the scorer's table crew. */
export function drawStaffShirt(canvas: HTMLCanvasElement, color: string, trim: string) {
  const W = canvas.width, H = canvas.height;
  const g = canvas.getContext("2d")!;
  g.fillStyle = color;
  g.fillRect(0, 0, W, H);
  g.fillStyle = trim;
  g.fillRect(0, 0, W, H * 0.06);
  g.fillRect(W * 0.235, H * 0.06, W * 0.03, H * 0.12); // placket
  g.globalAlpha = 0.5;
  g.fillRect(W * 0.3, H * 0.7, W * 0.035, H * 0.06); // chest logo
  g.globalAlpha = 1;
}

/** Plain shorts in one color (officials' black, staff slacks). */
export function drawPlainShorts(canvas: HTMLCanvasElement, color: string) {
  const g = canvas.getContext("2d")!;
  g.fillStyle = color;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = "rgba(0,0,0,0.25)";
  g.fillRect(0, 0, canvas.width, canvas.height * 0.08);
}
