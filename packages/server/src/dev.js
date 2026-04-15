import { createServer as createHttp1Server } from 'node:http';
import { createSecureServer as createHttp2SecureServer } from 'node:http2';
import { stat, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createGzip, createBrotliCompress, constants as zlibConstants } from 'node:zlib';
import { join, extname, resolve, dirname, relative, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildRouteTable, matchPage, matchApi } from './router.js';
import { ssrPage, ssrNotFound } from './ssr.js';
import { handleApi } from './api.js';
import {
  buildActionIndex,
  resolveServerModule,
  serveActionStub,
  invokeAction,
  matchExposedAction,
  matchAllAtPath,
  invokeExposedAction,
  buildPreflightResponse,
  withCors,
} from './actions.js';
import { defaultLogger } from './logger.js';
import { withRequest } from './context.js';
import { attachWebSocket } from './websocket.js';

const MIME = {
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
 * Cache of esbuild-transformed `.ts` / `.mts` source.
 * Keyed by absolute file path; entries expire when mtime changes.
 * @type {Map<string, { mtimeMs: number, code: string, map: string | null }>}
 */
const TS_CACHE = new Map();

/**
 * Create a reusable, framework-agnostic request handler for a webjs app.
 * The returned `handle(req)` takes a standard `Request` and resolves to a
 * standard `Response` — suitable for Node http, Deno, Bun, Cloudflare Workers,
 * or embedding inside an Express/Fastify app.
 *
 * @param {{
 *   appDir: string,
 *   dev?: boolean,
 *   logger?: import('./logger.js').Logger,
 *   onReload?: () => void,
 * }} opts
 */
export async function createRequestHandler(opts) {
  const appDir = resolve(opts.appDir);
  const dev = !!opts.dev;
  const logger = opts.logger || defaultLogger({ dev });
  const coreDir = locateCoreDir(appDir);

  const state = {
    routeTable: await buildRouteTable(appDir),
    actionIndex: await buildActionIndex(appDir, dev),
    middleware: await loadMiddleware(appDir, dev, logger),
    bundlePath: !dev && (await exists(join(appDir, '.webjs/bundle.js')))
      ? join(appDir, '.webjs/bundle.js')
      : null,
    logger,
  };

  async function rebuild() {
    state.routeTable = await buildRouteTable(appDir);
    state.actionIndex = await buildActionIndex(appDir, dev);
    state.middleware = await loadMiddleware(appDir, dev, logger);
    opts.onReload?.();
  }

  /** @param {Request} req */
  function handle(req) {
    return withRequest(req, async () => {
      const next = () => handleCore(req, { state, appDir, coreDir, dev });
      if (state.middleware) {
        try {
          return await state.middleware(req, next);
        } catch (e) {
          logger.error('middleware threw', { err: String(e) });
          return new Response('Server error', { status: 500 });
        }
      }
      return next();
    });
  }

  /**
   * Lightweight lookup used by the HTTP layer to emit 103 Early Hints
   * BEFORE running SSR: resolves a pathname to its page-route module URLs
   * without loading them. Returns null for non-page paths.
   *
   * @param {string} pathname
   */
  function routeFor(pathname) {
    const page = matchPage(state.routeTable, pathname);
    if (!page) return null;
    const moduleUrls = state.bundlePath
      ? ['/__webjs/bundle.js']
      : [page.route.file, ...page.route.layouts].map((f) => {
          let rel = f.startsWith(appDir) ? f.slice(appDir.length) : f;
          return rel.split('\\').join('/').replace(/^\/?/, '/');
        });
    return { moduleUrls };
  }

  return {
    handle,
    rebuild,
    routeFor,
    /** current route table getter — used by the WebSocket subsystem */
    getRouteTable: () => state.routeTable,
    appDir,
    dev,
    logger,
  };
}

/**
 * Start a webjs HTTP server. Thin wrapper around `createRequestHandler`.
 *
 * @param {{
 *   appDir: string,
 *   port?: number,
 *   dev?: boolean,
 *   compress?: boolean,
 *   http2?: boolean,
 *   cert?: string,   // absolute path to PEM cert — required with http2
 *   key?: string,    // absolute path to PEM private key — required with http2
 *   logger?: import('./logger.js').Logger,
 * }} opts
 */
export async function startServer(opts) {
  const dev = !!opts.dev;
  const port = opts.port ?? 3000;
  // Compression default: on in prod, off in dev (cheaper to debug raw bytes).
  const compress = opts.compress ?? !dev;
  const logger = opts.logger || defaultLogger({ dev });

  /** @type {Set<import('node:http').ServerResponse>} */
  const sseClients = new Set();
  const app = await createRequestHandler({
    ...opts,
    logger,
    onReload: () => {
      for (const res of sseClients) {
        try { res.write(`event: reload\ndata: now\n\n`); } catch {}
      }
    },
  });

  if (dev) {
    const { watch } = await import('chokidar').catch(() => ({ watch: null }));
    if (watch) {
      const watcher = watch(app.appDir, {
        ignored: [/node_modules/, /\.git/, /prisma\/(dev|migrations)/],
        ignoreInitial: true,
      });
      const rebuild = debounce(() => app.rebuild(), 80);
      watcher.on('all', rebuild);
    }
  }

  // SSE keepalive: send a comment frame every 25s to defeat proxy idle timeouts.
  // Cheap (no event listeners on the client side) and safe — comments are ignored.
  const keepalive = setInterval(() => {
    for (const res of sseClients) {
      try { res.write(`: ka\n\n`); } catch {}
    }
  }, 25_000);
  keepalive.unref();

  const server = await makeHttpServer(opts, logger, async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

      // SSE — handled specially; doesn't fit the req→Response model.
      if (url.pathname === '/__webjs/events') {
        if (!dev) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        res.write(`event: hello\ndata: webjs\n\n`);
        sseClients.add(res);
        res.socket?.on('close', () => sseClients.delete(res));
        return;
      }

      // 103 Early Hints: before running SSR, send preload hints for the
      // page's module URLs so the browser can begin fetching them while
      // the server is still computing the body. Skipped in dev (file churn
      // would send stale URLs after rebuilds) and for non-GET/HEAD.
      if (
        !dev &&
        (req.method === 'GET' || req.method === 'HEAD') &&
        typeof res.writeEarlyHints === 'function'
      ) {
        const match = app.routeFor(url.pathname);
        if (match && match.moduleUrls.length) {
          try {
            res.writeEarlyHints({
              link: match.moduleUrls.map((u) => `<${u}>; rel=modulepreload`),
            });
          } catch (e) {
            logger.warn('writeEarlyHints failed', { err: String(e) });
          }
        }
      }

      const webReq = toWebRequest(req, url);
      const resp = await app.handle(webReq);
      await sendWebResponse(res, resp, req, { compress });
    } catch (e) {
      logger.error('request pipeline threw', { err: e instanceof Error ? e.stack : String(e) });
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(dev && e instanceof Error ? `webjs error: ${e.stack}` : 'Internal server error');
    }
  });

  // WebSocket upgrade handling: any route.js that exports `WS` becomes a
  // WebSocket endpoint at its URL.
  attachWebSocket(server, () => app.getRouteTable(), { dev, logger });

  const scheme = opts.http2 && opts.cert && opts.key ? 'https' : 'http';
  server.listen(port, () => {
    logger.info(
      `webjs ${dev ? 'dev' : 'prod'} server ready on ${scheme}://localhost:${port}` +
      (scheme === 'https' ? ' (HTTP/2)' : '')
    );
  });

  const shutdown = gracefulShutdown(server, sseClients, logger);
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  // Catch-all process handlers — log, but don't tear the process down on a
  // single mishandled promise. Uncaught exceptions are different: state may be
  // corrupted, so log + start an orderly shutdown rather than continuing.
  installProcessHandlers(logger, () => shutdown('uncaughtException'));

  return { server, close: () => new Promise((r) => server.close(() => r())) };
}

/**
 * The core request → response pipeline, minus middleware.
 * @param {Request} req
 * @param {{state: any, appDir: string, coreDir: string, dev: boolean}} ctx
 */
async function handleCore(req, ctx) {
  const { state, appDir, coreDir, dev } = ctx;
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method.toUpperCase();

  // Health / readiness probes for orchestrators (k8s, fly, etc.)
  if (path === '/__webjs/health' || path === '/__webjs/ready') {
    return Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
  }

  // Dev live-reload client
  if (path === '/__webjs/reload.js') {
    if (!dev) return new Response('Not found', { status: 404 });
    return new Response(RELOAD_CLIENT_JS, {
      headers: { 'content-type': 'application/javascript; charset=utf-8' },
    });
  }

  // Core module: /__webjs/core/*
  if (path.startsWith('/__webjs/core/')) {
    const rel = path.slice('/__webjs/core/'.length);
    const abs = resolve(coreDir, rel);
    if (!abs.startsWith(coreDir)) return new Response('forbidden', { status: 403 });
    return fileResponse(abs, { dev, immutable: !dev });
  }

  // Vendored packages (only superjson in v1) — served from node_modules so
  // browsers can resolve bare specifiers in the import map.
  if (path.startsWith('/__webjs/vendor/superjson/')) {
    const rel = path.slice('/__webjs/vendor/superjson/'.length);
    const root = locatePackageDir(appDir, 'superjson');
    if (!root) return new Response('superjson not installed', { status: 404 });
    const abs = resolve(root, rel);
    if (!abs.startsWith(root)) return new Response('forbidden', { status: 403 });
    return fileResponse(abs, { dev, immutable: !dev });
  }

  // Prod bundle (if present)
  if (state.bundlePath && (path === '/__webjs/bundle.js' || path === '/__webjs/bundle.js.map')) {
    const abs = path.endsWith('.map') ? state.bundlePath + '.map' : state.bundlePath;
    return fileResponse(abs, { dev: false, immutable: true });
  }

  // Internal server-action RPC endpoint
  const actMatch = /^\/__webjs\/action\/([a-f0-9]+)\/([A-Za-z0-9_$]+)$/.exec(path);
  if (actMatch) {
    if (method !== 'POST') return new Response('POST only', { status: 405 });
    return invokeAction(state.actionIndex, actMatch[1], actMatch[2], req);
  }

  // expose()d server actions (first-class REST), with optional CORS support.
  if (method === 'OPTIONS') {
    const allAtPath = matchAllAtPath(state.actionIndex, path);
    if (allAtPath.length) {
      const corsRoute = allAtPath.find((r) => r.cors);
      const methods = [...new Set(allAtPath.map((r) => r.method))];
      if (corsRoute) {
        // Preflight: respond with cors headers + the union of methods at this path.
        const preflight = buildPreflightResponse(corsRoute, req);
        const newHeaders = new Headers(preflight.headers);
        newHeaders.set('access-control-allow-methods', `${methods.join(', ')}, OPTIONS`);
        return new Response(null, { status: preflight.status, headers: newHeaders });
      }
      return new Response(null, { status: 204, headers: { allow: `${methods.join(', ')}, OPTIONS` } });
    }
  } else {
    const exposed = matchExposedAction(state.actionIndex, method, path);
    if (exposed) {
      const resp = await invokeExposedAction(state.actionIndex, exposed.route, exposed.params, req);
      return withCors(resp, exposed.route, req);
    }
  }

  // Static: /public/*
  if (path.startsWith('/public/') || path === '/favicon.ico') {
    const p = path === '/favicon.ico' ? '/public/favicon.ico' : path;
    const abs = join(appDir, p);
    if (await exists(abs)) return fileResponse(abs, { dev, immutable: false });
  }

  // User source modules (served as ES modules, with action-file rewriting)
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
    if (abs.startsWith(appDir) && (await exists(abs))) {
      const serverFile = resolveServerModule(state.actionIndex, path) ||
        // Also recognise stub requests for the .ts form.
        (abs !== join(appDir, path) ? resolveServerModule(state.actionIndex, '/' + relative(appDir, abs).split(sep).join('/')) : null);
      if (serverFile) {
        const stub = await serveActionStub(state.actionIndex, serverFile);
        return new Response(stub, {
          headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' },
        });
      }
      // TypeScript source: esbuild-strip types, cache by mtime.
      if (/\.m?ts$/.test(abs)) {
        return tsResponse(abs, dev);
      }
      return fileResponse(abs, { dev, immutable: false });
    }
  }

  // API route (route.js handler)
  const api = matchApi(state.routeTable, path);
  if (api) {
    const handler = () => handleApi(api.route, api.params, req, dev);
    return runWithSegmentMiddleware(req, api.route.middlewares, handler, dev);
  }

  // Page route (only for GET/HEAD)
  if (method === 'GET' || method === 'HEAD') {
    const page = matchPage(state.routeTable, path);
    if (page) {
      const handler = () => ssrPage(page.route, page.params, url, {
        dev, appDir, req, bundle: !!state.bundlePath,
      });
      return runWithSegmentMiddleware(req, page.route.middlewares, handler, dev);
    }
  }

  // Fallback — content-negotiated 404
  if (wantsJson(req, path)) {
    return Response.json({ error: 'Not found', path }, { status: 404 });
  }
  return ssrNotFound(state.routeTable.notFound, { dev, appDir, req, url });
}

/** @param {Request} req @param {string} path */
function wantsJson(req, path) {
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
async function runWithSegmentMiddleware(req, files, terminal, dev) {
  if (!files || !files.length) return terminal();
  const handlers = [];
  for (const f of files) {
    try {
      const url = pathToFileURL(f).toString();
      const bust = dev ? `?t=${Date.now()}-${Math.random().toString(36).slice(2)}` : '';
      const mod = await import(url + bust);
      if (typeof mod.default === 'function') handlers.push(mod.default);
    } catch {
      // Bad middleware file — skip; top-level error handler will catch real problems.
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
 * Load the optional top-level `middleware.js`.
 * @param {string} appDir
 * @param {boolean} dev
 * @param {import('./logger.js').Logger} logger
 */
async function loadMiddleware(appDir, dev, logger) {
  const file = join(appDir, 'middleware.js');
  if (!(await exists(file))) return null;
  const url = pathToFileURL(file).toString();
  const bust = dev ? `?t=${Date.now()}-${Math.random().toString(36).slice(2)}` : '';
  try {
    const mod = await import(url + bust);
    return typeof mod.default === 'function' ? mod.default : null;
  } catch (e) {
    logger.error('failed to load middleware.js', { err: String(e) });
    return null;
  }
}

/**
 * Install signal handlers that stop accepting new connections, close SSE
 * clients, and exit once in-flight requests drain.
 * @param {import('node:http').Server} server
 * @param {Set<import('node:http').ServerResponse>} sseClients
 * @param {import('./logger.js').Logger} logger
 */
/**
 * Create an HTTP server — h2 over TLS if cert/key are provided and
 * `http2` is enabled, else plain HTTP/1.1 over TCP. h2 servers set
 * `allowHTTP1: true` so clients that can't negotiate ALPN fall back
 * cleanly.
 *
 * @param {{ http2?: boolean, cert?: string, key?: string }} opts
 * @param {import('./logger.js').Logger} logger
 * @param {(req: any, res: any) => void} handler
 */
async function makeHttpServer(opts, logger, handler) {
  if (opts.http2 && opts.cert && opts.key) {
    try {
      const [cert, key] = await Promise.all([readFile(opts.cert), readFile(opts.key)]);
      return createHttp2SecureServer({ cert, key, allowHTTP1: true }, handler);
    } catch (e) {
      logger.error('failed to load cert/key for HTTP/2', { err: String(e) });
      logger.warn('falling back to HTTP/1.1 plain');
    }
  } else if (opts.http2) {
    logger.warn('--http2 requested but --cert/--key not both provided; serving HTTP/1.1');
  }
  return createHttp1Server(handler);
}

/**
 * Install once-only process error handlers. Idempotent across multiple
 * `startServer` calls in the same process.
 *
 * @param {import('./logger.js').Logger} logger
 * @param {() => void} onFatal
 */
function installProcessHandlers(logger, onFatal) {
  if (/** @type any */ (globalThis).__webjsProcHandlers) return;
  /** @type any */ (globalThis).__webjsProcHandlers = true;
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', {
      err: reason instanceof Error ? reason.stack || reason.message : String(reason),
    });
  });
  process.on('uncaughtException', (err) => {
    logger.error('uncaughtException', { err: err.stack || err.message });
    // Begin orderly shutdown; process state may be corrupt.
    try { onFatal(); } catch {}
  });
}

function gracefulShutdown(server, sseClients, logger) {
  let shuttingDown = false;
  return (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`received ${signal}, shutting down`);
    for (const res of sseClients) {
      try { res.end(); } catch {}
    }
    sseClients.clear();
    server.close((err) => {
      if (err) {
        logger.error('server close error', { err: String(err) });
        process.exit(1);
      }
      logger.info('bye');
      process.exit(0);
    });
    // Hard-fail after 10s if we can't drain.
    setTimeout(() => {
      logger.warn('shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000).unref();
  };
}

/* ------------ helpers ------------ */

/** @param {import('node:http').IncomingMessage} req @param {URL} url */
function toWebRequest(req, url) {
  const method = (req.method || 'GET').toUpperCase();
  /** @type {Record<string,string>} */
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    // Drop HTTP/2 pseudo-headers (`:method`, `:path`, `:scheme`, `:authority`) —
    // they're parsed separately into req.method / req.url and are rejected
    // by the standard Headers class if we pass them through verbatim.
    if (k.startsWith(':')) continue;
    headers[k] = Array.isArray(v) ? v.join(',') : String(v ?? '');
  }
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
async function sendWebResponse(res, webRes, req, opts) {
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

  // Negotiate compression.
  let compressor = null;
  if (opts?.compress && req && webRes.body && isCompressible(headers['content-type'])) {
    const accept = String(req.headers['accept-encoding'] || '');
    if (/(?:^|,\s*)br(?:;|,|$)/.test(accept)) {
      compressor = createBrotliCompress({
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 },
      });
      headers['content-encoding'] = 'br';
    } else if (/(?:^|,\s*)gzip(?:;|,|$)/.test(accept)) {
      compressor = createGzip({ level: 6 });
      headers['content-encoding'] = 'gzip';
    }
    if (compressor) {
      headers['vary'] = 'Accept-Encoding';
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

/** @param {string | string[] | undefined} contentType */
function isCompressible(contentType) {
  if (!contentType) return false;
  const ct = Array.isArray(contentType) ? contentType[0] : contentType;
  return /^(?:text\/|application\/(?:javascript|json|xml|wasm|manifest)|image\/svg\+xml)/i.test(ct);
}

/**
 * Read a file and return a Response with appropriate caching.
 * Dev: no-cache (always revalidate).
 * Prod: ETag + ~1h max-age for user files; `immutable` bumps to 1 year.
 *
 * @param {string} abs
 * @param {{ dev: boolean, immutable: boolean }} opts
 */
async function fileResponse(abs, opts) {
  try {
    const data = await readFile(abs);
    const type = MIME[extname(abs).toLowerCase()] || 'application/octet-stream';
    const headers = { 'content-type': type };
    if (opts.dev) {
      headers['cache-control'] = 'no-cache';
    } else {
      const etag = `"${createHash('sha1').update(data).digest('hex').slice(0, 16)}"`;
      headers['etag'] = etag;
      headers['cache-control'] = opts.immutable
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600';
    }
    return new Response(data, { status: 200, headers });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

/**
 * Serve a `.ts` / `.mts` source file as JavaScript. Types are stripped via
 * esbuild's transform() (microseconds per file). Result is cached by mtime
 * so subsequent requests are instant; a file edit invalidates naturally.
 *
 * @param {string} abs
 * @param {boolean} dev
 */
async function tsResponse(abs, dev) {
  let esbuild;
  try { ({ transform: esbuild } = await import('esbuild')); }
  catch {
    return new Response(
      '/* esbuild missing — run `npm i -D esbuild` to enable TypeScript sources */',
      { status: 500, headers: { 'content-type': 'application/javascript; charset=utf-8' } }
    );
  }
  const st = await stat(abs);
  const cached = TS_CACHE.get(abs);
  if (cached && cached.mtimeMs === st.mtimeMs) {
    return new Response(cached.code, {
      headers: {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': dev ? 'no-cache' : 'public, max-age=3600',
      },
    });
  }
  const source = await readFile(abs, 'utf8');
  const result = await esbuild(source, {
    loader: abs.endsWith('.mts') ? 'ts' : 'ts',
    format: 'esm',
    target: 'es2022',
    sourcemap: 'inline',
    sourcefile: abs,
  });
  TS_CACHE.set(abs, { mtimeMs: st.mtimeMs, code: result.code, map: null });
  return new Response(result.code, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': dev ? 'no-cache' : 'public, max-age=3600',
    },
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Find the absolute directory of the `webjs` core package, regardless of
 * whether we're running from the monorepo or an installed copy.
 * @param {string} appDir
 */
function locateCoreDir(appDir) {
  try {
    const require = createRequire(join(appDir, 'package.json'));
    const pkgPath = require.resolve('webjs/package.json');
    return dirname(pkgPath);
  } catch {}
  const here = fileURLToPath(import.meta.url);
  return resolve(here, '..', '..', '..', 'core');
}

/**
 * Find an npm package's installed root folder in the app's node_modules graph.
 * @param {string} appDir
 * @param {string} pkgName
 * @returns {string | null}
 */
function locatePackageDir(appDir, pkgName) {
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

const RELOAD_CLIENT_JS = `// webjs dev reload client
const es = new EventSource('/__webjs/events');
es.addEventListener('reload', () => location.reload());
`;
