/**
 * Global middleware. Runs on every request before webjs routes it.
 * Return a Response to short-circuit; call next() to continue.
 *
 * Session middleware (future):
 * The blog currently uses Prisma-backed sessions (lib/session.ts) with
 * database tokens. To migrate to the framework's built-in session:
 *
 *   import { session } from '@webjs/server';
 *   const withSession = session();   // requires SESSION_SECRET env var
 *
 *   // Then in this middleware:
 *   //   return withSession(req, async () => { ... next() ... });
 *
 *   // And in handlers:
 *   //   import { getSession } from '@webjs/server';
 *   //   const s = getSession(req);
 *   //   s.userId = user.id;  // set after login
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
