import { AsyncLocalStorage } from 'node:async_hooks';
import { parseCookies } from './csrf.js';

/**
 * Per-request context backed by AsyncLocalStorage. Lets server-side code
 * (pages, layouts, server actions, exposed actions) read the current
 * Request's headers and cookies without explicit threading — the same
 * ergonomics as Next.js's `headers()` / `cookies()` from `next/headers`.
 *
 * Strictly server-side: importing this module on the client is a bug.
 *
 * @typedef {{ req: Request }} Store
 */

/** @type {AsyncLocalStorage<Store>} */
const als = new AsyncLocalStorage();

/**
 * Run `fn` with the given request bound as the current context.
 * @template T
 * @param {Request} req
 * @param {() => T} fn
 * @returns {T}
 */
export function withRequest(req, fn) {
  return als.run({ req }, fn);
}

/** @returns {Request | null} */
export function getRequest() {
  return als.getStore()?.req ?? null;
}

/**
 * Read-only headers for the in-flight request. Throws outside a request
 * (e.g. at module top-level).
 * @returns {Headers}
 */
export function headers() {
  const req = getRequest();
  if (!req) throw new Error('headers(): called outside a request scope');
  return req.headers;
}

/**
 * Read-only cookie jar for the in-flight request. Returns an object with
 * `.get(name)`, `.has(name)`, `.entries()`. To SET a cookie, return a
 * `Response` whose headers include `Set-Cookie` (route handlers and
 * exposed actions can do this directly).
 *
 * @returns {{ get: (name: string) => string | undefined, has: (name: string) => boolean, entries: () => [string, string][] }}
 */
export function cookies() {
  const req = getRequest();
  if (!req) throw new Error('cookies(): called outside a request scope');
  const map = parseCookies(req);
  return {
    get: (name) => map[name],
    has: (name) => Object.prototype.hasOwnProperty.call(map, name),
    entries: () => Object.entries(map),
  };
}
