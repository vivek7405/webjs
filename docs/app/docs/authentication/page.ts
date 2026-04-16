import { html } from 'webjs';

export const metadata = { title: 'Authentication — webjs' };

export default function Authentication() {
  return html`
    <h1>Authentication</h1>
    <p>webjs doesn't ship an auth library — it provides the primitives you need to build session-based authentication cleanly. The blog example demonstrates a complete implementation using scrypt password hashing, session tokens in cookies, and middleware-based route protection.</p>

    <h2>Architecture</h2>
    <pre>lib/
  password.ts   — hashPassword() / verifyPassword() via scrypt
  session.ts    — createSession() / destroySession() / getUserByToken()
                  + cookie header helpers
modules/auth/
  actions/
    signup.server.ts   — register + create session
    login.server.ts    — verify credentials + create session
    logout.server.ts   — destroy session
  queries/
    current-user.server.ts  — read user from request cookies
app/
  api/auth/
    signup/route.ts    — POST handler, sets Set-Cookie
    login/route.ts     — POST handler, sets Set-Cookie
    logout/route.ts    — POST handler, clears cookie
    middleware.ts      — rate limit on auth endpoints
  dashboard/
    middleware.ts      — require auth, redirect to /login</pre>

    <h2>Password Hashing</h2>
    <pre>// lib/password.ts
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string): Promise&lt;string&gt; {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, 64) as Buffer;
  return \`scrypt\$\${salt.toString('hex')}\$\${derived.toString('hex')}\`;
}

export async function verifyPassword(
  password: string,
  stored: string | null,
): Promise&lt;boolean&gt; {
  if (!stored) return false;
  const [, saltHex, hashHex] = stored.split('$');
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = await scryptAsync(password, salt, expected.length) as Buffer;
  return timingSafeEqual(expected, derived);
}</pre>

    <h2>Session Cookies</h2>
    <pre>// lib/session.ts
export const SESSION_COOKIE = 'my_session';

export async function createSession(userId: number) {
  const token = randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { token, userId, expiresAt } });
  return { token, expiresAt };
}

export function sessionCookieHeader(token: string, opts = {}) {
  return \`\${SESSION_COOKIE}=\${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000\`;
}</pre>

    <h2>Reading the Current User</h2>
    <pre>// modules/auth/queries/current-user.server.ts
'use server';
import { cookies } from '@webjs/server';
import { getUserByToken, SESSION_COOKIE } from '../../../lib/session.ts';

export async function currentUser() {
  const token = cookies().get(SESSION_COOKIE);
  return getUserByToken(token);
}</pre>
    <p>The <code>cookies()</code> helper from <code>@webjs/server</code> reads the in-flight Request via AsyncLocalStorage — no parameter passing needed.</p>

    <h2>Route Protection via Middleware</h2>
    <pre>// app/dashboard/middleware.ts
import { cookies } from '@webjs/server';
import { getUserByToken, SESSION_COOKIE } from '../../lib/session.ts';

export default async function requireAuth(
  req: Request,
  next: () =&gt; Promise&lt;Response&gt;,
) {
  const user = await getUserByToken(cookies().get(SESSION_COOKIE));
  if (!user) {
    const to = encodeURIComponent(new URL(req.url).pathname);
    return new Response(null, {
      status: 302,
      headers: { location: \`/login?then=\${to}\` },
    });
  }
  return next();
}</pre>
    <p>This middleware only fires for routes under <code>/dashboard/**</code>. Unauthenticated users are redirected to <code>/login</code> with a return URL.</p>

    <h2>Rate Limiting Auth Endpoints</h2>
    <pre>// app/api/auth/middleware.ts
import { rateLimit } from '@webjs/server';

export default rateLimit({ window: '10s', max: 5 });</pre>
    <p>Any request to <code>/api/auth/**</code> is rate-limited to 5 per 10 seconds per IP. This applies to signup, login, and logout equally.</p>

    <h2>CSRF Protection</h2>
    <p>Server actions (called via the auto-generated RPC stub) are automatically CSRF-protected with a double-submit cookie. The SSR response sets a <code>webjs_csrf</code> cookie, and the stub echoes it in an <code>x-webjs-csrf</code> header. Mismatch → 403.</p>
    <p>API routes (<code>route.ts</code>) are NOT automatically CSRF-protected — they're intended for external consumers. If you need CSRF on a route handler, check the cookie/header manually in middleware.</p>

    <h2>Login Form Component</h2>
    <p>The blog's <code>&lt;auth-forms&gt;</code> component demonstrates a tabbed login/signup form that POSTs to the API routes, receives a Set-Cookie session header, and redirects to the dashboard. See <code>modules/auth/components/auth-forms.ts</code> in the blog example for the complete implementation.</p>
  `;
}
