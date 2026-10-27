// Writes PNG icons and a multi-size favicon.ico from base64 PNGs rasterized in a browser.
//   node scripts/pack-icons.mjs <icons.json>
import fs from "node:fs";
let raw = fs.readFileSync(process.argv[2], "utf8");
const start = raw.indexOf("{"); raw = raw.slice(start, raw.lastIndexOf("}") + 1);
const icons = JSON.parse(raw);
const buf = (k) => Buffer.from(icons[k], "base64");
fs.writeFileSync("public/apple-touch-icon.png", buf("apple-touch-icon"));
fs.writeFileSync("public/icon-192.png", buf("icon-192"));
fs.writeFileSync("public/icon-512.png", buf("icon-512"));
fs.writeFileSync("public/icon-maskable-512.png", buf("maskable-512"));
// ICO container with embedded PNGs (supported by every current browser)
const imgs = [["ico16", 16], ["ico32", 32], ["ico48", 48]].map(([k, s]) => ({ data: buf(k), size: s }));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(imgs.length, 4);
let offset = 6 + 16 * imgs.length;
const dir = imgs.map(({ data, size }) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(size, 0); e.writeUInt8(size, 1); e.writeUInt8(0, 2); e.writeUInt8(0, 3);
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
  offset += data.length;
  return e;
});
fs.writeFileSync("public/favicon.ico", Buffer.concat([header, ...dir, ...imgs.map((i) => i.data)]));
console.log("icons written");
