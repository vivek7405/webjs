import { auth } from '#modules/auth/auth.server.ts';

// Like the login middleware: an already-signed-in visitor has no reason to see
// the signup form, so send them to the dashboard before the page renders.
export default async function redirectIfSignedIn(req: Request, next: () => Promise<Response>) {
  const session = await auth(req);
  if (session?.user) {
    return new Response(null, { status: 302, headers: { location: '/features/auth/dashboard' } });
  }
  return next();
}
