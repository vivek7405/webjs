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
 * @param {string} pattern e.g. `"POST /api/posts"` or `"GET /api/posts/:slug"`
 * @param {Function} fn the async implementation
 * @param {{ validate?: (input: any) => any }} [opts]
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
  };
  return fn;
}

/** @param {unknown} fn */
export function getExposed(fn) {
  return fn && typeof fn === 'function' ? /** @type any */ (fn).__webjsHttp || null : null;
}
