// Post-build: stamp the service worker with a build version and the full list of hashed
// build assets, so one visit caches everything needed to play offline.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const out = "out";
const files: string[] = [];
const walk = (dir: string) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (!e.name.endsWith(".map")) files.push("/" + path.relative(out, p).split(path.sep).join("/"));
  }
};
walk(path.join(out, "_next", "static"));
const hash = crypto.createHash("sha1").update(files.sort().join("\n")).digest("hex").slice(0, 10);
const swPath = path.join(out, "sw.js");
let sw = fs.readFileSync(swPath, "utf8");
sw = sw.replace('const VERSION = "bl-v1";', `const VERSION = "bl-${hash}";`).replace("const BUILD_ASSETS = [];", `const BUILD_ASSETS = ${JSON.stringify(files)};`);
fs.writeFileSync(swPath, sw);
console.log(`sw.js: version bl-${hash}, ${files.length} build assets`);
