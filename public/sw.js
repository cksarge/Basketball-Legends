// Basketball Legends service worker: lets the game load and play offline after one visit.
//  - pages: network first, falling back to the cached copy (so updates arrive right away)
//  - hashed build assets (/_next/static): cache first, they never change
//  - models, logos, icons: served from cache and refreshed in the background
const VERSION = "bl-v1";
const PAGES = ["/", "/play/", "/game/", "/settings/", "/how-to-play/", "/credits/", "/legal/terms/", "/legal/privacy/", "/404.html"];
const ASSETS = [
  "/logos/brophy.png", "/favicon.ico", "/icon.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/manifest.webmanifest",
];

// filled in by scripts/gen-sw.ts after each build (hashed JS/CSS/fonts, every model in /models)
const BUILD_ASSETS = [];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((c) => Promise.allSettled([...PAGES, ...ASSETS, ...BUILD_ASSETS].map((u) => c.add(u)))).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true })) || (await cache.match("/")) || Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  const update = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || update;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") { event.respondWith(networkFirst(req)); return; }
  if (url.pathname.startsWith("/_next/static/")) { event.respondWith(cacheFirst(req)); return; }
  if (/\.(glb|png|jpg|webp|svg|ico|webmanifest|woff2?|json|txt)$/.test(url.pathname)) { event.respondWith(staleWhileRevalidate(req)); return; }
});
