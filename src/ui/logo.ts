// Procedural team logo -> SVG string. Used by the UI and by 3D textures (court, jerseys).
import type { LogoIcon, LogoSpec, TeamColors } from "@/engine/types";
import { hashString } from "@/engine/rng";
import { displayFont } from "@/lib/fonts";

/** Icon glyphs drawn in a 100x100 box centred on (50,50). */
const ICONS: Record<LogoIcon, string> = {
  ball: '<circle cx="50" cy="50" r="30" fill="currentColor"/><path d="M20 50h60M50 20v60M28 28c12 10 12 34 0 44M72 28c-12 10-12 34 0 44" stroke="var(--bg)" stroke-width="4" fill="none"/>',
  flame: '<path d="M50 14c6 16 24 22 24 44a24 24 0 0 1-48 0c0-12 8-18 10-28 4 8 8 10 10 10-2-10 0-18 4-26z" fill="currentColor"/>',
  bolt: '<path d="M56 10 26 56h20l-6 34 34-48H54z" fill="currentColor"/>',
  star: '<path d="m50 12 11 25 27 2-21 17 7 27-24-15-24 15 7-27-21-17 27-2z" fill="currentColor"/>',
  crown: '<path d="M16 70 22 30l16 18 12-28 12 28 16-18 6 40z" fill="currentColor"/><rect x="16" y="72" width="68" height="8" fill="currentColor"/>',
  wing: '<path d="M14 62c20-4 30-22 34-44 4 22 14 40 38 44-14 4-26 2-38-8-6 10-18 12-34 8z" fill="currentColor"/>',
  claw: '<path d="M26 18c10 14 14 34 6 62-4-26-12-42-6-62zm24-6c8 18 8 42-2 70-2-28-6-46 2-70zm24 6c4 20-2 42-16 62 4-26 6-44 16-62z" fill="currentColor"/>',
  mountain: '<path d="M8 80 38 28l14 22 10-14 30 44z" fill="currentColor"/><path d="m38 28-8 14 8-4 6 6z" fill="var(--bg)"/>',
  wave: '<path d="M10 58c14-18 26-18 40 0s26 18 40 0v22H10z" fill="currentColor"/><path d="M10 38c14-18 26-18 40 0s26 18 40 0" stroke="currentColor" stroke-width="6" fill="none"/>',
  sun: '<circle cx="50" cy="50" r="18" fill="currentColor"/><g stroke="currentColor" stroke-width="6" stroke-linecap="round"><path d="M50 12v12M50 76v12M12 50h12M76 50h12M23 23l8 8M69 69l8 8M77 23l-8 8M31 69l-8 8"/></g>',
  tree: '<path d="m50 10 24 34H60l18 24H56v18H44V68H22l18-24H26z" fill="currentColor"/>',
  horn: '<path d="M18 22c4 26 20 36 32 36s28-10 32-36c-8 14-18 20-32 20S26 36 18 22z" fill="currentColor"/><path d="M38 60h24l-6 24H44z" fill="currentColor"/>',
  shield: '<path d="M50 12 82 24v24c0 20-14 34-32 42-18-8-32-22-32-42V24z" fill="currentColor"/>',
  arrow: '<path d="M14 50h52M50 28l26 22-26 22" stroke="currentColor" stroke-width="10" fill="none" stroke-linejoin="round"/>',
  paw: '<ellipse cx="50" cy="64" rx="18" ry="15" fill="currentColor"/><circle cx="28" cy="42" r="8" fill="currentColor"/><circle cx="42" cy="30" r="8" fill="currentColor"/><circle cx="58" cy="30" r="8" fill="currentColor"/><circle cx="72" cy="42" r="8" fill="currentColor"/>',
  feather: '<path d="M70 12C40 18 26 44 28 76l-8 12 4 2 8-12c30-2 46-30 38-66zM34 68 58 32" fill="currentColor" stroke="var(--bg)" stroke-width="3"/>',
  anchor: '<circle cx="50" cy="22" r="8" stroke="currentColor" stroke-width="6" fill="none"/><path d="M50 30v52M34 44h32M18 60c2 16 14 22 32 22s30-6 32-22" stroke="currentColor" stroke-width="7" fill="none"/>',
  gear: '<path d="M44 10h12l2 12 9 4 10-7 8 8-7 10 4 9 12 2v12l-12 2-4 9 7 10-8 8-10-7-9 4-2 12H44l-2-12-9-4-10 7-8-8 7-10-4-9-12-2V44l12-2 4-9-7-10 8-8 10 7 9-4z" fill="currentColor"/><circle cx="50" cy="50" r="12" fill="var(--bg)"/>',
  moon: '<path d="M62 12a38 38 0 1 0 26 54A32 32 0 0 1 62 12z" fill="currentColor"/>',
  none: "",
};

function shapePath(shape: LogoSpec["shape"]): string {
  switch (shape) {
    case "circle": return '<circle cx="50" cy="50" r="46"/>';
    case "roundel": return '<circle cx="50" cy="50" r="46"/>';
    case "shield": return '<path d="M50 4 92 18v30c0 26-18 42-42 50C26 90 8 74 8 48V18z"/>';
    case "diamond": return '<path d="M50 3 97 50 50 97 3 50z"/>';
    case "hex": return '<path d="M50 3 91 26v48L50 97 9 74V26z"/>';
    case "star": return '<path d="m50 3 13 30 33 3-25 21 8 32-29-17-29 17 8-32L4 36l33-3z"/>';
    case "badge": return '<rect x="6" y="6" width="88" height="88" rx="22"/>';
  }
}

export function logoSvg(spec: LogoSpec, colors: TeamColors, opts: { monogram?: boolean; size?: number } = {}): string {
  const size = opts.size ?? 100;
  const cid = `lc${hashString(spec.monogram + spec.shape + spec.icon + colors.primary + colors.secondary + size)}`;
  const ring = spec.shape === "roundel" ? `<circle cx="50" cy="50" r="38" fill="none" stroke="${colors.accent}" stroke-width="3"/>` : "";
  const stripe = spec.stripe ? `<path d="M0 64 100 36v10L0 74z" fill="${colors.secondary}" opacity="0.35" clip-path="url(#${cid})"/>` : "";
  const icon = ICONS[spec.icon] ?? "";
  const useMono = opts.monogram ?? (spec.icon === "none" || spec.shape === "badge");
  const mono = useMono
    ? `<text x="50" y="${icon ? 86 : 64}" text-anchor="middle" font-family="${displayFont().replaceAll('"', "'")}" font-weight="900" font-size="${icon ? 18 : 44}" fill="${colors.accent}" letter-spacing="1">${escapeXml(spec.monogram)}</text>`
    : "";
  const iconScale = useMono && icon ? 0.62 : 0.72;
  const iconY = useMono && icon ? 40 : 50;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" style="--bg:${colors.primary}">
<defs><clipPath id="${cid}">${shapePath(spec.shape)}</clipPath></defs>
<g fill="${colors.primary}" stroke="${colors.secondary}" stroke-width="4">${shapePath(spec.shape)}</g>
${stripe}${ring}
<g color="${colors.secondary}" transform="translate(50 ${iconY}) scale(${iconScale}) translate(-50 -50)">${icon.replaceAll("var(--bg)", colors.primary)}</g>
${mono}</svg>`;
}

function escapeXml(s: string) {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

export function logoDataUrl(spec: LogoSpec, colors: TeamColors, size = 256) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(logoSvg(spec, colors, { size }))}`;
}
