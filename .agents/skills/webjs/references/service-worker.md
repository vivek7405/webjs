# Service Worker (offline, opt-in)

## What This Covers

- The opt-in progressive-enhancement service worker that UI scaffolds ship dormant (`public/sw.js` plus `public/offline.html`).
- Why it is progressive-enhancement-safe: the worker registers only from JS, so the JavaScript-disabled baseline is unchanged.
- How to enable it (the registration snippet in the root layout), what it caches, and the offline fallback.
- Cache versioning tied to the deploy, updating the worker, and removing it.

Read this when you want an offline experience or an asset cache in a WebJs app, or you see `public/sw.js` in a scaffold and want to know what it does. For CSP nonces see `built-ins.md`. For the root layout see `routing-and-pages.md`. For the content-hash `?v=` asset URLs it relies on see `built-ins.md`.

## What ships and why it is safe

WebJs's UI scaffold (full-stack, not the api template) ships a hand-authored service worker at `public/sw.js` and an offline fallback at `public/offline.html`. Both ship **dormant**: they do nothing until the app registers the worker, and the worker only ever registers from JavaScript. So with JS off no worker exists, and pages, links, and forms behave exactly as before. It is opt-in and adds an offline experience plus an asset cache without changing the no-JS baseline.

This is a thin, hand-readable worker built directly on the native Service Worker and Cache Storage APIs. There is no Workbox, no precache framework, and no bundler step, matching WebJs's no-build, close-to-web-standards posture. The file is yours to edit, not a framework internal.

## Enabling it

Add this inline script to the root layout's `<head>` (`app/layout.ts`). It registers after load and only when JS is present, so it stays progressive-enhancement-safe:

```html
<script>
  if ('serviceWorker' in navigator) {
    addEventListener('load', () => {
      // Tie the worker version to the deploy: read the importmap build id and
      // register /sw.js?v=<build>, so a new deploy registers a "new" worker.
      const tag = document.querySelector('script[type="importmap"]');
      const build = (tag && tag.dataset.webjsBuild) || '';
      navigator.serviceWorker.register('/sw.js' + (build ? '?v=' + build : ''));
    });
  }
</script>
```

With WebJs's CSP enabled (`webjs.csp` in package.json), stamp the nonce on the script. Read it in the layout with `import { cspNonce } from '@webjsdev/core'` and emit `<script nonce="${cspNonce()}">...`.

## Scope and caching strategy

Registered from `/sw.js`, the worker's scope is the site root (`/`), so it sees every navigation and same-origin asset request. Your worker file lives at `public/sw.js`, and although most `public/*` assets serve at `/public/<name>`, the framework serves this one (and `public/offline.html`) at the SITE ROOT with a `Service-Worker-Allowed: /` header, so `register('/sw.js')` resolves to a 200 and the worker controls the whole origin.

- **Navigations are network-first.** The worker tries the network first, so the user sees fresh server-rendered HTML, and it caches each successful page (the SSR shell). When the network fails, it serves the cached page if you have visited it, otherwise `/offline.html`. Network-first means the cache never makes a page go stale; it is purely an offline safety net.
- **Static assets are stale-while-revalidate.** Same-origin modules (the per-file ESM the no-build runtime serves), the framework runtime under `/__webjs/core/`, vendor bundles under `/__webjs/vendor/`, and `public/` assets are served from cache when present and refreshed in the background. In production the framework-emitted URLs (modules, the core runtime, vendor bundles) carry a `?v=<hash>` content fingerprint automatically, so a changed file gets a new URL and the cache cannot serve stale bytes for those.

  A `public/` asset is the exception, and it matters most here. Its URL is fingerprinted only when you mark it with `asset()` (`href=${asset('/public/app.css')}`, see `built-ins.md`). An un-marked `public/` URL is stable across deploys, so the worker keeps serving the CACHED copy and revalidates in the background, which means the first load after a deploy renders the OLD bytes. Do not rely on the worker's cache version to save you: it is derived from the deploy build id, which is a deploy fingerprint rather than a per-file content hash, so a deploy that only changes a `public/` file need not change it. Mark any `public/` asset whose bytes change with `asset()`.

**Never cached:** non-GET requests (writes), cross-origin requests, the action RPC endpoint (`/__webjs/action/`), and the dev-only `/__webjs/events` (SSE) and `/__webjs/reload.js`. Keeping writes and RPC off the cache means the worker can never serve a stale mutation result or replay a POST, so correctness is unaffected whether the worker is active or not.

## The offline fallback page

`public/offline.html` is a plain, self-contained HTML page the worker serves only when a navigation fails and no cached copy of that URL exists. Treat it as the app's offline chrome and edit it to match the app's branding. It ships as a minimal placeholder in the scaffold. Because it renders with no network and no module system, keep it static: no component tags, no importmap dependency, inline any styles it needs.

## Versioning ties to the deploy

The cache name is `webjs-<build>`, where `<build>` is the `?v=` query the registration passes (the importmap build id from `data-webjs-build`). When a deploy changes the build id:

1. the page registers `/sw.js?v=<new-build>`, a different worker URL, so the browser fetches and installs the new worker;
2. the new worker's `activate` deletes every cache whose name is not the current `webjs-<new-build>`, evicting the prior deploy's cache.

So a deploy refreshes the offline cache automatically, with no manual cache busting. Without a `?v=` (a dev registration, say), the cache name is `webjs-dev`.

## Updating the worker

The browser re-checks `/sw.js` on navigation and replaces the worker when its bytes change. Because the registration URL carries the build id, a deploy always changes that URL and triggers the update. The worker calls `skipWaiting()` plus `clients.claim()`, so a new version takes control promptly. To change the caching strategy, edit `public/sw.js`.

## Removing it

Delete the registration snippet (and optionally `public/sw.js` and `public/offline.html`). To also un-register an already-installed worker on clients, ship this for one release:

```js
navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
```

Or rely on the worker's own update lifecycle to phase it out.

## Verifying it

After adding the registration snippet, load the app, then open the browser devtools Application panel and confirm a worker is registered and activated for the origin. To exercise the offline path, visit a page (so it caches), then toggle offline in devtools and reload: a previously visited page should serve from cache, and an unvisited URL should render `public/offline.html`. Confirm the JS-off baseline is unchanged by disabling JavaScript and checking that no worker registers and navigation still works as a plain server-rendered app.

Do not register the worker until the offline experience is something you actually want. Once registered, a worker changes caching for returning visitors: navigations stay network-first (an online visitor gets fresh server HTML), assets are served stale-while-revalidate, and the cached page shell is served only when the visitor is offline, until a new deploy build id evicts the cache.
