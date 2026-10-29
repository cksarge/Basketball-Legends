// Compress the park worlds and the spectators Blender exported (scripts/blender/build_parks.py, build_crowd.py)
// into public/models/parks.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const src = "scripts/blender/out";
const out = "public/models/parks";
fs.mkdirSync(out, { recursive: true });
const jobs: [string, string][] = [[path.join(src, "crowd.glb"), path.join(out, "crowd.glb")]];
for (const f of fs.readdirSync(path.join(src, "parks"))) {
  const from = path.join(src, "parks", f);
  if (f.endsWith(".glb")) jobs.push([from, path.join(out, f)]);
  else if (f.endsWith(".json")) fs.copyFileSync(from, path.join(out, f));
}
for (const [from, to] of jobs) {
  // textures to WebP keeps the worlds small; meshopt for the geometry
  execFileSync("npx", ["gltf-transform", "webp", from, to + ".tmp.glb", "--quality", "82"], { stdio: "ignore" });
  execFileSync("npx", ["gltf-transform", "meshopt", to + ".tmp.glb", to, "--level", "medium"], { stdio: "ignore" });
  fs.rmSync(to + ".tmp.glb");
  console.log(`${to}: ${Math.round(fs.statSync(to).size / 1024)} KB`);
}
