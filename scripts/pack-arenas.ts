// Compress the venues Blender exported (scripts/blender/build_arenas.py) into public/models/arenas.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const src = "scripts/blender/out/arenas";
const out = "public/models/arenas";
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(src)) {
  const from = path.join(src, f);
  const to = path.join(out, f);
  if (f.endsWith(".glb")) execFileSync("npx", ["gltf-transform", "meshopt", from, to, "--level", "medium"], { stdio: "ignore" });
  else if (f.endsWith(".json")) fs.copyFileSync(from, to);
  else continue;
  console.log(`${to}: ${Math.round(fs.statSync(to).size / 1024)} KB`);
}
