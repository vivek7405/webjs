/*
 * webjs progressive-enhancement service worker (OPT-IN, #271).
 *
 * This adds an offline fallback and an asset cache WITHOUT changing the
 * JavaScript-disabled baseline: with JS off no service worker registers, so
 * pages, links, and forms behave exactly as they do today. It is registered
 * explicitly (see the opt-in snippet in the skill's references/service-worker.md), never
 * automatically.
 *
 * Strategy:
 *   - Navigations are NETWORK-FIRST: always try the network so the user sees
 *     fresh server-rendered HTML, caching each successful page (the SSR shell)
 *     so a later OFFLINE visit to a page you have seen still renders. When the
 *     network fails and nothing is cached, serve /offline.html.
 *   - Same-origin static assets (the per-file ESM modules, the framework
 *     runtime under /__webjs/core/, vendor bundles, public assets) are
 *     stale-while-revalidate, so a repeat visit works offline. In production
 *     the FRAMEWORK-emitted URLs (modules, the core runtime, vendor bundles)
 *     carry a ?v=<hash> content fingerprint automatically, so a changed file
 *     gets a new URL and the cache cannot serve stale bytes for those.
 *
 *     A public/ asset is the exception: its URL is fingerprinted only when you
 *     mark it with asset() (href=${asset('/public/app.css')}). An un-marked
 *     public/ URL is stable across deploys, so this worker serves the CACHED
 *     copy and revalidates behind it, and the first load after a deploy shows
 *     the OLD bytes. The cache version below will not necessarily rescue you,
 *     because the build id it derives from is a deploy fingerprint rather than
 *     a per-file content hash. Mark any public/ asset whose bytes change.
 *
 * Versioning ties to the deploy. The page registers this worker as
 * `/sw.js?v=<data-webjs-build>` (the importmap build id), so a new deploy
 * changes the worker's own URL, the browser fetches the new worker, and its
 * `activate` deletes every cache that is not the current version. The cache
 * name is derived from that `?v=` below.
 *
 * NEVER cached: non-GET requests, cross-origin requests, the action RPC
 * endpoint (/__webjs/action/), the dev live-reload SSE (/__webjs/events) and
 * dev reload client (/__webjs/reload.js).
 */

const BUILD = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = 'webjs-' + BUILD;
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Precache the offline fallback. `reload` bypasses the HTTP cache so the
    // freshly-deployed offline page is stored, not a stale one.
    await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/** Decide whether a GET request to a same-origin path is a cacheable asset. */
function isCacheableAsset(pathname) {
  if (pathname.startsWith('/__webjs/action/')) return false; // RPC, never cache
  if (pathname === '/__webjs/events' || pathname === '/__webjs/reload.js') return false; // dev
  if (pathname.startsWith('/__webjs/core/') || pathname.startsWith('/__webjs/vendor/')) return true;
  return /\.(?:js|mjs|ts|css|woff2?|png|jpe?g|svg|webp|gif|ico|json|map)$/.test(pathname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never cache writes
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // only same-origin

  // Network-first for page navigations: fresh server HTML, cache it for offline,
  // fall back to the cached page then the offline page.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        // Cache ONLY a successful page (never a 404/500 error page, or an
        // offline visit would serve the cached error instead of the fallback).
        // waitUntil keeps the worker alive until the write lands (a worker can
        // be terminated the moment respondWith settles).
        if (fresh && fresh.ok) {
          const copy = fresh.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(req, copy)));
        }
        return fresh;
      } catch (_err) {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(req);
        return cached || (await cache.match(OFFLINE_URL)) || Response.error();
      }
    })());
    return;
  }

  // Stale-while-revalidate for static assets.
  if (isCacheableAsset(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => cached);
      // Keep the worker alive for the background revalidation + write, which
      // would otherwise be a floating promise lost on worker termination.
      event.waitUntil(network.catch(() => {}));
      return cached || network;
    })());
  }
});
