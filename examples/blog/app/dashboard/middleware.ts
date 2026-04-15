import { cookies } from '@webjs/server';
import { getUserByToken, SESSION_COOKIE } from '../../lib/session.ts';

/**
 * /dashboard/* access control. If no session → 302 to /login.
 *
 * Per-segment middleware demo: this file only fires on requests under
 * /dashboard/, never on /blog/… or /api/….
 */
export default async function requireAuth(
  req: Request,
  next: () => Promise<Response>,
): Promise<Response> {
  const user = await getUserByToken(cookies().get(SESSION_COOKIE));
  if (!user) {
    const to = encodeURIComponent(new URL(req.url).pathname);
    return new Response(null, { status: 302, headers: { location: `/login?then=${to}` } });
  }
  return next();
}
