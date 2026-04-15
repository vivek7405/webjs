/**
 * Global middleware. Runs on every request before webjs routes it.
 *
 * Receives `(req, next)` where:
 *   - `req` is a standard `Request`.
 *   - `next()` returns a `Promise<Response>` for the normal pipeline.
 *
 * Return a `Response` to short-circuit; call `next()` to continue.
 *
 * @param {Request} req
 * @param {() => Promise<Response>} next
 */
export default async function middleware(req, next) {
  const started = Date.now();
  const resp = await next();
  const elapsed = Date.now() - started;
  // eslint-disable-next-line no-console
  console.log(`[req] ${req.method} ${new URL(req.url).pathname} → ${resp.status} (${elapsed}ms)`);
  resp.headers.set('x-webjs', 'demo');
  return resp;
}
