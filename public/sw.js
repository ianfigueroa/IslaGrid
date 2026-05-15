// IslaGrid disaster-mode service worker.
//
// Caching strategy:
//  - static shell (the /disaster route + its critical CSS/JS): cache-first
//  - basemap tiles for the PR bounding box: stale-while-revalidate, capped
//  - /api/public/grid-status + planned-work: network-first with cache fallback
//
// We deliberately keep this tiny. PWA features beyond offline survive across
// cell-network outages — the whole point of disaster mode.

const SHELL_CACHE = "islagrid-shell-v1";
const TILES_CACHE = "islagrid-tiles-v1";
const DATA_CACHE = "islagrid-data-v1";

const SHELL_URLS = [
  "/disaster",
  "/disaster/manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => ![SHELL_CACHE, TILES_CACHE, DATA_CACHE].includes(k))
          .map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Protomaps pmtiles are served from /map/pr.pmtiles via HTTP range
  // requests; the basemap glyphs/sprites come from protomaps.github.io.
  // Cache both lanes so offline disaster mode still draws a map.
  if (
    url.pathname.startsWith("/map/") ||
    url.hostname === "protomaps.github.io"
  ) {
    event.respondWith(staleWhileRevalidate(TILES_CACHE, req, 200));
    return;
  }

  // Disaster-mode data endpoints — network first, fall back to last good copy.
  // The list intentionally includes the live weather / hurricane / quake
  // endpoints so the disaster page stays useful when the network drops
  // mid-event. networkFirst returns a 503 JSON body if nothing is cached.
  if (
    url.pathname === "/api/public/grid-status" ||
    url.pathname === "/api/public/planned-work" ||
    url.pathname === "/api/public/outage-risk" ||
    url.pathname === "/api/disaster/snapshot" ||
    url.pathname === "/api/weather/alerts" ||
    url.pathname === "/api/hurricanes/active" ||
    url.pathname === "/api/quakes"
  ) {
    event.respondWith(networkFirst(DATA_CACHE, req));
    return;
  }

  // Shell: cache first.
  if (url.pathname.startsWith("/disaster")) {
    event.respondWith(cacheFirst(SHELL_CACHE, req));
  }
});

async function cacheFirst(cacheName, req) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    return cached ?? new Response("offline", { status: 503 });
  }
}

async function networkFirst(cacheName, req) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    return new Response(JSON.stringify({ offline: true }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
}

async function staleWhileRevalidate(cacheName, req, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req)
    .then((res) => {
      if (res && res.ok) {
        cache.put(req, res.clone());
        trim(cache, maxEntries);
      }
      return res;
    })
    .catch(() => cached);
  return cached ?? fetchPromise;
}

async function trim(cache, max) {
  const keys = await cache.keys();
  if (keys.length <= max) return;
  for (const k of keys.slice(0, keys.length - max)) {
    await cache.delete(k);
  }
}
