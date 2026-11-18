/**
 * Kenning's service worker (D0: installable web app). Built by the `kenning-sw` plugin in
 * vite.config.ts, which fills in PRECACHE (the app shell: index.html, every built script,
 * style sheet and the SQLite wasm, the latin fonts, icons, manifest and offline page) and
 * VERSION (a hash of that list).
 *
 * - Precached files and other hashed /assets/ files: cache first (they never change).
 * - Page navigations: network first, so a new deploy shows at once; offline, the cached app
 *   shell (browser storage works offline), else the offline page.
 * - /api, /nlp, /anki, other origins and anything but GET: not touched at all, so sign-in
 *   cookies, API data and language-server answers are never cached.
 * - A new version waits until the app asks it to take over ("A new version is ready — Reload").
 */
const VERSION = "__KENNING_SW_VERSION__";
const PRECACHE = /** @type {string[]} */ (__KENNING_SW_PRECACHE__);
const CACHE = `kenning-shell-${VERSION}`;
const SHELL = "/index.html";
const OFFLINE = "/offline.html";
const BYPASS = /^\/(api|nlp|anki)(\/|$)/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" })))),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith("kenning-") && k !== CACHE).map((k) => caches.delete(k)),
        ),
      ),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "kenning-sw-update") void self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || BYPASS.test(url.pathname)) return;
  if (request.mode === "navigate") {
    event.respondWith(navigate(request));
  } else if (url.pathname.startsWith("/assets/") || PRECACHE.includes(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});

/** @param {Request} request */
async function navigate(request) {
  try {
    return await fetch(request);
  } catch (e) {
    const cache = await caches.open(CACHE);
    const fallback = (await cache.match(SHELL)) ?? (await cache.match(OFFLINE));
    if (fallback) return fallback;
    throw e;
  }
}

/** @param {Request} request */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  // ignoreVary: module scripts and fonts are CORS requests (an Origin header) and servers may
  // answer with `Vary: Origin`; the precache stored them without one.
  const hit = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && new URL(request.url).pathname.startsWith("/assets/")) {
    void cache.put(request, response.clone());
  }
  return response;
}
