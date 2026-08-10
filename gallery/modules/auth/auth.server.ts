// The auth configuration. A server-only utility (a .server.ts with NO
// 'use server'), so it runs server-side and its browser import is a throw-at-load
// stub. Pages and route handlers import the pieces they need server-to-server;
// the client only ever reaches auth through a 'use server' action's RPC stub.
//
// createAuth returns { auth, signIn, signOut, handlers }. `handlers` mounts at
// app/api/auth/[...path]/route.ts (createAuth hardcodes the /api/auth/signin/*
// and /api/auth/callback/* paths, which is why that route stays at the app root
// even though the rest of this card lives under app/features/auth/).
import { createAuth, Credentials, GitHub, Google } from '@webjsdev/server';
import { db } from '#db/connection.server.ts';
import { compare } from './password.server.ts';

// AUTH_SECRET signs session tokens. Set a strong value in .env for any real
// deployment. The dev fallback keeps a fresh scaffold booting, but is NOT safe
// for production, so we fail fast if it is missing or blank there.
const trimmedSecret = process.env.AUTH_SECRET?.trim();
if (process.env.NODE_ENV === 'production' && !trimmedSecret) {
  throw new Error('AUTH_SECRET must be set in production');
}
const authSecret = trimmedSecret || 'dev-insecure-secret-change-me';

export const { auth, signIn, signOut, handlers } = createAuth({
  providers: [
    Credentials({
      async authorize(credentials: { email: string; password: string }) {
        const user = await db.query.users.findFirst({ where: { email: credentials.email } });
        if (!user?.passwordHash || !await compare(credentials.password, user.passwordHash)) return null;
        return { id: String(user.id), name: user.name, email: user.email };
      },
    }),
    // OAuth providers: add GitHub / Google sign-in by setting the matching env
    // vars. Each preset (GitHub(), Google()) reads AUTH_<PROVIDER>_ID / _SECRET,
    // so they only activate once configured and a fresh scaffold still boots with
    // just Credentials.
    ...(process.env.AUTH_GITHUB_ID ? [GitHub({ clientId: process.env.AUTH_GITHUB_ID, clientSecret: process.env.AUTH_GITHUB_SECRET })] : []),
    ...(process.env.AUTH_GOOGLE_ID ? [Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET })] : []),
  ],
  secret: authSecret,
  // A failed credentials sign-in 302s to `${pages.error}?error=CredentialsSignin`.
  // Point it at the login page so it reads searchParams.error and shows a message,
  // instead of the createAuth default (the home page) swallowing the error.
  pages: { error: '/features/auth/login' },
});

// Read the signed-in user off a request. auth(req) reads the session cookie
// (falling back to the ambient request when called with no argument), so this
// works from a page/layout, a segment middleware, or an action middleware that
// holds the request (the greet demo's require-auth reads it this way).
export async function getCurrentUser(req?: Request) {
  const session = await auth(req);
  return session?.user ?? null;
}
