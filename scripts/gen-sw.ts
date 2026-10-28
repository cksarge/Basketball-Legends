// Post-build: stamp the service worker with a build version and the full list of hashed
// build assets and models, so one visit caches everything needed to play offline.
// For the beta build (BL_CHANNEL=beta, served at /beta/) it also prefixes every path, names the caches
// bl-beta-* so they never collide with the live game's, and points the web app manifest at /beta/.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const out = "out";
const beta = process.env.BL_CHANNEL === "beta";
const base = beta ? "/beta" : "";
const prefix = beta ? "bl-beta-" : "bl-";
const files: string[] = [];
const walk = (dir: string) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (!e.name.endsWith(".map")) files.push(base + "/" + path.relative(out, p).split(path.sep).join("/"));
  }
};
walk(path.join(out, "_next", "static"));
// every venue and character model, so any matchup plays offline
walk(path.join(out, "models"));
const hash = crypto.createHash("sha1").update(files.sort().join("\n")).digest("hex").slice(0, 10);
const swPath = path.join(out, "sw.js");
let sw = fs.readFileSync(swPath, "utf8");
sw = sw
  .replace('const VERSION = "bl-v1";', `const VERSION = "${prefix}${hash}";`)
  .replace('const BASE = "";', `const BASE = "${base}";`)
  .replace("const BUILD_ASSETS = [];", `const BUILD_ASSETS = ${JSON.stringify(files)};`);
fs.writeFileSync(swPath, sw);
console.log(`sw.js: version ${prefix}${hash}, ${files.length} build assets`);

if (beta) {
  const manifestPath = path.join(out, "manifest.webmanifest");
  const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  m.name += " Beta";
  m.short_name += " Beta";
  m.id = m.start_url = m.scope = base + "/";
  for (const icon of m.icons) icon.src = base + icon.src;
  fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + "\n");
  // the custom domain belongs to the live site only
  fs.rmSync(path.join(out, "CNAME"), { force: true });
}
