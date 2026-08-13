import { join, resolve, dirname, sep } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { withBasePath } from '../base-path.js';
import { isCompressible, negotiateEncoding, createCompressor, varyWithAcceptEncoding } from '../listener-core.js';

/** @param {import('node:http').IncomingMessage} req @param {URL} url */
export function toWebRequest(req, url) {
  const method = (req.method || 'GET').toUpperCase();
  /** @type {Record<string,string>} */
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    // Drop HTTP/2 pseudo-headers (`:method`, `:path`, `:scheme`, `:authority`).
    // They're parsed separately into req.method / req.url and are rejected
    // by the standard Headers class if we pass them through verbatim.
    if (k.startsWith(':')) continue;
    // Strip any inbound `x-webjs-remote-ip` header so clients cannot
    // spoof the framework-stamped client IP that rate-limit's
    // `clientIp(req, { trustProxy: false })` reads. We rewrite it
    // below from the actual TCP socket. Node's IncomingMessage
    // always lowercases header keys, so a literal compare is enough.
    if (k === 'x-webjs-remote-ip') continue;
    headers[k] = Array.isArray(v) ? v.join(',') : String(v ?? '');
  }
  // Stamp the framework-trusted remote IP from the socket. Read by
  // `clientIp(req)` (rate-limit.js) as the bucket key when
  // `trustProxy: false` (the safe default).
  const remoteIp = req.socket?.remoteAddress;
  if (remoteIp) headers['x-webjs-remote-ip'] = remoteIp;
  let body;
  if (method !== 'GET' && method !== 'HEAD') {
    body = new ReadableStream({
      start(controller) {
        req.on('data', (chunk) => controller.enqueue(chunk));
        req.on('end', () => controller.close());
        req.on('error', (e) => controller.error(e));
      },
    });
  }
  return new Request(url, /** @type any */ ({ method, headers, body, duplex: 'half' }));
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {Response} webRes
 * @param {import('node:http').IncomingMessage} [req]
 * @param {{ compress?: boolean }} [opts]
 */
export async function sendWebResponse(res, webRes, req, opts) {
  /** @type {Record<string,string | string[]>} */
  const headers = {};
  // Preserve multi-value headers (Set-Cookie) via getSetCookie when available.
  if (typeof /** @type any */ (webRes.headers).getSetCookie === 'function') {
    const cookies = /** @type any */ (webRes.headers).getSetCookie();
    if (cookies.length) headers['set-cookie'] = cookies;
  }
  webRes.headers.forEach((v, k) => {
    if (k === 'set-cookie') return;
    headers[k] = v;
  });

  // Negotiate compression via the SHARED seam (listener-core.js), so the node and
  // Bun shells negotiate + compress identically (brotli > gzip > deflate, node:zlib
  // both sides). Skip a body that is already content-encoded (a route.ts returning
  // pre-compressed bytes), and merge into any pre-existing `Vary` rather than
  // clobbering it (`isCompressible` already excludes `text/event-stream`).
  let compressor = null;
  if (opts?.compress && req && webRes.body && !headers['content-encoding'] && isCompressible(headers['content-type'])) {
    const encoding = negotiateEncoding(req.headers['accept-encoding']);
    compressor = createCompressor(encoding);
    if (compressor) {
      headers['content-encoding'] = encoding;
      headers['vary'] = varyWithAcceptEncoding(typeof headers['vary'] === 'string' ? headers['vary'] : '');
      delete headers['content-length'];
    }
  }

  res.writeHead(webRes.status, headers);
  if (!webRes.body) { res.end(); return; }

  if (compressor) {
    compressor.pipe(res);
    const reader = webRes.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        compressor.write(value);
      }
    } finally {
      compressor.end();
    }
    return;
  }

  const reader = webRes.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
}

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.ts': 'application/javascript; charset=utf-8',
  '.mts': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Cache of stripped `.ts` / `.mts` source.
 * Keyed by absolute file path. Entries expire when mtime changes.
 * Capped at 500 entries to prevent unbounded memory growth in
 * long-running production servers.
 *
 * Stripper: `module.stripTypeScriptTypes` (Node 24+ built-in).
 * Position-preserving whitespace replacement. No sourcemap is
 * emitted because every (line, column) maps to itself in the source.
 *
 * Only erasable TypeScript is supported. Non-erasable syntax (`enum`,
 * `namespace` with values, parameter properties, legacy decorators
 * with `emitDecoratorMetadata`, `import = require`) throws at strip
 * time. The `erasable-typescript-only` and `no-non-erasable-typescript`
 * lint rules catch these at edit time. WebJs is buildless end-to-end:
 * there is no bundler fallback.
 *
 * The transformed bytes are cached per request handler in `state.tsCache`
 * (a `Map<string, { mtimeMs, code, map }>`), bounded to `TS_CACHE_MAX`
 * entries. The cache is per-handler rather than module-global because the
 * cached code bakes in that handler's elision verdict, so two handlers for
 * the same app with different elision settings must not share it.
 */
export const TS_CACHE_MAX = 500;

/** PascalCase → kebab-case for a helpful diagnostic example tag name. */
export function kebab(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Per-request correlation id (issue #239). Honor an inbound `X-Request-Id`
 * from a trusted upstream proxy so a trace id propagates across services; mint
 * a fresh `crypto.randomUUID()` otherwise. The inbound value is length-capped
 * and validated against a conservative token charset so a hostile client
 * cannot inject control chars / a header-splitting payload (the value is
 * echoed back in the `X-Request-Id` response header). On any mismatch we fall
 * back to a minted id rather than trust the junk.
 *
 * @param {Request} req
 * @returns {string}
 */
export function resolveRequestId(req) {
  const inbound = req.headers.get('x-request-id');
  if (inbound && inbound.length <= 200 && /^[A-Za-z0-9._-]+$/.test(inbound)) return inbound;
  return crypto.randomUUID();
}

/**
 * Whether a path should be access-logged (issue #239). The framework's own
 * `/__webjs/*` probes, static runtime assets, and the dev SSE reload stream
 * are high-frequency infrastructure traffic, not app requests, so logging them
 * would just spam the access log. App routes (including app-authored
 * `/api/*`) are logged.
 *
 * @param {string} pathname
 * @returns {boolean}
 */
export function shouldAccessLog(pathname) {
  return !pathname.startsWith('/__webjs/');
}

/**
 * Auto-load `<appDir>/.env` into `process.env` once at boot. Mirrors
 * what Rails / Next / Astro do out of the box: a scaffolded app with
 * a committed `.env.example` and a developer-copied `.env` should
 * "just work" without the user having to add a dotenv import or set
 * the file path on the CLI.
 *
 * Uses Node 24+'s built-in `process.loadEnvFile`, which is dotenv-
 * compatible and DOES NOT override pre-existing `process.env` values.
 * Calls that hit a missing file or parse error are silenced; the
 * server should still come up cleanly when there's no `.env`.
 *
 * Idempotent: re-running is a no-op for any env var the user already
 * exported (e.g. via the host shell or a process manager). That
 * keeps the "shell-set wins over file" precedence Rails users
 * expect.
 *
 * Must run before any server-only module is loaded by
 * buildActionIndex, since module-init code in `lib/*.server.ts`
 * (e.g. `createAuth({ secret: process.env.AUTH_SECRET })`) reads
 * process.env at import time. createRequestHandler is the
 * single entry point where this is guaranteed.
 *
 * @param {string} appDir
 */
export function loadAppEnv(appDir) {
  try {
    if (typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(join(appDir, '.env'));
    }
  } catch {
    // No .env file, malformed file, or Node version without
    // loadEnvFile. Either way, fall through silently: the user
    // may not need any env vars, or they may set them via shell.
  }
}

/**
 * Walk the route table + component scanner to collect every file the
 * browser may legitimately fetch as an ES module, then expand via the
 * module graph into the full transitive closure.
 *
 * This is webjs's equivalent of Next.js's bundler-produced page
 * manifest, derived lazily on the first request (and re-derived on every
 * rebuild) instead of at compile time. The dev server's source-file branch uses the returned
 * Set as an authorization gate: in-set → served (subject to the
 * .server.{js,ts} stub guardrail); out-of-set → 404.
 *
 * Browser-bound entries:
 *   - page.{js,ts,mjs,mts}        (re-runs on client for hydration)
 *   - layout.{js,ts,mjs,mts}      (same)
 *   - error.{js,ts,mjs,mts}       (same)
 *   - loading.{js,ts,mjs,mts}     (same)
 *   - not-found.{js,ts,mjs,mts}   (same)
 *   - component files discovered by the scanner (eager + lazy)
 *
 * Server-only entries (NOT in the set):
 *   - route.{js,ts}   (API handlers, never fetched as JS module)
 *   - middleware.{js,ts}
 *   - metadata routes (sitemap.js, robots.js, manifest.js, …)
 *   - .server.{js,ts} files (browser gets a stub, not the source)
 *
 * Components are passed in (rather than rescanned) so the caller can
 * share one scan with `primeComponentRegistry`. Saves a full
 * appDir walk on each analysis (the first request and every rebuild).
 *
 * @param {Awaited<ReturnType<typeof buildRouteTable>>} routeTable
 * @param {Awaited<ReturnType<typeof buildModuleGraph>>} moduleGraph
 * @param {Awaited<ReturnType<typeof scanComponents>>} components
 * @param {string} appDir
 * @returns {Set<string>}
 */
/**
 * Collect every page + layout file across the route table. These are the
 * modules the client boot script imports, and thus the candidates for
 * inert-route elision (dropping a module that does no client work).
 * `route.{js,ts}` / middleware / metadata are excluded: they never ship.
 *
 * @param {Awaited<ReturnType<typeof buildRouteTable>>} routeTable
 * @returns {string[]}
 */
export function collectRouteModules(routeTable) {
  /** @type {Set<string>} */
  const mods = new Set();
  for (const page of routeTable.pages || []) {
    if (page.file) mods.add(page.file);
    for (const f of page.layouts || []) mods.add(f);
  }
  return [...mods];
}

/**
 * List the app's top-level source directory names, for expanding a `#*`
 * catch-all import alias into one browser importmap prefix scope per dir (#555).
 * Excludes infra dirs that are never imported via `#` (node_modules, dotfiles,
 * the build/vendor caches). A new top-level folder is picked up on the next boot
 * (dev restarts on changes), so the alias stays zero-maintenance.
 * @param {string} appDir
 * @returns {string[]}
 */
export function appTopLevelDirs(appDir) {
  const SKIP = new Set(['node_modules', 'dist', 'public']);
  try {
    return readdirSync(appDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Find the absolute directory of the `@webjsdev/core` package, regardless of
 * whether we're running from the monorepo or an installed copy.
 * @param {string} appDir
 */
export function locateCoreDir(appDir) {
  try {
    const require = createRequire(join(appDir, 'package.json'));
    const pkgPath = require.resolve('@webjsdev/core/package.json');
    return dirname(pkgPath);
  } catch {}
  // Workspace fallback when the app dir cannot resolve `@webjsdev/core`.
  // This file lives at `packages/server/src/dev/helpers.js`, one directory
  // deeper than the pre-split `packages/server/src/dev.js`, so the walk up to
  // `packages/` needs FOUR steps, not three. Getting this wrong resolves to
  // `packages/server/core`, which does not exist, and every `/__webjs/core/*`
  // request 404s while the importmap still points at it.
  const here = fileURLToPath(import.meta.url);
  return resolve(here, '..', '..', '..', '..', 'core');
}

/**
 * Find an npm package's installed root folder in the app's node_modules graph.
 * @param {string} appDir
 * @param {string} pkgName
 * @returns {string | null}
 */
export function locatePackageDir(appDir, pkgName) {
  // Many packages lock down `./package.json` in their exports field, so we
  // resolve the bare specifier (always exported) and trim back to the
  // folder named pkgName.
  const match = '/node_modules/' + pkgName + '/';
  const tryFrom = (from) => {
    const require = createRequire(from);
    const entry = require.resolve(pkgName).split(sep).join('/');
    const at = entry.lastIndexOf(match);
    if (at < 0) return null;
    return entry.slice(0, at + match.length - 1).split('/').join(sep);
  };
  try { const d = tryFrom(join(appDir, 'package.json')); if (d) return d; } catch {}
  try { const d = tryFrom(fileURLToPath(import.meta.url)); if (d) return d; } catch {}
  return null;
}

const DEV_OVERLAY_SRC = readFileSync(new URL('../dev-overlay.js', import.meta.url), 'utf8')
  .replace(/^export /gm, '');

const RELOAD_WORKER_SRC = readFileSync(new URL('../dev-reload-worker.js', import.meta.url), 'utf8')
  .replace(/^export /gm, '');

/**
 * The dev live-reload client. The `EventSource` URL is a framework-emitted
 * same-origin path, so it must carry the base path under a sub-path deploy
 * (#256), like the importmap targets and the RPC stub. No-op when basePath
 * is empty.
 * @param {string} bp the normalized base path (`''` = no-op)
 * @returns {string}
 */
export function reloadClientJs(bp) {
  // The overlay renderer uses textContent throughout (never innerHTML), so the
  // error message / code frame can never inject markup (#264). Served only in
  // dev (the /__webjs/reload.js branch 404s in prod), so it never reaches a
  // production page.
  //
  // Every tab shares ONE live-reload connection through a SharedWorker (#887).
  // The old client opened an `EventSource` per tab, and because the dev server
  // is HTTP/1.1 and browsers cap concurrent connections per host at ~6, a
  // handful of open tabs would hold every connection slot with idle SSE streams
  // and later tabs could not even fetch their HTML. The SharedWorker holds the
  // single `EventSource` (see reloadWorkerJs) and relays each `reload` /
  // `webjs-error` to every tab. The overlay still renders on the main thread
  // (a worker has no DOM), so the worker forwards only the raw frame data.
  //
  // Fallback: where `SharedWorker` is missing (some mobile browsers) or its
  // construction throws (a strict dev CSP without `worker-src`), each tab opens
  // its own `EventSource`, the original behaviour. Correct, just not shared.
  const eventsUrl = JSON.stringify(withBasePath('/__webjs/events', bp));
  const workerUrl = JSON.stringify(withBasePath('/__webjs/reload-worker.js', bp));
  const versionUrl = JSON.stringify(withBasePath('/__webjs/version', bp));
  return `// webjs dev reload client
${DEV_OVERLAY_SRC}
${RELOAD_WORKER_SRC}
function __webjsApplyError(data) {
  let f; try { f = JSON.parse(data); } catch (_) { return; }
  renderDevOverlay(f);
}
// Keep the overlay tracking the page actually on screen (#1047): a render frame
// is scoped to the URL that produced it, so navigating away takes it down, and a
// frame that arrived before the URL advanced goes up once it does. The gate
// itself lives inside renderDevOverlay, so __webjsApplyError needs no change.
installDevOverlayNavSync();
// Never reload INTO a server that is still restarting (Node's node --watch
// briefly kills the process on an edit), which would paint a style-less,
// half-rendered page (#893). Probe the lightweight /__webjs/version endpoint
// until it answers, THEN reload. Under an in-process reload the server is up,
// so the first probe passes and the reload is instant; under a restart the
// probes fail until the fresh server is listening, so the old page stays put
// until the new one is ready. Bounded, so a genuinely-dead server still
// reloads (and shows the browser's own error) rather than hanging forever.
function __webjsReloadWhenReady() {
  var tries = 0;
  function attempt() {
    fetch(${versionUrl}, { cache: 'no-store' }).then(function (r) {
      if (r && r.ok) location.reload(); else again();
    }).catch(again);
  }
  function again() { if (++tries > 100) location.reload(); else setTimeout(attempt, 100); }
  attempt();
}
function __webjsDirectEvents() {
  // No SharedWorker (Chrome for Android has none) or its construction threw (a
  // strict dev CSP with no worker-src). Run the SAME relay here in the tab over
  // a shim port instead of a second copy of the boot-id rule (#887, #893) and
  // the reload debounce (#1397). The shim scope has no setTimeout, so the relay
  // picks up the tab's own timers.
  const scope = {};
  startReloadWorker(scope, EventSource, ${eventsUrl});
  scope.onconnect({ ports: [{ start() {}, postMessage(m) {
    // Nothing may throw out of here, and nothing may be silently dropped.
    //
    // The relay's fanout deletes a port whose postMessage throws, which is the
    // right read for a REAL MessagePort (a throw there means the tab is gone)
    // and the wrong one for this shim, whose postMessage runs application code
    // synchronously: an overlay render that threw would permanently
    // unsubscribe this tab and silently kill live reload for the rest of the
    // page's life. So the throw is contained here.
    //
    // Contained, NOT swallowed, and the difference matters. The old fallback
    // attached to the EventSource directly, where a handler throw detached
    // nothing but still reached the console, and so does a throw out of the
    // SharedWorker path's onmessage below. Only the DETACHMENT is being
    // prevented; discarding the error would make this the one path where a
    // dev-overlay bug leaves no trace, which would be a new behaviour rather
    // than a restored one.
    try {
      if (m.type === 'reload') __webjsReloadWhenReady();
      else if (m.type === 'webjs-error') __webjsApplyError(m.data);
    } catch (_) {
      console.error('[webjs] dev reload handler threw', _);
    }
  } }] });
}
try {
  if (typeof SharedWorker !== 'undefined') {
    const w = new SharedWorker(${workerUrl});
    w.port.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'reload') __webjsReloadWhenReady();
      else if (m.type === 'webjs-error') __webjsApplyError(m.data);
    };
    w.port.start();
  } else {
    __webjsDirectEvents();
  }
} catch (_) {
  __webjsDirectEvents();
}
`;
}

/**
 * The dev live-reload SharedWorker. One instance is shared across every tab of
 * the same origin (a SharedWorker is keyed by its script URL), so it holds the
 * ONE `EventSource` to `/__webjs/events` and fans each event out to all tabs
 * over their `MessagePort`s (#887). The `EventSource` URL carries the base path
 * the same way the client's does (#256). Served only in dev.
 * @param {string} bp the normalized base path (`''` = no-op)
 * @returns {string}
 */
export function reloadWorkerJs(bp) {
  return `// webjs dev reload worker (one shared connection for all tabs)
${RELOAD_WORKER_SRC}
startReloadWorker(self, EventSource, ${JSON.stringify(withBasePath('/__webjs/events', bp))});
`;
}

/**
 * Whether a path exists, as a boolean rather than a throw.
 *
 * @param {string} p
 * @returns {Promise<boolean>}
 */
export async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}
