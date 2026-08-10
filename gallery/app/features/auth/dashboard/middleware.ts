import { auth } from '#modules/auth/auth.server.ts';

// The protected-route gate. A per-segment middleware.ts runs for every request
// under /features/auth/dashboard/*. It reads the signed session off the request
// with auth(req); with no valid session it 302s to login BEFORE the page renders,
// so an anonymous visitor never sees the protected content. This needs no DB
// query (only a cookie read), so the gate is real the moment the app boots.
export default async function requireAuth(req: Request, next: () => Promise<Response>) {
  const session = await auth(req);
  if (!session?.user) {
    return new Response(null, { status: 302, headers: { location: '/features/auth/login' } });
  }
  return next();
}
