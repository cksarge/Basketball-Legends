// Rasterizes public/icon.svg (from gen_icon.py) into the PNG icons and a multi-size favicon.ico, and the
// link preview card (scripts/brand/out/og.svg) into public/og.png.
//   node scripts/brand/pack-icons.mjs
import fs from "node:fs";
import sharp from "sharp";

const svg = fs.readFileSync("public/icon.svg", "utf8");
// iOS and maskable icons get cropped by the system, so they fill the whole square (no rounded corners)
const square = svg.replace(/<rect width="512" height="512" rx="112"/, '<rect width="512" height="512"');
// a maskable icon must keep everything inside the center 80% circle
const body = svg.slice(svg.indexOf(">") + 1, svg.lastIndexOf("</svg>"));
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#0d1b2e"/><g transform="translate(51.2 51.2) scale(0.8)">${body}</g></svg>`;
const png = (src, size) =>
  sharp(Buffer.from(src), { density: 72 * (size / 512) * 4 })
    .resize(size, size)
    .png()
    .toBuffer();

fs.writeFileSync("public/apple-touch-icon.png", await png(square, 180));
fs.writeFileSync("public/icon-192.png", await png(svg, 192));
fs.writeFileSync("public/icon-512.png", await png(svg, 512));
fs.writeFileSync("public/icon-maskable-512.png", await png(maskable, 512));

// ICO container with embedded PNGs (supported by every current browser)
const imgs = await Promise.all([16, 32, 48].map(async (size) => ({ data: await png(svg, size), size })));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(imgs.length, 4);
let offset = 6 + 16 * imgs.length;
const dir = imgs.map(({ data, size }) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(size, 0);
  e.writeUInt8(size, 1);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(data.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += data.length;
  return e;
});
fs.writeFileSync("public/favicon.ico", Buffer.concat([header, ...dir, ...imgs.map((i) => i.data)]));
const og = "scripts/brand/out/og.svg";
if (fs.existsSync(og)) fs.writeFileSync("public/og.png", await sharp(og).resize(1200, 630).png().toBuffer());
console.log("icons written");
