import { html } from 'webjs';

export const metadata = { title: 'Sessions — webjs' };

export default function Sessions() {
  return html`
    <h1>Sessions</h1>
    <p>webjs provides a <code>Session</code> class with a <code>SessionStorage</code> interface, inspired by Remix. Storage owns the session lifecycle: <code>storage.read(cookie) → Session</code>, <code>storage.save(session) → cookie</code>. Two built-in storage implementations cover most use cases.</p>

    <h2>Setup</h2>
    <p>Add session middleware in <code>middleware.ts</code>:</p>

    <pre>// middleware.ts
import { session, cookieSessionStorage } from '@webjs/server';

export default session({
  secret: process.env.SESSION_SECRET,
  storage: cookieSessionStorage(),  // or storeSessionStorage() for Redis
});</pre>

    <p>The only requirement is <code>SESSION_SECRET</code> (or pass <code>secret</code> directly) — the key used to sign session cookies.</p>

    <h2>SessionStorage Implementations</h2>

    <h3>cookieSessionStorage() — default</h3>
    <p>All session data lives in the cookie itself. Stateless — no server-side storage needed.</p>
    <ul>
      <li>Scales horizontally with no shared storage.</li>
      <li>4 KB cookie size limit applies (after signing overhead).</li>
      <li>Every response includes the full session cookie.</li>
    </ul>

    <pre>import { session, cookieSessionStorage } from '@webjs/server';

export default session({
  secret: process.env.SESSION_SECRET,
  storage: cookieSessionStorage(),
});</pre>

    <h3>storeSessionStorage() — production</h3>
    <p>Only a session ID is stored in the cookie. Session data lives in the cache store (memory by default, Redis when <code>REDIS_URL</code> is set).</p>
    <ul>
      <li>No payload size limit beyond store key size.</li>
      <li>Server-side invalidation — delete the store entry and the session is gone.</li>
      <li>For production, use with Redis: <code>setStore(redisStore(...))</code>.</li>
    </ul>

    <pre>import { session, storeSessionStorage } from '@webjs/server';

export default session({
  secret: process.env.SESSION_SECRET,
  storage: storeSessionStorage(),  // uses getStore() — memory or Redis
});</pre>

    <h2>Session Class API</h2>
    <p>Use <code>getSession(req)</code> in any server-side code — API routes, server actions, middleware:</p>

    <pre>import { getSession } from '@webjs/server';

const s = getSession(req);</pre>

    <h3>s.get(key)</h3>
    <p>Returns the value for the key, checking both regular data and flash data.</p>

    <pre>const userId = s.get('userId');</pre>

    <h3>s.set(key, value)</h3>
    <p>Sets a value. Pass <code>null</code> or <code>undefined</code> to delete the key.</p>

    <pre>s.set('userId', user.id);
s.set('role', 'admin');</pre>

    <h3>s.has(key)</h3>
    <p>Returns <code>true</code> if the key exists in either regular or flash data.</p>

    <pre>if (s.has('userId')) { /* authenticated */ }</pre>

    <h3>s.flash(key, value)</h3>
    <p>Sets a value that exists for one request only. Use for success/error messages after redirects.</p>

    <pre>s.flash('message', 'Post created!');
// Next request: s.get('message') → 'Post created!'
// Request after: s.get('message') → undefined</pre>

    <h3>s.destroy()</h3>
    <p>Clears all session data and removes the cookie. Use for logout flows.</p>

    <pre>s.destroy();</pre>

    <h3>s.regenerateId(deleteOld?)</h3>
    <p>Regenerates the session ID. Call after login to prevent session fixation attacks. Pass <code>true</code> to delete the old session entry from the store.</p>

    <pre>// After successful login:
s.set('userId', user.id);
s.regenerateId(true);  // new ID, old store entry deleted</pre>

    <h2>Example: Login Flow</h2>
    <pre>// app/api/login/route.ts
import { getSession } from '@webjs/server';
import { prisma } from '../../lib/prisma.ts';
import { verifyPassword } from '../../lib/auth.server.ts';

export async function POST(req: Request) {
  const { email, password } = await req.json();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !await verifyPassword(password, user.passwordHash)) {
    return Response.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const s = getSession(req);
  s.set('userId', user.id);
  s.set('role', user.role);
  s.regenerateId(true);

  return Response.json({ ok: true });
}</pre>

    <h2>Example: Logout</h2>
    <pre>// app/api/logout/route.ts
import { getSession } from '@webjs/server';

export async function POST(req: Request) {
  const s = getSession(req);
  s.destroy();
  return Response.json({ ok: true });
}</pre>

    <h2>Example: Flash Messages</h2>
    <pre>// In a server action after creating a post:
const s = getSession(req);
s.flash('success', 'Post published!');

// In the page that renders after redirect:
const s = getSession(req);
const message = s.get('success');  // 'Post published!' — only this request</pre>

    <h2>Session Options</h2>
    <p>The <code>session()</code> middleware accepts these options:</p>

    <pre>session({
  secret: '...',                      // required (or SESSION_SECRET env var)
  storage: cookieSessionStorage(),    // default: cookieSessionStorage()
  cookieName: 'webjs.sid',            // default: 'webjs.sid'
  maxAge: 86400_000,                  // 24 hours in ms (default)
  path: '/',                          // cookie path (default: '/')
  httpOnly: true,                     // default: true
  secure: true,                       // default: true
  sameSite: 'Lax',                    // default: 'Lax'
})</pre>

    <h2>Next Steps</h2>
    <ul>
      <li><a href="/docs/cache">Caching</a> — the cache store that backs server-side sessions</li>
      <li><a href="/docs/authentication">Authentication</a> — NextAuth-style auth built on top of sessions</li>
      <li><a href="/docs/middleware">Middleware</a> — run session checks before route handlers</li>
    </ul>
  `;
}
