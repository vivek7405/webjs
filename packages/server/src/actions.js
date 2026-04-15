import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { getExposed } from 'webjs';
import { walk } from './fs-walk.js';

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

  for await (const file of walk(appDir, (p) => p.endsWith('.js') || p.endsWith('.mjs'))) {
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
        httpRoutes.push({ method: http.method, pattern, paramNames, file, fnName: name });
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
  if (/\.server\.(js|mjs)$/.test(file)) return true;
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
    `async function __rpc(fn, args) {\n` +
    `  const res = await fetch(${JSON.stringify(`/__webjs/action/${hash}/`)} + fn, {\n` +
    `    method: 'POST',\n` +
    `    headers: { 'content-type': 'application/json' },\n` +
    `    credentials: 'same-origin',\n` +
    `    body: JSON.stringify(args)\n` +
    `  });\n` +
    `  if (!res.ok) throw new Error('webjs action ' + fn + ' -> ' + res.status);\n` +
    `  const ct = res.headers.get('content-type') || '';\n` +
    `  return ct.includes('application/json') ? res.json() : res.text();\n` +
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
  const file = idx.hashToFile.get(hash);
  if (!file) return new Response('Unknown action', { status: 404 });
  let args = [];
  try {
    const body = await req.text();
    args = body ? JSON.parse(body) : [];
    if (!Array.isArray(args)) args = [args];
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }
  const mod = await loadModule(file, idx.dev);
  const fn = fnName === 'default' ? mod.default : mod[fnName];
  if (typeof fn !== 'function') return new Response(`Unknown action ${fnName}`, { status: 404 });
  try {
    const result = await fn(...args);
    return Response.json(result ?? null);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * Try to match an incoming request against an expose()d action route.
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
  const arg = { ...query, ...params, ...body };
  const mod = await loadModule(route.file, idx.dev);
  const fn = mod[route.fnName];
  if (typeof fn !== 'function') return new Response(`Unknown action ${route.fnName}`, { status: 404 });
  try {
    const result = await fn(arg, { req, params });
    if (result instanceof Response) return result;
    return Response.json(result ?? null);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * Convert an `expose()` path like `/api/posts/:slug` to a regex + param list.
 * Also accepts Next.js-style `[slug]` brackets for familiarity.
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
