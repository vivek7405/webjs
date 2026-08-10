import { join, resolve, dirname, relative, sep } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { withBasePath } from '../base-path.js';
import { reachableFromEntries } from '../module-graph.js';
import { isCompressible, negotiateEncoding, createCompressor, varyWithAcceptEncoding } from '../listener-core.js';

export function toWebRequest(req, url) {
  const method = (req.method || 'GET').toUpperCase();
  /** @type {Record<string,string>} */
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (k.startsWith(':')) continue;
    if (k === 'x-webjs-remote-ip') continue;
    headers[k] = Array.isArray(v) ? v.join(',') : String(v ?? '');
  }
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

export async function sendWebResponse(res, webRes, req, opts) {
  /** @type {Record<string,string | string[]>} */
  const headers = {};
  if (typeof /** @type any */ (webRes.headers).getSetCookie === 'function') {
    const cookies = /** @type any */ (webRes.headers).getSetCookie();
    if (cookies.length) headers['set-cookie'] = cookies;
  }
  webRes.headers.forEach((v, k) => {
    if (k === 'set-cookie') return;
    headers[k] = v;
  });

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

export const TS_CACHE_MAX = 500;

export function kebab(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

export function resolveRequestId(req) {
  const inbound = req.headers.get('x-request-id');
  if (inbound && inbound.length <= 200 && /^[A-Za-z0-9._-]+$/.test(inbound)) return inbound;
  return crypto.randomUUID();
}

export function shouldAccessLog(pathname) {
  return !pathname.startsWith('/__webjs/');
}

export function loadAppEnv(appDir) {
  try {
    if (typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(join(appDir, '.env'));
    }
  } catch {
    // Silently fall through
  }
}

export function collectRouteModules(routeTable) {
  /** @type {Set<string>} */
  const mods = new Set();
  for (const page of routeTable.pages || []) {
    if (page.file) mods.add(page.file);
    for (const f of page.layouts || []) mods.add(f);
  }
  return [...mods];
}

export function computeBrowserBoundFiles(routeTable, moduleGraph, components, appDir) {
  /** @type {Set<string>} */
  const entries = new Set();
  for (const page of routeTable.pages) {
    if (page.file) entries.add(page.file);
    for (const f of page.layouts || []) entries.add(f);
    for (const f of page.errors || []) entries.add(f);
    for (const f of page.loadings || []) entries.add(f);
    for (const f of page.forbiddens || []) entries.add(f);
    for (const f of page.unauthorizeds || []) entries.add(f);
  }
  if (routeTable.notFound) entries.add(routeTable.notFound);
  if (routeTable.notFounds) {
    for (const f of routeTable.notFounds.values()) entries.add(f);
  }
  if (routeTable.globalError) entries.add(routeTable.globalError);
  if (routeTable.globalNotFound) entries.add(routeTable.globalNotFound);
  if (routeTable.instrumentationClient) entries.add(routeTable.instrumentationClient);
  for (const c of components) entries.add(c.file);
  return reachableFromEntries(moduleGraph, [...entries], appDir);
}

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

export function locatePackageDir(appDir, pkgName) {
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

export function reloadClientJs(bp) {
  const eventsUrl = JSON.stringify(withBasePath('/__webjs/events', bp));
  const workerUrl = JSON.stringify(withBasePath('/__webjs/reload-worker.js', bp));
  const versionUrl = JSON.stringify(withBasePath('/__webjs/version', bp));
  return `// webjs dev reload client
${DEV_OVERLAY_SRC}
function __webjsApplyError(data) {
  let f; try { f = JSON.parse(data); } catch (_) { return; }
  renderDevOverlay(f);
}
installDevOverlayNavSync();
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
  var lastBoot = null;
  const es = new EventSource(${eventsUrl});
  es.addEventListener('hello', (e) => {
    if (lastBoot !== null && e.data !== lastBoot) __webjsReloadWhenReady();
    lastBoot = e.data;
  });
  es.addEventListener('reload', () => __webjsReloadWhenReady());
  es.addEventListener('webjs-error', (e) => __webjsApplyError(e.data));
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

export function reloadWorkerJs(bp) {
  return `// webjs dev reload worker (one shared connection for all tabs)
${RELOAD_WORKER_SRC}
startReloadWorker(self, EventSource, ${JSON.stringify(withBasePath('/__webjs/events', bp))});
`;
}
