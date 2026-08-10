import { auth } from '#modules/auth/auth.server.ts';

// The mirror of the dashboard's protect-middleware: a visitor who is ALREADY
// signed in has no reason to see the login form, so send them to the dashboard.
// A per-segment middleware.ts reads the signed session off the request with
// auth(req) (a cookie read, no DB), so the redirect happens before the page
// renders. Keeping the check in middleware (not the page) keeps auth.server.ts
// off the client.
export default async function redirectIfSignedIn(req: Request, next: () => Promise<Response>) {
  const session = await auth(req);
  if (session?.user) {
    return new Response(null, { status: 302, headers: { location: '/features/auth/dashboard' } });
  }
  return next();
}
