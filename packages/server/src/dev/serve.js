/**
 * Serving a request once the dev/prod handler has decided what it is: the
 * framework's own static files, an app source module (with TypeScript stripped
 * and elision applied), and the per-segment middleware chain around a route.
 *
 * Split off handler.js, which was 1460 lines. The seam is real rather than
 * arithmetic: nothing here builds or configures the handler, and the handler
 * half calls into it at exactly three points.
 */
import { stat, readFile } from 'node:fs/promises';
import { join, extname, resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { matchPage, matchApi } from '../router.js';
import { ssrPage, ssrNotFound } from '../ssr.js';
import { runFormAction, reportFormSubmittedAsGet } from '../form-dispatch.js';
import { handleApi } from '../api.js';
import {
  serveActionStub,
  serveServerOnlyStub,
  invokeAction,
  isServerFile,
  hasUseServerDirective,
  hashFile,
} from '../actions.js';
import { maybeRegenerate } from '../dev-regenerate.js';
import { stripTypeScript } from '../ts-strip.js';
import { serveDownloadedBundle } from '../vendor.js';
import { resolveImport } from '../module-graph.js';
import { elideImportsFromSource } from '../component-elision.js';
import { basePath } from '../importmap.js';
import { withBasePath } from '../base-path.js';
import { versionModuleImports } from '../asset-hash.js';
import { BUFFERED_MARKER } from '../conditional-get.js';
import { MIME, TS_CACHE_MAX, exists, reloadClientJs, reloadWorkerJs } from './helpers.js';

/**
 * Serve framework-internal static assets that depend on NEITHER the whole-app
 * analysis NOR the vendor importmap: the `@webjsdev/core` runtime files, the
 * dev reload client, and (in `--download` pin mode) the committed vendor
 * bundles. `handle()` calls this BEFORE `ensureReady()`, so a cold instance
 * returns them immediately instead of blocking on the first vendor resolve
 * (issue #190). The core bundle is on every page's boot path, so coupling it
 * to the jspm resolve stalled first interactivity site-wide on a cold instance.
 *
 * Like the health / readiness probes (also answered pre-`ensureReady`), these
 * bypass app middleware. That is correct: they are framework infrastructure the
 * app needs to function, not app routes, and `state.middleware` is not even
 * loaded until `ensureReady()` completes.
 *
 * @param {string} path decoded pathname
 * @param {string} method upper-cased HTTP method
 * @param {{ coreDir: string, appDir: string, dev: boolean, versioned?: boolean }} ctx
 *   `versioned` is true when the request carried a `?v=` query (a
 *   content-hash-fingerprinted url, issue #243); the core module is then served
 *   `immutable` (1 year) instead of the 1h fallback, since the hash in the url
 *   busts the cache on the next deploy.
 * @returns {Promise<Response|null>} a Response, or null when path is not one of these assets
 */
export async function tryServeFrameworkStatic(path, method, { coreDir, appDir, dev, versioned }) {
  // Core module: /__webjs/core/*
  //
  // ETag + ~1h max-age, NOT immutable. The URL path is un-versioned
  // (`/__webjs/core/src/render-client.js` etc.), so bumping `@webjsdev/core`
  // ships different bytes at the same URL. An `immutable` cache-control
  // directive at an edge CDN (Cloudflare, Vercel, Fly) keeps the prior bytes
  // pinned for up to a year, which silently bricks the next deploy: browsers
  // load the old client renderer against a server emitting the new SSR shape,
  // and any exports added in the bump (e.g., the slot.js entry points landed
  // for 0.6.0) resolve to undefined in the cached file.
  // Regression: 2026-05-20, ui.webjs.dev tier-2 components after
  // @webjsdev/core 0.5.0 -> 0.6.0 republish.
  if (path.startsWith('/__webjs/core/')) {
    const rel = path.slice('/__webjs/core/'.length);
    const abs = resolve(coreDir, rel);
    // Trailing-separator boundary check, not a raw string prefix: a raw
    // `startsWith(coreDir)` would admit a sibling like `@webjsdev/core-evil`,
    // reachable via an encoded slash (`..%2f`, which survives URL normalization
    // and then decodes to `../`). Match the public-root branch's guard.
    if (abs !== coreDir && !abs.startsWith(coreDir + sep)) {
      return new Response('forbidden', { status: 403 });
    }
    // A `?v=<hash>` request is content-addressed, so serve it `immutable` (#243):
    // the hash busts the cache on the next core bump, so the regression the
    // un-versioned 1h cap guards against (a stale immutable core after a bump)
    // cannot recur. An un-fingerprinted request keeps the 1h fallback.
    return fileResponse(abs, { dev, immutable: !!versioned });
  }

  // Vendor URL handler for `webjs vendor pin --download` mode only. In default
  // pin mode (or no-pin mode) the importmap routes bare imports straight to
  // ga.jspm.io URLs and the browser bypasses this server entirely. When the
  // user ran `webjs vendor pin --download`, the importmap has local
  // `/__webjs/vendor/<file>.js` URLs and this serves the committed bundle files
  // from `.webjs/vendor/`. These are read-only static content: allow GET/HEAD
  // for the normal fetch, OPTIONS for any cross-origin preflight (204 with the
  // same Allow header rather than 405, which some intermediaries treat as a
  // hard failure even for a CORS probe), and 405 everything else.
  if (path.startsWith('/__webjs/vendor/') && path.endsWith('.js')) {
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { allow: 'GET, HEAD, OPTIONS' } });
    }
    if (method !== 'GET' && method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { allow: 'GET, HEAD, OPTIONS' } });
    }
    const filename = path.slice('/__webjs/vendor/'.length);
    const resp = await serveDownloadedBundle(filename, appDir, dev);
    if (method === 'HEAD') {
      // HEAD must return same headers as GET with no body.
      return new Response(null, { status: resp.status, headers: resp.headers });
    }
    return resp;
  }

  // Dev live-reload client, and its SharedWorker (one shared connection for all
  // tabs, #887). The `!dev` arm answers 404 rather than falling through, so the
  // path is dead in production instead of being routed like an app url.
  //
  // These live HERE, in the shared helper, rather than inline at the early
  // `handle()` call site, for the same reason `tryServePublicAsset` was
  // extracted in #1397: both callers then run ONE implementation and the two
  // cannot drift. It also keeps the `handleCore` fallback below honest, whose
  // comment promises these assets still serve if a future caller ever bypasses
  // the early path. `basePath()` is the value `setBasePath()` recorded at
  // handler construction, so it is the same base path the inline copy read.
  if (path === '/__webjs/reload.js' || path === '/__webjs/reload-worker.js') {
    if (!dev) return new Response('Not found', { status: 404 });
    const src = path === '/__webjs/reload.js'
      ? reloadClientJs(basePath())
      : reloadWorkerJs(basePath());
    return new Response(src, {
      headers: { 'content-type': 'application/javascript; charset=utf-8' },
    });
  }

  return null;
}

/**
 * Serve `/public/*`, plus a small set of ROOT assets that must serve at the
 * site root even though they live under public/. A service worker registered at
 * /sw.js scopes to the origin root, so it MUST serve at / (not /public/sw.js),
 * and so must its offline fallback. Same remap shape as the /favicon.ico
 * special-case. (#830)
 *
 * Extracted (#1397) so the dev pre-`ensureReady()` call site and the
 * `handleCore` one share ONE implementation, and the containment guard below
 * cannot drift between two copies.
 *
 * @param {string} path decoded pathname
 * @param {{ appDir: string, dev: boolean, versioned?: boolean, regenerateRules: any[] }} ctx
 * @returns {Promise<Response|null>} a Response, or null when the path is not a
 *   public asset OR the file does not exist, in both of which cases the caller
 *   must fall through to the rest of the pipeline (a missing `/public/x.png`
 *   404s through normal routing today, and that must not change). A containment
 *   rejection returns a 404 Response and short-circuits.
 */
export async function tryServePublicAsset(path, ctx) {
  const { appDir, dev, versioned, regenerateRules } = ctx;
  const ROOT_ASSETS = { '/sw.js': '/public/sw.js', '/offline.html': '/public/offline.html' };
  if (!(path.startsWith('/public/') || path === '/favicon.ico' || path in ROOT_ASSETS)) return null;
  const p = path === '/favicon.ico' ? '/public/favicon.ico' : (ROOT_ASSETS[path] || path);
  const abs = join(appDir, p);
  // Containment check. `join` normalises `..` segments, so a path
  // like `/public/..%2Fsecret/x.svg` decodes to `/public/../secret/
  // x.svg` and `join(appDir, ...)` resolves it to `appDir/secret/
  // x.svg`. The resulting `abs` could be inside `appDir` but OUTSIDE
  // `appDir/public/`, exposing files the user reasonably thought were
  // private under their non-public directories. Reject anything
  // that doesn't stay under `appDir/public/` (and the favicon
  // exception, which is already validated above).
  // The live vector encodes the SLASH, not the dots: the WHATWG URL
  // parser decodes `%2E%2E` and normalises the dot segment away, so a
  // `/public/%2E%2E/x` request arrives here as plain `/x` and never
  // enters this branch. `..%2F` survives parsing intact and does.
  const publicRoot = join(appDir, 'public') + sep;
  if (!abs.startsWith(publicRoot)) {
    return new Response(null, { status: 404 });
  }
  // On-request regeneration (#967): in dev, if a `webjs.dev.regenerate` rule
  // matches this output and it is stale (a source is newer, or it is missing),
  // rebuild it to completion BEFORE serving, so a newly added utility class is
  // never served stale. No-op when no rule matches or the output is fresh, and
  // never runs in prod (rules are empty there). This replaces the fragile
  // `tailwindcss --watch` that could die mid-session and serve stale CSS.
  if (dev && regenerateRules.length) {
    await maybeRegenerate(appDir, p.replace(/^\/+/, ''), regenerateRules);
  }
  // A `?v=<hash>` public asset is content-addressed -> immutable (#243).
  if (await exists(abs)) {
    const res = await fileResponse(abs, { dev, immutable: versioned });
    // A worker served below its registration path only controls that subtree
    // unless the response opts it up to the root scope. (#830)
    if (path === '/sw.js') res.headers.set('Service-Worker-Allowed', '/');
    return res;
  }
  return null;
}

export async function handleCore(req, ctx) {
  const { state, appDir, coreDir, dev, reportError, reportDevError, hasOnError, logger, cspEnabled, allowedOrigins } = ctx;
  const url = new URL(req.url);
  // Decode percent-encoded characters so filesystem lookups match real
  // filenames. Dynamic route segments like `[slug]` and route groups like
  // `(marketing)` contain chars that browsers percent-encode in URLs
  // (`%5B`, `%5D`, `%28`, `%29`). Without decoding, the server joins the
  // encoded path with the app directory → file not found → 404 → no JS
  // loads → no interactivity.
  let path;
  try { path = decodeURIComponent(url.pathname); } catch { path = url.pathname; }
  const method = req.method.toUpperCase();
  // Content-hash fingerprint (#243): a `?v=` query marks a content-addressed
  // asset url that may be served `immutable` (the hash busts the cache on a
  // byte change). The pathname (query stripped by `url.pathname`) resolves the
  // file as today; only the cache header changes when `?v` is present.
  const versioned = url.searchParams.has('v');

  // Health / readiness probes (`/__webjs/health`, `/__webjs/ready`) and the
  // framework-internal static assets (`/__webjs/core/*`, `/__webjs/reload.js`,
  // `/__webjs/reload-worker.js`, downloaded `/__webjs/vendor/*`) are served in
  // `handle()` BEFORE ensureReady,
  // so they are not repeated here. This fallback covers the (currently
  // unreachable) case of handleCore being entered for one of those assets, so
  // the routing stays correct if a future caller bypasses the early path.
  const frameworkStatic = await tryServeFrameworkStatic(path, method, { coreDir, appDir, dev, versioned });
  if (frameworkStatic) return frameworkStatic;

  // Internal server-action RPC endpoint
  const actMatch = /^\/__webjs\/action\/([a-f0-9]+)\/([A-Za-z0-9_$]+)$/.exec(path);
  if (actMatch) {
    // HTTP-verb actions (#488): any RPC verb may hit the endpoint; invokeAction
    // enforces the action's DECLARED method (405 + Allow on a mismatch) and
    // reads args from the URL (GET/DELETE) or the body (POST/PUT/PATCH).
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return new Response('method not allowed', { status: 405 });
    }
    // Pass the onError sink (issue #239): a server action that throws
    // unexpectedly is reported to the APM hook before the sanitized 500.
    const onActionError = reportError ? (e) => reportError(e, req, 'action') : undefined;
    return invokeAction(state.actionIndex, actMatch[1], actMatch[2], req, onActionError, allowedOrigins);
  }

  // Static: /public/*, the #830 root remaps, and /favicon.ico. In dev this
  // already ran before ensureReady() (#1397); this stays the LIVE path in prod
  // and the fallback in dev, and both call sites share one implementation.
  const publicResp = await tryServePublicAsset(path, { appDir, dev, versioned, regenerateRules: state.regenerateRules });
  if (publicResp) return publicResp;

  // User source modules (served as ES modules, with action-file rewriting).
  //
  // Authorization gate: only files reachable from a browser-bound entry
  // (page, layout, error, loading, not-found, component) via the module
  // graph are servable. Same posture as Next.js, where the bundler's
  // manifest is the source of truth for what the browser may fetch.
  // Anything not in the set (node_modules/, top-level package.json,
  // scripts/, etc.) 404s here regardless of whether the file exists on
  // disk. The `.server.{js,ts}` stub guardrail runs below as a
  // defense-in-depth layer.
  if (method === 'GET' && /\.(js|mjs|ts|mts|css|svg|png|jpg|jpeg|gif|webp|json|ico|txt)$/.test(path)) {
    let abs = join(appDir, path);
    // When the browser asks for `.js`, allow falling through to a sibling
    // `.ts` (the TypeScript-with-"allowImportingTsExtensions: false" pattern).
    if (!(await exists(abs)) && /\.js$/.test(abs)) {
      const tsAbs = abs.replace(/\.js$/, '.ts');
      if (await exists(tsAbs)) abs = tsAbs;
      else {
        const mtsAbs = abs.replace(/\.js$/, '.mts');
        if (await exists(mtsAbs)) abs = mtsAbs;
      }
    }
    // Gate: must be in the browser-bound module graph. Server-action
    // files (.server.{js,ts}) get a stub via the guardrail below; they
    // ARE included in browserBoundFiles because client code imports
    // them by path (the import rewrites to an RPC stub at request time).
    // In test mode any app file is servable (see the `state.testMode` note
    // above); otherwise the file must be in the browser-bound module graph.
    const inGraph = state.testMode || (state.browserBoundFiles && state.browserBoundFiles.has(abs));
    // Containment: `abs` must be appDir itself or genuinely UNDER it. The
    // trailing `sep` (matching the public-asset branch) stops a `..` path that
    // resolves to a sibling sharing the appDir name-prefix (`/x/app` ->
    // `/x/app-secrets/...`) from passing in test mode, where graph membership
    // is not the gate.
    const underAppDir = abs === appDir || abs.startsWith(appDir + sep);
    if (underAppDir && inGraph && (await exists(abs))) {
      // Server-file guardrail: a file matching `.server.{js,ts,mjs,mts}`
      // MUST NEVER be served as source to the browser. The extension is
      // the path-level boundary; we re-verify it on every request (not
      // just rely on the action-index snapshot, which is built on the first
      // request and refreshed on rebuild) so files created later, FS races,
      // or developer error never punch through.
      //
      // What the browser gets depends on the file's `'use server'` status:
      //   - With `'use server'` => server action: a generated RPC stub
      //     whose exports POST to /__webjs/action/:hash/:fn.
      //   - Without `'use server'` => server-only utility: a stub that
      //     throws at module load with a clear error. The file's source
      //     never reaches the browser either way.
      if (isServerFile(abs)) {
        if (await hasUseServerDirective(abs)) {
          // Lazily ensure the index knows about this file so serveActionStub
          // can mint a stable hash and function list.
          if (!state.actionIndex.fileToHash.has(abs)) {
            const h = await hashFile(abs);
            state.actionIndex.fileToHash.set(abs, h);
            state.actionIndex.hashToFile.set(h, abs);
          }
          const stub = await serveActionStub(state.actionIndex, abs);
          return new Response(stub, {
            headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' },
          });
        }
        const relPath = relative(appDir, abs);
        const stub = serveServerOnlyStub(relPath);
        return new Response(stub, {
          headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' },
        });
      }
      // TypeScript source: strip types via Node 24+'s built-in, cache by mtime.
      // Both module paths also strip side-effect imports of display-only
      // components so the browser never downloads their JS.
      const elideOpts = {
        moduleGraph: state.moduleGraph,
        elidableComponents: state.elidableComponents,
        appDir,
      };
      // A `?v=<hash>` app-module request is content-addressed -> immutable
      // (#243); an un-fingerprinted request keeps the 1h fallback.
      if (/\.m?ts$/.test(abs)) {
        return tsResponse(abs, dev, elideOpts, state.tsCache, versioned, reportDevError);
      }
      if (/\.m?js$/.test(abs)) {
        return jsModuleResponse(abs, dev, elideOpts, versioned);
      }
      return fileResponse(abs, { dev, immutable: versioned });
    }
    // Dev hint (#751): the request is for a real app source module that EXISTS
    // on disk but is NOT in the browser-bound graph, so the gate 404s it. The
    // most common cause is a dynamic `import()` the static scanner cannot
    // track: a string-literal `import('./x.ts')` IS tracked and servable, but a
    // computed `import(expr)` / `import('./' + name)` cannot be resolved
    // statically and falls through here. Surface the likely cause instead of a
    // bare 404 so the author is not left guessing. Dev-only and diagnostic; it
    // does not change the 404 status, only the body + a server log line.
    if (dev && abs.startsWith(appDir) && /\.m?[jt]s$/.test(abs) && (await exists(abs))) {
      const rel = relative(appDir, abs);
      const hint = `[webjs] 404: ${rel} exists but is not reachable from any browser-bound entry, so it is not servable. If you load it via a dynamic import(), use a STRING-LITERAL specifier (e.g. import('./x.ts')) so the scanner can track it; a computed import(expr) cannot be resolved statically and will 404. Otherwise this module is simply unreferenced by client code.`;
      console.warn(hint);
      return new Response(hint, { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  }

  // Metadata routes: /sitemap.xml, /robots.txt, /icon, /opengraph-image, etc.
  if (method === 'GET' && state.routeTable.metadataRoutes) {
    const meta = state.routeTable.metadataRoutes.find((r) => r.urlPath === path);
    if (meta) {
      try {
        const mod = await import(pathToFileURL(meta.file).toString() + (dev ? `?t=${Date.now()}` : ''));
        if (mod.default) {
          const result = await mod.default();
          // If the function returns a Response, use it directly.
          if (result instanceof Response) return result;
          // If it returns a string, determine content type from the URL path.
          const ct = path.endsWith('.xml') ? 'application/xml; charset=utf-8'
            : path.endsWith('.txt') ? 'text/plain; charset=utf-8'
            : path.endsWith('.json') ? 'application/json; charset=utf-8'
            : 'application/octet-stream';
          return new Response(typeof result === 'string' ? result : JSON.stringify(result), {
            headers: { 'content-type': ct, 'cache-control': dev ? 'no-cache' : 'public, max-age=3600' },
          });
        }
      } catch (e) {
        if (reportError) reportError(e, req, 'metadata');
        if (dev) console.error(`[webjs] metadata route error (${meta.stem}):`, e);
        return new Response('Internal error', { status: 500 });
      }
    }
  }

  // API route (route.js handler)
  const api = matchApi(state.routeTable, path);
  if (api) {
    const handler = () => handleApi(api.route, api.params, req, dev);
    return runWithSegmentMiddleware(req, api.route.middlewares, handler, dev);
  }

  // Page route. GET/HEAD render the page. A NON-GET/HEAD method (POST/PUT/…)
  // is a form submission (#1155): the `__webjs_action` hidden field names the
  // server action to run, it runs inside the page's segment middleware, and the
  // result either PRG-redirects (303), re-renders the same page (422) with
  // field errors, or honors a thrown redirect()/notFound(). A non-GET carrying
  // no action identity is a 405 on a path that exists but only renders.
  {
    const page = matchPage(state.routeTable, path);
    if (page) {
      // The URL this render is FOR, in the form the browser sees it (#1047), so
      // the overlay's scope gate can compare it against `location.pathname +
      // location.search`. Two details are load-bearing: the RAW `url.pathname`
      // (not the decoded `path`) is used, because `location.pathname` is
      // percent-encoded too; and the base path is put back, because the ingress
      // strip already removed it from `url` while the browser's location still
      // carries it, so without this the gate would suppress every overlay on a
      // sub-path deploy.
      const devErrorUrl = withBasePath(url.pathname, basePath()) + url.search;
      // A speculative link prefetch must never raise an overlay (#1047): the
      // user is only hovering a link to a page that throws, and the page they
      // are actually looking at is fine. Dropping the hook also keeps the throw
      // out of `state.lastDevError`, so the SSE replay cannot hand it to a
      // freshly-connected tab either. The APM `onError` sink below still fires,
      // because the render really did throw.
      const isPrefetch = req.headers.get('x-webjs-prefetch') === '1';
      const ssrOpts = {
        dev, appDir, moduleGraph: state.moduleGraph,
        serverFiles: state.actionIndex.fileToHash,
        elidableComponents: state.elidableComponents,
        inertRouteModules: state.inertRouteModules,
        importOnlyRouteModules: state.importOnlyRouteModules,
        notFoundFile: state.routeTable.notFound,
        // Root-only boundaries (#848): the app-wide catch-all error page and the
        // unmatched-anywhere 404, rendered by ssr.js when a nested boundary is
        // absent.
        globalError: state.routeTable.globalError,
        globalNotFound: state.routeTable.globalNotFound,
        // instrumentation-client.{js,ts} (#848): imported first in the client
        // boot so it runs before app modules.
        instrumentationClient: state.routeTable.instrumentationClient,
        // Server HTML cache (#241): a CSP-enabled page emits a fresh
        // per-request nonce into its body, so its bytes vary per request and
        // it must never be HTML-cached. Pass the flag so the cache guard skips
        // it. CSP is off by default, so the common case stays cacheable.
        cspEnabled,
        // onError sink (issue #239): a page render error that becomes a 500 is
        // reported to the APM hook with the active request's correlation id.
        onError: reportError ? (e) => reportError(e, req, 'ssr') : undefined,
        // Dev error overlay (#264): a render crash pushes a frame to the open
        // tab. Dev-only (reportDevError early-returns in prod), so no source
        // leaks. Distinct from onError (the APM sink), which always fires.
        onDevError: dev && !isPrefetch
          ? (e) => reportDevError(e, { kind: 'render', url: devErrorUrl })
          : undefined,
      };
      if (method === 'GET' || method === 'HEAD') {
        // #1307: `__webjs_action` in the QUERY STRING means a submission
        // carrying a bound action's identity went out as a GET, so the action
        // never ran. Nothing else in the framework puts that reserved field in
        // a url. Detect only, so the render below is unchanged: answering a GET
        // differently because of a query parameter would hand any visitor a way
        // to turn any page into an error.
        reportFormSubmittedAsGet(
          url, req,
          // Gated on hasOnError, not on `reportError`: that is always a
          // function here and no-ops internally, so passing it would spend a
          // dedupe slot on a report nobody receives.
          hasOnError ? (e) => reportError(e, req, 'action') : undefined,
          logger, dev, page.route,
        );
        // A successful render of URL U supersedes a RETAINED render error for
        // that same URL (#1047), so a reconnecting tab is not handed a frame the
        // page has since recovered from. Keyed on BOTH frame identity and url:
        // identity so a frame this very render just reported is never wiped, url
        // so a good render of an unrelated page cannot erase an error that is
        // still current for the page the user is looking at (the #893 gap the
        // retention exists to close). Dev-only, and skipped for a prefetch,
        // which is not the user's view of anything.
        const handler = dev && !isPrefetch
          ? async () => {
            const before = state.lastDevError;
            const resp = await ssrPage(page.route, page.params, url, { ...ssrOpts, req });
            if (
              before && state.lastDevError === before
              && before.kind === 'render' && before.url === devErrorUrl
            ) state.lastDevError = null;
            return resp;
          }
          : () => ssrPage(page.route, page.params, url, { ...ssrOpts, req });
        return runWithSegmentMiddleware(req, page.route.middlewares, handler, dev);
      }
      // Every non-GET/HEAD to a page runs the page's segment middleware, and
      // the dispatcher always answers with a Response (a 405 when there is no
      // action to run), so a middleware that post-processes `await next()`
      // never has to handle an absent one.
      const deps = {
        actionIndex: state.actionIndex,
        allowedOrigins,
        onError: hasOnError ? (e) => reportError(e, req, 'action') : undefined,
        logger,
      };
      const handler = () => runFormAction(page.route, page.params, url, req, ssrOpts, deps);
      return runWithSegmentMiddleware(req, page.route.middlewares, handler, dev);
    }
  }

  // Fallback: content-negotiated 404
  if (wantsJson(req, path)) {
    return Response.json({ error: 'Not found', path }, { status: 404 });
  }
  // Unmatched anywhere: prefer the root not-found.{js,ts}, then a
  // global-not-found.{js,ts} (#848), else the default 404 page.
  // The APM / overlay sinks ride along here too: a root not-found that throws
  // or fails to load must reach them, not only the console (#1298). Built
  // inline rather than reused, because the ssrOpts above is scoped to the
  // matched-page branch, which this path did not take.
  //
  // No `route` is passed on purpose: nothing matched, so there is no layout
  // chain to render the boundary inside, and the response stays a bare
  // document with no boot script.
  // Same supersede rule the matched-page branch follows (#1047 / #893): a
  // LATER successful render of this same url clears the frame it retained, so
  // an intermittently-failing not-found (a query behind it, not a source edit,
  // which the rebuild already clears) cannot leave a frame that paints over a
  // page that has since recovered. Scoped to this url, so a good render here
  // never erases an error still current for a page the user is looking at.
  const devErrorUrl = withBasePath(url.pathname, basePath()) + url.search;
  const before = dev ? state.lastDevError : null;
  const resp = await ssrNotFound(state.routeTable.notFound || state.routeTable.globalNotFound, {
    dev,
    appDir,
    req,
    url,
    onError: reportError ? (e) => reportError(e, req, 'ssr') : undefined,
    // The frame's url must be stamped exactly as the matched-page branch
    // stamps it, or the overlay's scope gate refuses it: the browser compares
    // against `location.pathname + location.search`, so dropping the query
    // suppresses the overlay on any unrouted url that carries one, and
    // dropping the base path suppresses it on EVERY url of a sub-path deploy
    // (the ingress strip already removed the prefix from `url`, while the
    // browser's location still has it). A refused frame goes to the pending
    // slot and is then discarded, so the overlay simply never paints.
    //
    // Dropped for a speculative prefetch, on the same #1047 rule the
    // matched-page branch follows: hovering a link to a broken page must not
    // raise an overlay on the page you are actually on, nor become
    // `state.lastDevError` for the SSE to replay into a fresh tab. Prefetch is
    // on by default and fetches unrouted hrefs too, so this is reachable.
    onDevError: dev && req.headers.get('x-webjs-prefetch') !== '1'
      ? (e) => reportDevError(e, { kind: 'render', url: devErrorUrl })
      : undefined,
  });
  if (
    before && state.lastDevError === before
    && before.kind === 'render' && before.url === devErrorUrl
  ) state.lastDevError = null;
  return resp;
}

/** @param {Request} req @param {string} path */
export function wantsJson(req, path) {
  const accept = req.headers.get('accept') || '';
  if (accept.includes('application/json') && !accept.includes('text/html')) return true;
  if (path.startsWith('/api/') || path.startsWith('/__webjs/')) return true;
  return false;
}

/**
 * Chain segment-level middleware.js (outermost first) around a handler.
 * Each middleware is `(req, next) => Response`. If any throws, log and 500.
 *
 * @param {Request} req
 * @param {string[]} files   absolute paths of middleware.js files, outermost → innermost
 * @param {() => Promise<Response>} terminal
 * @param {boolean} dev
 */
export async function runWithSegmentMiddleware(req, files, terminal, dev) {
  if (!files || !files.length) return terminal();
  const handlers = [];
  for (const f of files) {
    try {
      const url = pathToFileURL(f).toString();
      const bust = dev ? `?t=${Date.now()}-${Math.random().toString(36).slice(2)}` : '';
      const mod = await import(url + bust);
      if (typeof mod.default === 'function') handlers.push(mod.default);
    } catch {
      // Bad middleware file: skip; top-level error handler will catch real problems.
    }
  }
  let i = 0;
  const next = () => {
    if (i >= handlers.length) return terminal();
    const fn = handlers[i++];
    return fn(req, next);
  };
  return next();
}

/**
 * Root-middleware filename candidates, in resolution order.
 *
 * Every other routing convention accepts all four extensions (the router
 * matches on the STEM, so `app/<segment>/middleware.ts` has always worked),
 * and both the scaffold and the dev supervisor write / watch `middleware.ts`.
 * This lookup used to be the single literal `middleware.js`, so a root
 * `middleware.ts` was silently never loaded: no error, no warning, the app
 * just ran with no global middleware. TypeScript is the documented default
 * for an app, so that was the common case, and it went unnoticed because the
 * failure is invisible (a missing middleware looks exactly like an app that
 * has none). `.ts` is tried first to match the dev supervisor's order.
 */
const ROOT_MIDDLEWARE_FILES = ['middleware.ts', 'middleware.js', 'middleware.mts', 'middleware.mjs'];

/**
 * Load the optional top-level `middleware.{ts,js,mts,mjs}`.
 * @param {string} appDir
 * @param {boolean} dev
 * @param {import('../logger.js').Logger} logger
 */
export async function loadMiddleware(appDir, dev, logger) {
  let file = null;
  for (const name of ROOT_MIDDLEWARE_FILES) {
    const candidate = join(appDir, name);
    if (await exists(candidate)) { file = candidate; break; }
  }
  if (!file) return null;
  const url = pathToFileURL(file).toString();
  const bust = dev ? `?t=${Date.now()}-${Math.random().toString(36).slice(2)}` : '';
  try {
    const mod = await import(url + bust);
    return typeof mod.default === 'function' ? mod.default : null;
  } catch (e) {
    logger.error('failed to load root middleware', { file, err: String(e) });
    return null;
  }
}

/**
 * Read a file and return a Response with appropriate caching.
 * Dev: no-cache (always revalidate).
 * Prod: ETag + ~1h max-age for user files; `immutable` bumps to 1 year.
 *
 * @param {string} abs
 * @param {{ dev: boolean, immutable: boolean }} opts
 */
export async function fileResponse(abs, opts) {
  try {
    let data = await readFile(abs);
    // In dev an external watcher (tailwindcss --watch, esbuild, ...) rewrites a
    // public asset with truncate-then-write, so the file is 0 bytes for a short
    // window during a rebuild. A hot reload that lands in that window would
    // serve empty CSS / JS and the page paints unstyled (#891). Close that
    // 0-byte window: when an empty read comes from a file that was JUST modified
    // (the mid-rewrite signal), re-read a few times so the truncated read does
    // not reach the browser. A genuinely empty, untouched asset is served
    // immediately (no delay), and a non-zero-but-partial write is a smaller
    // residual gap this does not cover. Prod has no such watcher and is
    // left untouched.
    if (opts.dev && data.length === 0) {
      let midRewrite = false;
      try { midRewrite = Date.now() - (await stat(abs)).mtimeMs < 500; } catch { /* gone */ }
      for (let i = 0; midRewrite && i < 12 && data.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 20));
        try { data = await readFile(abs); } catch { break; }
      }
    }
    const type = MIME[extname(abs).toLowerCase()] || 'application/octet-stream';
    // The body is fully buffered (read into `data`), so opt it into the
    // conditional-GET funnel, which is the single place that hashes the bytes
    // into a weak ETag and honors If-None-Match -> 304 (dev + prod alike).
    const headers = { 'content-type': type, [BUFFERED_MARKER]: '1' };
    headers['cache-control'] = opts.dev
      ? 'no-cache'
      : opts.immutable
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600';
    return new Response(data, { status: 200, headers });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

/**
 * Serve a plain `.js` / `.mjs` browser module, stripping side-effect
 * imports of display-only components. Mirrors {@link fileResponse}'s
 * headers but reads as text so the source can be transformed. Used only
 * for files that exist as `.js` on disk (TS apps usually hit
 * {@link tsResponse} via the .js to .ts sibling rewrite instead).
 *
 * @param {string} abs
 * @param {boolean} dev
 * @param {{ moduleGraph: any, elidableComponents: Set<string>|undefined, appDir: string }} elideOpts
 * @param {boolean} [immutable]  true for a `?v=<hash>` content-addressed request (#243):
 *   serve `immutable` (1 year) instead of the 1h fallback. Dev stays `no-cache`.
 */
export async function jsModuleResponse(abs, dev, elideOpts, immutable) {
  let source;
  try { source = await readFile(abs, 'utf8'); }
  catch { return new Response('Not found', { status: 404 }); }
  let code = elideImportsFromSource(
    source, abs, elideOpts.moduleGraph, elideOpts.elidableComponents, resolveImport, elideOpts.appDir,
  );
  // Version same-origin relative import specifiers so the URL the browser
  // fetches matches the `?v=`-versioned modulepreload + boot specifier (#369).
  // A no-op in dev (fingerprinting disabled).
  code = versionModuleImports(code, abs);
  // Buffered (string) body, so opt into the conditional-GET funnel for the
  // weak ETag + 304 (see fileResponse).
  const headers = {
    'content-type': 'application/javascript; charset=utf-8',
    'cache-control': dev ? 'no-cache' : immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
    [BUFFERED_MARKER]: '1',
  };
  return new Response(code, { status: 200, headers });
}

/**
 * Strip TypeScript types from `source` via Node's built-in
 * `module.stripTypeScriptTypes`. Position-preserving whitespace
 * replacement: no sourcemap is needed because every (line, column)
 * maps to itself in the source.
 *
 * Only erasable TypeScript is supported. Non-erasable syntax
 * (`enum`, `namespace` with values, parameter properties, legacy
 * decorators with `emitDecoratorMetadata`, `import = require`)
 * throws `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` from Node and the
 * dev server returns the error to the caller. The
 * `erasable-typescript-only` and `no-non-erasable-typescript` lint
 * rules catch these at edit time. There is no bundler fallback;
 * WebJs is buildless end-to-end.
 *
 * The backend is the runtime-appropriate stripper (#508): Node 24+'s built-in
 * `module.stripTypeScriptTypes`, or `amaro` on Bun (byte-identical, equally
 * position-preserving), resolved once via `./ts-strip.js`.
 *
 * @param {string} source
 * @param {string} _abs  (unused; preserved for symmetry with prior signature)
 * @returns {Promise<string>}
 */
export async function stripTs(source, _abs) {
  return stripTypeScript(source);
}

/**
 * Serve a `.ts` / `.mts` source file as JavaScript via {@link stripTs}.
 * Result is cached by mtime in the handler's own `cache` so subsequent
 * requests are instant; a file edit invalidates naturally. `elideOpts`
 * additionally strips side-effect imports of display-only components from
 * the served code, which is exactly why `cache` is the per-handler
 * `state.tsCache` and not a module-global: the cached bytes bake in this
 * handler's elision verdict.
 *
 * @param {string} abs
 * @param {boolean} dev
 * @param {{ moduleGraph: any, elidableComponents: Set<string>|undefined, appDir: string }} [elideOpts]
 * @param {Map<string, { mtimeMs: number, code: string, map: string | null }>} cache the handler's `state.tsCache`
 * @param {boolean} [immutable]  true for a `?v=<hash>` content-addressed request (#243):
 *   serve `immutable` (1 year) instead of the 1h fallback. The cached BODY is
 *   the same bytes regardless; only the cache header varies. Dev stays `no-cache`.
 */
export async function tsResponse(abs, dev, elideOpts, cache, immutable, reportDevError) {
  // The body bytes are identical with or without `?v`; only the cache header
  // changes, so the per-mtime cache stays a single entry.
  const cacheControl = dev ? 'no-cache' : immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
  const st = await stat(abs);
  const cached = cache.get(abs);
  if (cached && cached.mtimeMs === st.mtimeMs) {
    return new Response(cached.code, {
      headers: {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': cacheControl,
        [BUFFERED_MARKER]: '1',
      },
    });
  }
  const source = await readFile(abs, 'utf8');
  let code;
  try {
    code = await stripTs(source, abs);
  } catch (err) {
    // Node's stripTypeScriptTypes throws ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX
    // for enum, namespace with values, parameter properties, legacy
    // decorators with emitDecoratorMetadata, and import = require.
    // Return a clean 500 with the file path and a pointer at the
    // erasable-typescript-only lint rule rather than letting the
    // error bubble up unstyled.
    if (err && err.code === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX') {
      // Log full detail server-side regardless of mode so operators
      // see what went wrong in their logs.
      // eslint-disable-next-line no-console
      console.error(`[webjs] non-erasable TypeScript in ${abs}: ${err.message}`);
      // Dev error overlay (#264): a TS strip failure breaks only the CLIENT
      // module fetch (the page still SSRs, so hydration is silently dead and
      // the hint below is buried in a JS comment). Push a frame so the open tab
      // shows the overlay with the offending file + the no-non-erasable hint.
      reportDevError?.(err, {
        kind: 'ts-strip',
        file: abs,
        hint: 'webjs is buildless: only erasable TypeScript is supported. Replace enum / namespace-with-values / parameter-property / legacy-decorator / import = require with their erasable equivalents. Run `webjs check` (no-non-erasable-typescript rule).',
      });
      const msg = dev
        // Dev: include the file path and Node's error message so the
        // developer's browser tooling can point them at the offending
        // construct. Replace `*` + `/` with `*\\/` so a path or
        // message containing the comment-close sequence cannot
        // terminate the wrapper comment early.
        ? `[webjs] non-erasable TypeScript in ${abs}: ${err.message}\n\n` +
          `webjs is buildless: only erasable TS syntax is supported. ` +
          `Replace enum / namespace / parameter-property / legacy-decorator / ` +
          `import = require constructs with their erasable equivalents. ` +
          `Run \`webjs check\` for guidance (no-non-erasable-typescript rule). ` +
          `Docs: https://webjs.dev/docs/typescript`
        // Prod: terse, no path leak, no Node-message leak (Node's
        // message can include source snippets). Operators get the
        // detail in server logs above.
        : `[webjs] server error transforming a .ts response. Check server logs.`;
      return new Response(`/* ${msg.replace(/\*\//g, '*\\/')} */`, {
        status: 500,
        headers: { 'content-type': 'application/javascript; charset=utf-8' },
      });
    }
    throw err;
  }
  if (elideOpts) {
    code = elideImportsFromSource(
      code, abs, elideOpts.moduleGraph, elideOpts.elidableComponents, resolveImport, elideOpts.appDir,
    );
  }
  // Version same-origin relative import specifiers so the URL the browser
  // fetches matches the `?v=`-versioned modulepreload + boot specifier (#369).
  // A no-op in dev (fingerprinting disabled). Cached with the elision result:
  // PROD files are static within a deploy, so the baked `?v` stays correct.
  code = versionModuleImports(code, abs);
  // Evict oldest entry if cache is full (simple FIFO: Map preserves insertion order).
  if (cache.size >= TS_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(abs, { mtimeMs: st.mtimeMs, code, map: null });
  return new Response(code, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': cacheControl,
      [BUFFERED_MARKER]: '1',
    },
  });
}
