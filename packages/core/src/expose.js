/**
 * Expose a server action as a first-class HTTP endpoint in addition to its
 * internal RPC URL.
 *
 * ```js
 * // actions/posts.server.js
 * 'use server';
 * import { expose } from '@webjs/core';
 *
 * export const createPost = expose('POST /api/posts', async ({ title, body }) => {
 *   // same function body you'd write without expose()
 * });
 * ```
 *
 * The action is reachable two ways, both backed by the exact same code:
 *   - from a client component:   `import { createPost } from '.../posts.server.js'`
 *   - from curl / another service: `POST /api/posts` with a JSON body
 *
 * Adapter rules when invoked over HTTP:
 *   - URL path params ({`:slug`}) and query string are merged into a single
 *     object argument.
 *   - For methods with a body (POST/PUT/PATCH/DELETE), the parsed JSON body
 *     is merged on top of params/query. The function receives ONE argument:
 *     the merged object.
 *   - If `opts.validate` is provided, it runs BEFORE the function and can
 *     transform / reject the input. Throw to fail (→ 400 response). Return
 *     value replaces the input. Works cleanly with zod, valibot, or any
 *     parser that throws: `expose('...', fn, { validate: Schema.parse })`.
 *   - Return value becomes a JSON `Response`; throw or return a `Response`
 *     directly for full control.
 *
 *
 * `cors` toggles browser CORS support for cross-origin callers:
 *   - `true`             — allow any origin (`*`), reflects requested headers
 *   - string             — allow that single origin (sets `Access-Control-Allow-Credentials: true`)
 *   - string[]           — allow-list; non-matching origins are not granted
 *   - { origin, credentials, maxAge, headers } — full control
 *
 * When CORS is enabled, an `OPTIONS` preflight at the same path is auto-served
 * with `Access-Control-Allow-Methods: <route's method>, OPTIONS`.
 *
 * @param {string} pattern e.g. `"POST /api/posts"` or `"GET /api/posts/:slug"`
 * @param {Function} fn the async implementation
 * @param {{
 *   validate?: (input: any) => any,
 *   cors?: boolean | string | string[] | { origin: string | string[], credentials?: boolean, maxAge?: number, headers?: string[] }
 * }} [opts]
 * @returns {Function} same function, tagged with HTTP metadata
 */
export function expose(pattern, fn, opts) {
  const match = /^\s*([A-Z]+)\s+(\/\S*)\s*$/.exec(pattern);
  if (!match) {
    throw new Error(
      `expose(): bad pattern ${JSON.stringify(pattern)} — expected "METHOD /path"`
    );
  }
  const [, method, path] = match;
  /** @type any */ (fn).__webjsHttp = {
    method,
    path,
    validate: opts && typeof opts.validate === 'function' ? opts.validate : null,
    cors: opts && 'cors' in opts ? normaliseCors(opts.cors) : null,
  };
  return fn;
}

/** @param {any} c */
function normaliseCors(c) {
  if (!c) return null;
  if (c === true) {
    return { origin: '*', credentials: false, maxAge: 86400, headers: null };
  }
  if (typeof c === 'string') {
    return { origin: c, credentials: true, maxAge: 86400, headers: null };
  }
  if (Array.isArray(c)) {
    return { origin: c, credentials: true, maxAge: 86400, headers: null };
  }
  return {
    origin: c.origin,
    credentials: !!c.credentials,
    maxAge: typeof c.maxAge === 'number' ? c.maxAge : 86400,
    headers: Array.isArray(c.headers) ? c.headers : null,
  };
}

/** @param {unknown} fn */
export function getExposed(fn) {
  return fn && typeof fn === 'function' ? /** @type any */ (fn).__webjsHttp || null : null;
}
