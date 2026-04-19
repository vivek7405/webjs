/**
 * Global middleware. Runs on every request before webjs routes it.
 * Return a Response to short-circuit; call next() to continue.
 *
 * To add framework sessions:
 * import { session, cookieSessionStorage } from '@webjskit/server';
 * export default session({
 *   secret: process.env.SESSION_SECRET,
 *   storage: cookieSessionStorage(),  // or storeSessionStorage() for Redis
 * });
 */
export default async function middleware(
  req: Request,
  next: () => Promise<Response>,
): Promise<Response> {
  const started = Date.now();
  const resp = await next();
  const elapsed = Date.now() - started;
  console.log(`[req] ${req.method} ${new URL(req.url).pathname} → ${resp.status} (${elapsed}ms)`);
  resp.headers.set('x-webjs', 'demo');
  return resp;
}
