import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { getExposed } from '@webjskit/core';
import { walk } from './fs-walk.js';
import { verify as verifyCsrf, CSRF_COOKIE, CSRF_HEADER } from './csrf.js';
import { getSerializer } from './serializer.js';

/**
 * Internal RPC wire-format content type. Distinguishes webjs action
 * responses from plain `application/json` so the stub can pick the right
 * parser and external JSON consumers aren't confused.
 *
 * Uses the content type from the active serializer (defaults to
 * `application/vnd.webjs+json` with the built-in webjs serializer).
 */
export const RPC_CONTENT_TYPE = 'application/vnd.webjs+json';

/** Build a serialized Response with webjs content-type. */
async function rpcResponse(payload, init = {}) {
  const s = getSerializer();
  const headers = new Headers(init.headers || {});
  headers.set('content-type', s.contentType);
  return new Response(await s.serialize(payload), { ...init, headers });
}

/**
 * Server-actions subsystem.
 *
 * A "server action" is an async function defined in:
 *   - any file ending in `.server.js`, OR
 *   - any .js file whose first non-empty, non-comment line is `'use server'`.
 *
 * The server:
 *   1. Scans the app tree on boot, building a map of { hash -> absFile }.
 *   2. Serves a generated ES-module stub when the browser imports the file URL.
 *   3. Exposes POST endpoints at /__webjs/action/:hash/:fn that run the real function.
 *   4. If an exported function was wrapped in `expose('METHOD /path', fn)`, also
 *      registers it as a first-class REST endpoint.
 *
 * @typedef {{
 *   method: string,
 *   pattern: RegExp,
 *   paramNames: string[],
 *   file: string,
 *   fnName: string,
 *   validate: ((input: any) => any) | null,
 *   cors: { origin: string | string[], credentials: boolean, maxAge: number, headers: string[] | null } | null,
 * }} ExposedRoute
 *
 * @typedef {{
 *   hashToFile: Map<string,string>,
 *   fileToHash: Map<string,string>,
 *   httpRoutes: ExposedRoute[],
 *   appDir: string,
 *   dev: boolean,
 * }} ActionIndex
 */

/**
 * Build the action index by scanning the app directory.
 *
 * @param {string} appDir
 * @param {boolean} dev
 * @returns {Promise<ActionIndex>}
 */
export async function buildActionIndex(appDir, dev) {
  /** @type {Map<string,string>} */
  const hashToFile = new Map();
  /** @type {Map<string,string>} */
  const fileToHash = new Map();
  /** @type {ExposedRoute[]} */
  const httpRoutes = [];

  for await (const file of walk(appDir, (p) => /\.m?[jt]s$/.test(p))) {
    if (!(await isServerFile(file))) continue;
    const h = hashFile(file);
    hashToFile.set(h, file);
    fileToHash.set(file, h);
    // Load module once at scan time to pick up any expose() tags.
    try {
      const mod = await loadModule(file, dev);
      for (const [name, fn] of Object.entries(mod)) {
        if (typeof fn !== 'function') continue;
        const http = getExposed(fn);
        if (!http) continue;
        const { pattern, paramNames } = pathToPattern(http.path);
        httpRoutes.push({
          method: http.method,
          pattern,
          paramNames,
          file,
          fnName: name,
          validate: http.validate || null,
          cors: http.cors || null,
        });
      }
    } catch (e) {
      console.error(`[webjs] failed to scan server module ${file}:`, e);
    }
  }

  return { hashToFile, fileToHash, httpRoutes, appDir, dev };
}

/** @param {string} file */
export function hashFile(file) {
  return createHash('sha256').update(file).digest('hex').slice(0, 10);
}

/** @param {string} file */
export async function isServerFile(file) {
  if (/\.server\.m?[jt]s$/.test(file)) return true;
  try {
    const text = await readFile(file, 'utf8');
    const head = text.split('\n').slice(0, 5).join('\n');
    return /^\s*(['"])use server\1\s*;?\s*$/m.test(head);
  } catch {
    return false;
  }
}

/**
 * @param {ActionIndex} idx
 * @param {string} urlPath — a browser-visible URL path like `/actions/foo.server.js`
 */
export function resolveServerModule(idx, urlPath) {
  const abs = join(idx.appDir, urlPath.split('/').join(sep));
  return idx.fileToHash.has(abs) ? abs : null;
}

/**
 * Serve the generated client stub for a server module.
 * @param {ActionIndex} idx
 * @param {string} absFile
 */
export async function serveActionStub(idx, absFile) {
  const mod = await loadModule(absFile, idx.dev);
  const hash = idx.fileToHash.get(absFile) || hashFile(absFile);
  const fnNames = Object.keys(mod).filter((k) => typeof mod[k] === 'function');
  if (typeof mod.default === 'function' && !fnNames.includes('default')) {
    fnNames.push('default');
  }
  const body = `// webjs: generated server-action stub for ${relative(idx.appDir, absFile)}\n` +
    `import { stringify as __wjStringify, parse as __wjParse } from '@webjskit/core';\n` +
    `function __csrf() {\n` +
    `  const m = document.cookie.match(/(?:^|;\\s*)${CSRF_COOKIE}=([^;]+)/);\n` +
    `  return m ? decodeURIComponent(m[1]) : '';\n` +
    `}\n` +
    `async function __rpc(fn, args) {\n` +
    `  const body = await __wjStringify(args);\n` +
    `  const res = await fetch(${JSON.stringify(`/__webjs/action/${hash}/`)} + fn, {\n` +
    `    method: 'POST',\n` +
    `    headers: {\n` +
    `      'content-type': ${JSON.stringify(RPC_CONTENT_TYPE)},\n` +
    `      ${JSON.stringify(CSRF_HEADER)}: __csrf()\n` +
    `    },\n` +
    `    credentials: 'same-origin',\n` +
    `    body\n` +
    `  });\n` +
    `  const ct = res.headers.get('content-type') || '';\n` +
    `  const text = await res.text();\n` +
    `  const parsed = ct.includes(${JSON.stringify(RPC_CONTENT_TYPE)})\n` +
    `    ? __wjParse(text)\n` +
    `    : (ct.includes('application/json') ? JSON.parse(text) : text);\n` +
    `  if (!res.ok) {\n` +
    `    const msg = (parsed && parsed.error) || ('webjs action ' + fn + ' -> ' + res.status);\n` +
    `    throw new Error(msg);\n` +
    `  }\n` +
    `  return parsed;\n` +
    `}\n` +
    fnNames
      .map((name) =>
        name === 'default'
          ? `export default (...args) => __rpc('default', args);`
          : `export const ${name} = (...args) => __rpc(${JSON.stringify(name)}, args);`
      )
      .join('\n') + '\n';
  return body;
}

/**
 * Invoke a server action via the internal RPC wire format.
 * @param {ActionIndex} idx
 * @param {string} hash
 * @param {string} fnName
 * @param {Request} req
 */
export async function invokeAction(idx, hash, fnName, req) {
  if (!verifyCsrf(req)) {
    return rpcResponse({ error: 'CSRF validation failed' }, { status: 403 });
  }
  const file = idx.hashToFile.get(hash);
  if (!file) return rpcResponse({ error: 'Unknown action' }, { status: 404 });
  let args = [];
  try {
    const body = await req.text();
    args = body ? getSerializer().deserialize(body) : [];
    if (!Array.isArray(args)) args = [args];
  } catch {
    return rpcResponse({ error: 'Invalid request body' }, { status: 400 });
  }
  const mod = await loadModule(file, idx.dev);
  const fn = fnName === 'default' ? mod.default : mod[fnName];
  if (typeof fn !== 'function') return rpcResponse({ error: `Unknown action ${fnName}` }, { status: 404 });
  try {
    const result = await fn(...args);
    return rpcResponse(result ?? null);
  } catch (e) {
    return actionErrorResponse(e, idx.dev);
  }
}

/**
 * Match an incoming request against an expose()d action route.
 * Returns the single matched route+params for normal methods.
 * @param {ActionIndex} idx
 * @param {string} method
 * @param {string} pathname
 */
export function matchExposedAction(idx, method, pathname) {
  for (const r of idx.httpRoutes) {
    if (r.method !== method) continue;
    const m = r.pattern.exec(pathname);
    if (!m) continue;
    /** @type {Record<string,string>} */
    const params = {};
    r.paramNames.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1] || '')));
    return { route: r, params };
  }
  return null;
}

/**
 * Find ALL exposed routes at a given path (any method). Used to build OPTIONS
 * preflight responses and Allow headers.
 * @param {ActionIndex} idx
 * @param {string} pathname
 */
export function matchAllAtPath(idx, pathname) {
  const out = [];
  for (const r of idx.httpRoutes) {
    if (r.pattern.exec(pathname)) out.push(r);
  }
  return out;
}

/**
 * Build CORS response headers given a route's CORS config + the request.
 * Returns null if CORS isn't configured for this route.
 *
 * @param {ExposedRoute} route
 * @param {Request} req
 */
export function corsHeadersFor(route, req) {
  if (!route.cors) return null;
  const cfg = route.cors;
  const origin = req.headers.get('origin') || '';
  const allowed = matchOrigin(cfg.origin, origin);
  if (!allowed && origin) return null;
  const h = new Headers();
  h.set('access-control-allow-origin', allowed === true ? '*' : allowed || origin);
  if (cfg.credentials) h.set('access-control-allow-credentials', 'true');
  h.append('vary', 'Origin');
  return h;
}

/** @param {ExposedRoute} route @param {Request} req */
export function buildPreflightResponse(route, req) {
  const headers = corsHeadersFor(route, req);
  if (!headers) return new Response(null, { status: 403 });
  headers.set('access-control-allow-methods', `${route.method}, OPTIONS`);
  const reqHdrs =
    route.cors?.headers?.join(',') || req.headers.get('access-control-request-headers') || 'content-type';
  headers.set('access-control-allow-headers', reqHdrs);
  headers.set('access-control-max-age', String(route.cors?.maxAge ?? 86400));
  return new Response(null, { status: 204, headers });
}

/** Apply CORS headers (if any) to an existing response. */
export function withCors(resp, route, req) {
  const h = corsHeadersFor(route, req);
  if (!h) return resp;
  const newHeaders = new Headers(resp.headers);
  h.forEach((v, k) => newHeaders.set(k, v));
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: newHeaders });
}

/** @param {string|string[]} configured @param {string} origin */
function matchOrigin(configured, origin) {
  if (configured === '*') return true;
  if (Array.isArray(configured)) return configured.includes(origin) ? origin : null;
  return configured === origin ? origin : null;
}

/**
 * Invoke an exposed action as a REST endpoint.
 * Builds a single object argument from URL params + query + JSON body.
 * @param {ActionIndex} idx
 * @param {ExposedRoute} route
 * @param {Record<string,string>} params
 * @param {Request} req
 */
export async function invokeExposedAction(idx, route, params, req) {
  const url = new URL(req.url);
  const query = Object.fromEntries(url.searchParams.entries());
  let body = {};
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const text = await req.text();
    if (text) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed;
        else body = { body: parsed };
      } catch {
        return new Response('Invalid JSON body', { status: 400 });
      }
    }
  }
  let arg = { ...query, ...params, ...body };
  if (route.validate) {
    try {
      arg = route.validate(arg);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Many schema libs (zod, valibot) throw structured errors — pass their
      // `issues` array through when present for easier client-side handling.
      const issues = e && typeof e === 'object' && 'issues' in e
        ? /** @type any */ (e).issues
        : undefined;
      return Response.json({ error: msg, issues }, { status: 400 });
    }
  }
  const mod = await loadModule(route.file, idx.dev);
  const fn = mod[route.fnName];
  if (typeof fn !== 'function') return new Response(`Unknown action ${route.fnName}`, { status: 404 });
  try {
    const result = await fn(arg, { req, params });
    if (result instanceof Response) return result;
    return Response.json(result ?? null);
  } catch (e) {
    return actionErrorResponse(e, idx.dev);
  }
}

/**
 * Return a JSON error response with dev-vs-prod sanitization.
 * In prod we return only the error message (not the stack), and we log the
 * full error server-side. Internal errors with no message become a generic
 * 500.
 *
 * @param {unknown} err
 * @param {boolean} dev
 */
function actionErrorResponse(err, dev) {
  console.error('[webjs] action threw:', err);
  if (dev) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return rpcResponse({ error: msg, stack }, { status: 500 });
  }
  // Prod: only expose the thrown message (author-controlled), never the stack.
  const msg =
    err instanceof Error && typeof err.message === 'string' && err.message
      ? err.message
      : 'Internal server error';
  return rpcResponse({ error: msg }, { status: 500 });
}

/**
 * Convert an `expose()` path like `/api/posts/:slug` to a regex + param list.
 * Also accepts NextJs-style `[slug]` brackets for familiarity.
 * @param {string} path
 */
function pathToPattern(path) {
  const paramNames = [];
  const re = path.replace(/:([A-Za-z_][A-Za-z0-9_]*)|\[([A-Za-z_][A-Za-z0-9_]*)\]/g, (_, a, b) => {
    paramNames.push(a || b);
    return '([^/]+)';
  });
  return { pattern: new RegExp(`^${re}/?$`), paramNames };
}

/**
 * @param {string} file
 * @param {boolean} dev
 */
async function loadModule(file, dev) {
  const url = pathToFileURL(file).toString();
  const bust = dev ? `?t=${Date.now()}-${Math.random().toString(36).slice(2)}` : '';
  return import(url + bust);
}
