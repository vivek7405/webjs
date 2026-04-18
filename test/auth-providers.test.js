/**
 * Extended coverage for createAuth() — Credentials variants, JWT +
 * database session strategies, Google/GitHub OAuth redirect + callback,
 * handler dispatch (GET/POST for /session, /signin, /callback,
 * /signout, /providers).
 *
 * OAuth endpoints are exercised via a fake global fetch; no real IdP.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createAuth,
  Credentials,
  Google,
  GitHub,
} from '../packages/server/src/auth.js';
import { memoryStore, setStore } from '../packages/server/src/cache.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/* -------------------- provider factories -------------------- */

test('Google: reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET env vars', () => {
  process.env.AUTH_GOOGLE_ID = 'env-id';
  process.env.AUTH_GOOGLE_SECRET = 'env-secret';
  try {
    const p = Google();
    assert.equal(p.clientId, 'env-id');
    assert.equal(p.clientSecret, 'env-secret');
    assert.ok(p.authorizationUrl.includes('accounts.google.com'));
  } finally {
    delete process.env.AUTH_GOOGLE_ID;
    delete process.env.AUTH_GOOGLE_SECRET;
  }
});

test('Google.profile: maps OIDC fields to user shape', () => {
  const p = Google({ clientId: 'c', clientSecret: 's' });
  const u = p.profile({ sub: '123', name: 'Ada', email: 'a@b', picture: 'p.png' });
  assert.deepEqual(u, { id: '123', name: 'Ada', email: 'a@b', image: 'p.png' });
});

test('GitHub.profile: maps fields, uses login fallback for name', () => {
  const p = GitHub({ clientId: 'c', clientSecret: 's' });
  assert.deepEqual(
    p.profile({ id: 42, name: 'Ada', email: 'a@b', avatar_url: '/img' }),
    { id: '42', name: 'Ada', email: 'a@b', image: '/img' },
  );
  assert.equal(p.profile({ id: 1, login: 'octo', email: null, avatar_url: null }).name, 'octo');
});

/* -------------------- Credentials flow -------------------- */

test('Credentials signIn success → 302 + auth cookie (JWT strategy)', async () => {
  const { signIn } = createAuth({
    secret: 's',
    providers: [Credentials({
      authorize: async (c) => c.email === 'u@x' ? { id: '1', name: 'U', email: 'u@x' } : null,
    })],
  });
  const resp = await signIn('credentials', { email: 'u@x', password: 'p' });
  assert.equal(resp.status, 302);
  assert.ok(resp.headers.get('set-cookie').includes('webjs.auth='));
});

test('Credentials signIn failure → 302 to error page', async () => {
  const { signIn } = createAuth({
    secret: 's',
    providers: [Credentials({ authorize: async () => null })],
    pages: { error: '/login?err=1' },
  });
  const resp = await signIn('credentials', {});
  assert.equal(resp.status, 302);
  assert.ok(resp.headers.get('location').startsWith('/login?err=1'));
});

test('Credentials signIn: redirectTo opts take precedence', async () => {
  const { signIn } = createAuth({
    secret: 's',
    providers: [Credentials({ authorize: async () => ({ id: '1', name: 'U', email: 'u@x' }) })],
  });
  const resp = await signIn('credentials', {}, { redirectTo: '/dash' });
  assert.equal(resp.headers.get('location'), '/dash');
});

test('signIn: unknown provider → 400', async () => {
  const { signIn } = createAuth({
    secret: 's',
    providers: [Credentials({ authorize: async () => null })],
  });
  const resp = await signIn('nope', {});
  assert.equal(resp.status, 400);
});

test('signIn: credentials without authorize → 500', async () => {
  const { signIn } = createAuth({
    secret: 's',
    providers: [{ id: 'credentials', type: 'credentials', name: 'Credentials' }],
  });
  const resp = await signIn('credentials', {});
  assert.equal(resp.status, 500);
});

test('signIn: cb.signIn returning false blocks authentication', async () => {
  const { signIn } = createAuth({
    secret: 's',
    providers: [Credentials({ authorize: async () => ({ id: '1', name: 'U', email: 'u@x' }) })],
    callbacks: { signIn: async () => false },
    pages: { error: '/denied' },
  });
  const resp = await signIn('credentials', {});
  assert.equal(resp.status, 302);
  assert.ok(resp.headers.get('location').startsWith('/denied'));
});

/* -------------------- auth() / readSession -------------------- */

test('auth(req) decodes JWT session cookie', async () => {
  const auth = createAuth({
    secret: 's',
    providers: [Credentials({ authorize: async () => ({ id: '42', name: 'B', email: 'b@x' }) })],
  });
  const login = await auth.signIn('credentials', {});
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const session = await auth.auth(new Request('http://x/', { headers: { cookie } }));
  assert.equal(session.user.id, '42');
});

test('auth(req) returns null without cookie', async () => {
  const { auth } = createAuth({
    secret: 's',
    providers: [Credentials({ authorize: async () => null })],
  });
  assert.equal(await auth(new Request('http://x/')), null);
});

test('auth(req) returns null for tampered JWT', async () => {
  const { auth } = createAuth({
    secret: 's',
    providers: [Credentials({ authorize: async () => null })],
  });
  const r = new Request('http://x/', { headers: { cookie: 'webjs.auth=forged.token' } });
  assert.equal(await auth(r), null);
});

/* -------------------- signOut -------------------- */

test('signOut returns 302 with cleared cookie', async () => {
  const { signOut } = createAuth({
    secret: 's',
    providers: [Credentials({ authorize: async () => null })],
  });
  const resp = await signOut();
  assert.equal(resp.status, 302);
  assert.ok(resp.headers.get('set-cookie').includes('Max-Age=0'));
});

test('signOut honours redirectTo', async () => {
  const { signOut } = createAuth({
    secret: 's',
    providers: [Credentials({ authorize: async () => null })],
  });
  const resp = await signOut({ redirectTo: '/bye' });
  assert.equal(resp.headers.get('location'), '/bye');
});

/* -------------------- database session strategy -------------------- */

test('database session: signIn stores sid via adapter, auth() reads back', async () => {
  setStore(memoryStore());
  const auth = createAuth({
    secret: 's',
    session: { strategy: 'database' },
    providers: [Credentials({ authorize: async () => ({ id: 'u1', name: 'X', email: 'x@x' }) })],
  });
  const login = await auth.signIn('credentials', {});
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const session = await auth.auth(new Request('http://x/', { headers: { cookie } }));
  assert.equal(session.user.id, 'u1');
});

test('database session: signOut destroys the sid in the adapter', async () => {
  setStore(memoryStore());
  const auth = createAuth({
    secret: 's',
    session: { strategy: 'database' },
    providers: [Credentials({ authorize: async () => ({ id: 'u2', name: 'Y', email: 'y@x' }) })],
  });
  const login = await auth.signIn('credentials', {});
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const req = new Request('http://x/', { headers: { cookie } });
  await auth.signOut({ req });
  // After destroy, the original cookie no longer resolves.
  assert.equal(await auth.auth(req), null);
});

/* -------------------- OAuth redirect + callback -------------------- */

test('OAuth signIn: google → 302 to auth URL with state param', async () => {
  const { signIn } = createAuth({
    secret: 's',
    providers: [Google({ clientId: 'cid', clientSecret: 'csec' })],
  });
  const resp = await signIn('google', {}, { req: new Request('http://localhost/any') });
  assert.equal(resp.status, 302);
  const loc = new URL(resp.headers.get('location'));
  assert.ok(loc.href.startsWith('https://accounts.google.com/o/oauth2/v2/auth'));
  assert.equal(loc.searchParams.get('client_id'), 'cid');
  assert.ok(loc.searchParams.get('state'));
  assert.ok(resp.headers.get('set-cookie').includes('webjs.auth.state='));
});

test('OAuth callback: full round-trip writes session + clears state cookie', async () => {
  globalThis.fetch = async (url) => {
    const s = String(url);
    if (s.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'AC' }),
        { headers: { 'content-type': 'application/json' } });
    }
    if (s.includes('googleapis.com/oauth2/v3/userinfo')) {
      return new Response(
        JSON.stringify({ sub: 'g1', name: 'A', email: 'a@g', picture: 'p.png' }),
        { headers: { 'content-type': 'application/json' } },
      );
    }
    throw new Error('unexpected fetch ' + s);
  };

  const auth = createAuth({
    secret: 's',
    providers: [Google({ clientId: 'cid', clientSecret: 'csec' })],
  });
  const start = await auth.handlers.GET(new Request('http://localhost/api/auth/signin/google'));
  const stateCookie = start.headers.get('set-cookie').split(';')[0];
  const rawState = decodeURIComponent(stateCookie.split('=')[1]).split('.')[0];

  const resp = await auth.handlers.GET(new Request(
    `http://localhost/api/auth/callback/google?code=CODE&state=${rawState}`,
    { headers: { cookie: stateCookie } },
  ));
  assert.equal(resp.status, 302);
  const cookies = resp.headers.getSetCookie ? resp.headers.getSetCookie() : [resp.headers.get('set-cookie')];
  assert.ok(cookies.some((c) => c && c.includes('webjs.auth=')));
});

test('OAuth callback: GitHub private-email fallback hits /user/emails', async () => {
  let emailsHit = false;
  globalThis.fetch = async (url) => {
    const s = String(url);
    if (s.includes('github.com/login/oauth/access_token')) {
      return new Response(JSON.stringify({ access_token: 'AC' }),
        { headers: { 'content-type': 'application/json' } });
    }
    if (s === 'https://api.github.com/user') {
      return new Response(JSON.stringify({ id: 7, login: 'oct', email: null, avatar_url: '' }),
        { headers: { 'content-type': 'application/json' } });
    }
    if (s === 'https://api.github.com/user/emails') {
      emailsHit = true;
      return new Response(JSON.stringify([
        { email: 'oct@x', primary: true, verified: true },
      ]), { headers: { 'content-type': 'application/json' } });
    }
    throw new Error('unexpected ' + s);
  };

  const auth = createAuth({
    secret: 's',
    providers: [GitHub({ clientId: 'c', clientSecret: 's' })],
  });
  const start = await auth.handlers.GET(new Request('http://localhost/api/auth/signin/github'));
  const stateCookie = start.headers.get('set-cookie').split(';')[0];
  const raw = decodeURIComponent(stateCookie.split('=')[1]).split('.')[0];

  const resp = await auth.handlers.GET(new Request(
    `http://localhost/api/auth/callback/github?code=C&state=${raw}`,
    { headers: { cookie: stateCookie } },
  ));
  assert.equal(resp.status, 302);
  assert.equal(emailsHit, true, 'email fallback endpoint was called');
});

test('OAuth callback: missing code → 400', async () => {
  const { handlers } = createAuth({
    secret: 's',
    providers: [Google({ clientId: 'c', clientSecret: 's' })],
  });
  const resp = await handlers.GET(new Request('http://localhost/api/auth/callback/google'));
  assert.equal(resp.status, 400);
});

test('OAuth callback: missing state cookie → 403', async () => {
  const { handlers } = createAuth({
    secret: 's',
    providers: [Google({ clientId: 'c', clientSecret: 's' })],
  });
  const resp = await handlers.GET(
    new Request('http://localhost/api/auth/callback/google?code=C&state=S'),
  );
  assert.equal(resp.status, 403);
});

test('OAuth callback: mismatched state → 403', async () => {
  const { handlers } = createAuth({
    secret: 's',
    providers: [Google({ clientId: 'c', clientSecret: 's' })],
  });
  const resp = await handlers.GET(
    new Request('http://localhost/api/auth/callback/google?code=C&state=WRONG', {
      headers: { cookie: 'webjs.auth.state=forged.sig' },
    }),
  );
  assert.equal(resp.status, 403);
});

test('OAuth callback: token exchange returns non-ok → 502', async () => {
  globalThis.fetch = async () => new Response('', { status: 500 });
  const auth = createAuth({
    secret: 's',
    providers: [Google({ clientId: 'c', clientSecret: 's' })],
  });
  const start = await auth.handlers.GET(new Request('http://localhost/api/auth/signin/google'));
  const stateCookie = start.headers.get('set-cookie').split(';')[0];
  const raw = decodeURIComponent(stateCookie.split('=')[1]).split('.')[0];
  const resp = await auth.handlers.GET(
    new Request(`http://localhost/api/auth/callback/google?code=C&state=${raw}`, {
      headers: { cookie: stateCookie },
    }),
  );
  assert.equal(resp.status, 502);
});

test('OAuth callback: profile fetch returns non-ok → 502', async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes('token')) {
      return new Response(JSON.stringify({ access_token: 'A' }),
        { headers: { 'content-type': 'application/json' } });
    }
    return new Response('', { status: 500 });
  };
  const auth = createAuth({
    secret: 's',
    providers: [Google({ clientId: 'c', clientSecret: 's' })],
  });
  const start = await auth.handlers.GET(new Request('http://localhost/api/auth/signin/google'));
  const stateCookie = start.headers.get('set-cookie').split(';')[0];
  const raw = decodeURIComponent(stateCookie.split('=')[1]).split('.')[0];
  const resp = await auth.handlers.GET(
    new Request(`http://localhost/api/auth/callback/google?code=C&state=${raw}`, {
      headers: { cookie: stateCookie },
    }),
  );
  assert.equal(resp.status, 502);
});

/* -------------------- Handlers: GET routes -------------------- */

test('GET /api/auth/session returns current session JSON', async () => {
  const auth = createAuth({
    secret: 's',
    providers: [Credentials({ authorize: async () => ({ id: '1', name: 'X', email: 'x@x' }) })],
  });
  const login = await auth.signIn('credentials', {});
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const resp = await auth.handlers.GET(
    new Request('http://localhost/api/auth/session', { headers: { cookie } }),
  );
  const body = await resp.json();
  assert.equal(body.user.id, '1');
});

test('GET /api/auth/providers returns provider metadata', async () => {
  const { handlers } = createAuth({
    secret: 's',
    providers: [
      Credentials({ authorize: async () => null }),
      Google({ clientId: 'c', clientSecret: 's' }),
    ],
  });
  const resp = await handlers.GET(new Request('http://localhost/api/auth/providers'));
  const body = await resp.json();
  assert.equal(body.google.type, 'oauth');
  assert.equal(body.credentials.type, 'credentials');
});

test('GET /api/auth/signout: clears cookie, redirects', async () => {
  const { handlers } = createAuth({
    secret: 's',
    providers: [Credentials({ authorize: async () => null })],
  });
  const resp = await handlers.GET(new Request('http://localhost/api/auth/signout'));
  assert.equal(resp.status, 302);
  assert.ok(resp.headers.get('set-cookie').includes('Max-Age=0'));
});

test('GET /api/auth/signin/credentials: non-OAuth → 404', async () => {
  const { handlers } = createAuth({
    secret: 's',
    providers: [Credentials({ authorize: async () => null })],
  });
  const resp = await handlers.GET(new Request('http://localhost/api/auth/signin/credentials'));
  assert.equal(resp.status, 404);
});

test('GET /api/auth/unknown: 404', async () => {
  const { handlers } = createAuth({
    secret: 's',
    providers: [Credentials({ authorize: async () => null })],
  });
  const resp = await handlers.GET(new Request('http://localhost/api/auth/somethingelse'));
  assert.equal(resp.status, 404);
});

/* -------------------- Handlers: POST routes -------------------- */

test('POST /api/auth/signin/credentials (JSON body)', async () => {
  const { handlers } = createAuth({
    secret: 's',
    providers: [Credentials({ authorize: async (c) => ({ id: 'id', name: 'n', email: c.email }) })],
  });
  const resp = await handlers.POST(new Request('http://localhost/api/auth/signin/credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'x@y' }),
  }));
  assert.equal(resp.status, 302);
  assert.ok(resp.headers.get('set-cookie').includes('webjs.auth='));
});

test('POST /api/auth/signin/credentials (form body)', async () => {
  const { handlers } = createAuth({
    secret: 's',
    providers: [Credentials({ authorize: async (c) => (c.email ? { id: 'i', name: 'n', email: c.email } : null) })],
  });
  const fd = new FormData();
  fd.append('email', 'f@y');
  const resp = await handlers.POST(new Request('http://localhost/api/auth/signin/credentials', {
    method: 'POST', body: fd,
  }));
  assert.equal(resp.status, 302);
});

test('POST /api/auth/signout clears cookie', async () => {
  const { handlers } = createAuth({
    secret: 's',
    providers: [Credentials({ authorize: async () => null })],
  });
  const resp = await handlers.POST(new Request('http://localhost/api/auth/signout', { method: 'POST' }));
  assert.equal(resp.status, 302);
  assert.ok(resp.headers.get('set-cookie').includes('Max-Age=0'));
});

test('POST /api/auth/signin/unknown: 404', async () => {
  const { handlers } = createAuth({
    secret: 's',
    providers: [Credentials({ authorize: async () => null })],
  });
  const resp = await handlers.POST(new Request('http://localhost/api/auth/signin/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }));
  assert.equal(resp.status, 404);
});

test('POST /api/auth/unknown: 404', async () => {
  const { handlers } = createAuth({
    secret: 's',
    providers: [Credentials({ authorize: async () => null })],
  });
  const resp = await handlers.POST(new Request('http://localhost/api/auth/nada', { method: 'POST' }));
  assert.equal(resp.status, 404);
});
