import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { join, extname, resolve, dirname } from 'node:path';
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
  invokeExposedAction,
} from './actions.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
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
 * Create a reusable, framework-agnostic request handler for a webjs app.
 * The returned `handle(req)` takes a standard `Request` and resolves to a
 * standard `Response` — suitable for Node http, Deno, Bun, Cloudflare Workers,
 * or embedding inside an Express/Fastify app.
 *
 * @param {{ appDir: string, dev?: boolean, onReload?: () => void }} opts
 */
export async function createRequestHandler(opts) {
  const appDir = resolve(opts.appDir);
  const dev = !!opts.dev;
  const coreDir = locateCoreDir(appDir);

  const state = {
    routeTable: await buildRouteTable(appDir),
    actionIndex: await buildActionIndex(appDir, dev),
    middleware: await loadMiddleware(appDir, dev),
  };

  async function rebuild() {
    state.routeTable = await buildRouteTable(appDir);
    state.actionIndex = await buildActionIndex(appDir, dev);
    state.middleware = await loadMiddleware(appDir, dev);
    opts.onReload?.();
  }

  /** @param {Request} req */
  async function handle(req) {
    const next = () => handleCore(req, { state, appDir, coreDir, dev });
    if (state.middleware) {
      try {
        return await state.middleware(req, next);
      } catch (e) {
        console.error('[webjs] middleware threw:', e);
        return new Response('Server error', { status: 500 });
      }
    }
    return next();
  }

  return { handle, rebuild, appDir, dev };
}

/**
 * Start a webjs HTTP server. Thin wrapper around `createRequestHandler`.
 *
 * @param {{ appDir: string, port?: number, dev?: boolean }} opts
 */
export async function startServer(opts) {
  const dev = !!opts.dev;
  const port = opts.port ?? 3000;

  /** @type {Set<import('node:http').ServerResponse>} */
  const sseClients = new Set();
  const app = await createRequestHandler({
    ...opts,
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

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      // SSE channel — handled specially; doesn't fit the req→Response model.
      if (url.pathname === '/__webjs/events') {
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
      const webReq = toWebRequest(req, url);
      const resp = await app.handle(webReq);
      await sendWebResponse(res, resp);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(`webjs error: ${e instanceof Error ? e.stack || e.message : String(e)}`);
    }
  });

  server.listen(port, () => {
    console.log(`▲ webjs ${dev ? 'dev' : 'prod'} server ready on http://localhost:${port}`);
  });

  return { server, close: () => server.close() };
}

/**
 * The core request → response pipeline, minus middleware.
 * @param {Request} req
 * @param {{state: {routeTable: any, actionIndex: any, middleware: any}, appDir: string, coreDir: string, dev: boolean}} ctx
 */
async function handleCore(req, ctx) {
  const { state, appDir, coreDir, dev } = ctx;
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method.toUpperCase();

  // 1. Dev live-reload client
  if (path === '/__webjs/reload.js') {
    return new Response(RELOAD_CLIENT_JS, {
      headers: { 'content-type': 'application/javascript; charset=utf-8' },
    });
  }

  // 2. Core module: /__webjs/core/*
  if (path.startsWith('/__webjs/core/')) {
    const rel = path.slice('/__webjs/core/'.length);
    const abs = resolve(coreDir, rel);
    if (!abs.startsWith(coreDir)) return new Response('forbidden', { status: 403 });
    return fileResponse(abs);
  }

  // 3. Internal server-action RPC endpoint
  const actMatch = /^\/__webjs\/action\/([a-f0-9]+)\/([A-Za-z0-9_$]+)$/.exec(path);
  if (actMatch) {
    if (method !== 'POST') return new Response('POST only', { status: 405 });
    return invokeAction(state.actionIndex, actMatch[1], actMatch[2], req);
  }

  // 4. expose()d server actions (first-class REST endpoints)
  const exposed = matchExposedAction(state.actionIndex, method, path);
  if (exposed) {
    return invokeExposedAction(state.actionIndex, exposed.route, exposed.params, req);
  }

  // 5. Static: /public/*
  if (path.startsWith('/public/') || path === '/favicon.ico') {
    const p = path === '/favicon.ico' ? '/public/favicon.ico' : path;
    const abs = join(appDir, p);
    if (await exists(abs)) return fileResponse(abs);
  }

  // 6. User source modules (served as ES modules, with action-file rewriting)
  if (method === 'GET' && /\.(js|mjs|css|svg|png|jpg|jpeg|gif|webp|json|ico|txt)$/.test(path)) {
    const abs = join(appDir, path);
    if (abs.startsWith(appDir) && (await exists(abs))) {
      const serverFile = resolveServerModule(state.actionIndex, path);
      if (serverFile) {
        const stub = await serveActionStub(state.actionIndex, serverFile);
        return new Response(stub, {
          headers: { 'content-type': 'application/javascript; charset=utf-8' },
        });
      }
      return fileResponse(abs);
    }
  }

  // 7. API route (route.js handler)
  const api = matchApi(state.routeTable, path);
  if (api) return handleApi(api.route, api.params, req, dev);

  // 8. Page route (only for GET/HEAD)
  if (method === 'GET' || method === 'HEAD') {
    const page = matchPage(state.routeTable, path);
    if (page) return ssrPage(page.route, page.params, url, { dev, appDir });
  }

  // 9. Fallback — content-negotiated 404
  if (wantsJson(req, path)) {
    return Response.json({ error: 'Not found', path }, { status: 404 });
  }
  return ssrNotFound(state.routeTable.notFound, { dev, appDir });
}

/** @param {Request} req @param {string} path */
function wantsJson(req, path) {
  const accept = req.headers.get('accept') || '';
  if (accept.includes('application/json') && !accept.includes('text/html')) return true;
  if (path.startsWith('/api/') || path.startsWith('/__webjs/')) return true;
  return false;
}

/**
 * Load the optional top-level `middleware.js`.
 * @param {string} appDir
 * @param {boolean} dev
 */
async function loadMiddleware(appDir, dev) {
  const file = join(appDir, 'middleware.js');
  if (!(await exists(file))) return null;
  const url = pathToFileURL(file).toString();
  const bust = dev ? `?t=${Date.now()}-${Math.random().toString(36).slice(2)}` : '';
  try {
    const mod = await import(url + bust);
    return typeof mod.default === 'function' ? mod.default : null;
  } catch (e) {
    console.error(`[webjs] failed to load middleware.js:`, e);
    return null;
  }
}

/* ------------ helpers ------------ */

/** @param {import('node:http').IncomingMessage} req @param {URL} url */
function toWebRequest(req, url) {
  const method = (req.method || 'GET').toUpperCase();
  /** @type {Record<string,string>} */
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v.join(',') : String(v ?? '');
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

/** @param {import('node:http').ServerResponse} res @param {Response} webRes */
async function sendWebResponse(res, webRes) {
  /** @type {Record<string,string>} */
  const headers = {};
  webRes.headers.forEach((v, k) => (headers[k] = v));
  res.writeHead(webRes.status, headers);
  const body = webRes.body;
  if (!body) { res.end(); return; }
  const reader = body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
}

/** @param {string} abs */
async function fileResponse(abs) {
  try {
    const data = await readFile(abs);
    const type = MIME[extname(abs).toLowerCase()] || 'application/octet-stream';
    return new Response(data, {
      status: 200,
      headers: { 'content-type': type, 'cache-control': 'no-cache' },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
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

const RELOAD_CLIENT_JS = `// webjs dev reload client
const es = new EventSource('/__webjs/events');
es.addEventListener('reload', () => location.reload());
`;
