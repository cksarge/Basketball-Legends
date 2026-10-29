/**
 * Generates public/sitemap.xml from the routes in src/app.
 * A route is included when its folder has a page.tsx and the page doesn't opt out
 * with `robots: { index: false }`. Runs automatically before `npm run build`.
 */
import fs from "node:fs";
import path from "node:path";

const SITE = "https://legends.carterscoding.com";
const APP = path.join(__dirname, "..", "src", "app");
const PRIORITY: Record<string, number> = { "/": 1.0, "/play/": 0.9, "/park/": 0.9, "/how-to-play/": 0.7, "/settings/": 0.5 };

function walk(dir: string, route = "/"): string[] {
  const out: string[] = [];
  const page = path.join(dir, "page.tsx");
  if (fs.existsSync(page)) {
    const src = fs.readFileSync(page, "utf8");
    if (!/index:\s*false/.test(src)) out.push(route);
  }
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith("_") || e.name.startsWith("(") || e.name.startsWith("[")) continue;
    out.push(...walk(path.join(dir, e.name), `${route}${e.name}/`));
  }
  return out;
}

const routes = walk(APP).sort((a, b) => (PRIORITY[b] ?? 0.4) - (PRIORITY[a] ?? 0.4) || a.localeCompare(b));
const today = new Date().toISOString().slice(0, 10);
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes
  .map(
    (r) => `  <url>
    <loc>${SITE}${r}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${r === "/" ? "weekly" : "monthly"}</changefreq>
    <priority>${(PRIORITY[r] ?? 0.4).toFixed(1)}</priority>
  </url>`,
  )
  .join("\n")}
</urlset>
`;
fs.writeFileSync(path.join(__dirname, "..", "public", "sitemap.xml"), xml);
console.log(`sitemap.xml: ${routes.length} routes (${routes.join(", ")})`);
