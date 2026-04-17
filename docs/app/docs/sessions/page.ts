import { html } from 'webjs';

export const metadata = { title: 'Sessions — webjs' };

export default function Sessions() {
  return html`
    <h1>Sessions</h1>
    <p>webjs provides session middleware that follows the <strong>opinionated defaults</strong> principle: signed cookie sessions in development with zero setup, automatic upgrade to Redis-backed sessions in production when <code>REDIS_URL</code> is set.</p>

    <h2>Zero-Config Convention</h2>
    <p>Sessions work out of the box. The only requirement is <code>SESSION_SECRET</code> — the key used to sign (and optionally encrypt) session cookies:</p>

    <pre># Required — used to sign session cookies
SESSION_SECRET=a-long-random-string-at-least-32-chars

# Optional — set this and sessions auto-switch to Redis
REDIS_URL=redis://localhost:6379</pre>

    <p>Without <code>REDIS_URL</code>, webjs uses <code>cookieSession</code> — the entire session payload is stored in a signed cookie, no server state needed. Set <code>REDIS_URL</code> and webjs switches to <code>storeSession</code> — only a session ID lives in the cookie, the data is stored in Redis. No code changes required.</p>

    <h2>Session Modes</h2>
    <h3>cookieSession (default)</h3>
    <p>The session payload is serialized, signed with HMAC-SHA256, and stored in an HTTP-only cookie. Best for small session data (user ID, role, preferences). No server-side storage needed.</p>
    <ul>
      <li>Stateless — scales horizontally with no shared storage.</li>
      <li>4 KB cookie size limit applies (after signing overhead).</li>
      <li>Every response includes the full session cookie.</li>
    </ul>

    <h3>storeSession (production)</h3>
    <p>Only a session ID is stored in the cookie. The actual session data lives in Redis (via the cache store). Best for larger session payloads or when you need server-side session invalidation.</p>
    <ul>
      <li>No payload size limit beyond Redis key size.</li>
      <li>Server-side invalidation — delete the key and the session is gone.</li>
      <li>Requires <code>REDIS_URL</code> to be set.</li>
    </ul>

    <h2>API</h2>
    <p>Use <code>getSession(req)</code> in any server-side code — API routes, server actions, middleware:</p>

    <pre>import { getSession } from '@webjs/server';</pre>

    <h3>getSession(req)</h3>
    <p>Returns the session object for the current request. The session is a plain object you can read and write freely. Changes are automatically persisted when the response is sent.</p>

    <pre>const session = await getSession(req);

// Read
const userId = session.userId;

// Write — just assign properties
session.userId = 42;
session.role = 'admin';

// Delete a key
delete session.cart;</pre>

    <h3>session.destroy()</h3>
    <p>Clears all session data and removes the cookie. Use this for logout flows.</p>

    <pre>const session = await getSession(req);
session.destroy();</pre>

    <h2>Example: Login Flow</h2>
    <pre>// app/api/login/route.server.js
import { getSession } from '@webjs/server';
import { prisma } from '../../lib/db.server.js';
import { verifyPassword } from '../../lib/auth.server.js';

export async function POST(req) {
  const { email, password } = await req.json();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !await verifyPassword(password, user.passwordHash)) {
    return Response.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const session = await getSession(req);
  session.userId = user.id;
  session.role = user.role;

  return Response.json({ ok: true });
}</pre>

    <h2>Example: Logout</h2>
    <pre>// app/api/logout/route.server.js
import { getSession } from '@webjs/server';

export async function POST(req) {
  const session = await getSession(req);
  session.destroy();
  return Response.json({ ok: true });
}</pre>

    <h2>Example: Protected API Route</h2>
    <pre>// app/api/me/route.server.js
import { getSession } from '@webjs/server';
import { prisma } from '../../lib/db.server.js';

export async function GET(req) {
  const session = await getSession(req);

  if (!session.userId) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true, email: true, role: true },
  });

  return Response.json(user);
}</pre>

    <h2>Example: Session in Server Actions</h2>
    <pre>// app/actions/cart.server.js
'use server';
import { getSession } from '@webjs/server';

export async function addToCart(req, productId, quantity) {
  const session = await getSession(req);
  session.cart = session.cart ?? [];
  session.cart.push({ productId, quantity });
  return { cartSize: session.cart.length };
}</pre>

    <h2>Session Options</h2>
    <p>The defaults work for most apps. If you need to customize, use <code>webjs.config.js</code>:</p>

    <pre>// webjs.config.js
export default {
  session: {
    cookieName: 'sid',       // default: 'webjs.sid'
    maxAge: 60 * 60 * 24 * 7, // 7 days (default: 24 hours)
    secure: true,            // default: auto (true in production)
    sameSite: 'lax',         // default: 'lax'
  },
};</pre>

    <h2>Next Steps</h2>
    <ul>
      <li><a href="/docs/cache">Cache Store</a> — the underlying store that backs server-side sessions</li>
      <li><a href="/docs/authentication">Authentication</a> — full auth patterns built on sessions</li>
      <li><a href="/docs/middleware">Middleware</a> — run session checks before route handlers</li>
    </ul>
  `;
}
