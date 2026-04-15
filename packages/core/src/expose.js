/**
 * Expose a server action as a first-class HTTP endpoint in addition to its
 * internal RPC URL.
 *
 * ```js
 * // actions/posts.server.js
 * 'use server';
 * import { expose } from 'webjs';
 *
 * export const createPost = expose('POST /api/posts', async ({ title, body }) => {
 *   // same function body you'd write without expose()
 * });
 * ```
 *
 * The action is now reachable two ways, both backed by the exact same code:
 *   - from a client component:   `import { createPost } from '.../posts.server.js'`
 *   - from curl / another service: `POST /api/posts` with a JSON body
 *
 * Adapter rules when invoked over HTTP:
 *   - URL path params ({`:slug`}) and query string are merged into a single
 *     object argument.
 *   - For methods with a body (POST/PUT/PATCH/DELETE), the parsed JSON body
 *     is merged on top of params/query. The function receives ONE argument:
 *     the merged object.
 *   - Return value becomes a JSON `Response`; throw or return a `Response`
 *     directly for full control.
 *
 * @param {string} pattern e.g. `"POST /api/posts"` or `"GET /api/posts/:slug"`
 * @param {Function} fn the async implementation
 * @returns {Function} same function, tagged with HTTP metadata
 */
export function expose(pattern, fn) {
  const match = /^\s*([A-Z]+)\s+(\/\S*)\s*$/.exec(pattern);
  if (!match) {
    throw new Error(
      `expose(): bad pattern ${JSON.stringify(pattern)} — expected "METHOD /path"`
    );
  }
  const [, method, path] = match;
  /** @type any */ (fn).__webjsHttp = { method, path };
  return fn;
}

/** @param {unknown} fn */
export function getExposed(fn) {
  return fn && typeof fn === 'function' ? /** @type any */ (fn).__webjsHttp || null : null;
}
