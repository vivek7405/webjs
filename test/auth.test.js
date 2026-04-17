import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createAuth, Credentials } from '../packages/server/src/auth.js';

const SECRET = 'test-secret-at-least-32-chars-long!!';

test('Credentials provider produces expected shape', () => {
  const p = Credentials({ authorize: async () => null });
  assert.equal(p.id, 'credentials');
  assert.equal(p.type, 'credentials');
  assert.equal(typeof p.authorize, 'function');
});

test('createAuth throws without secret', () => {
  assert.throws(
    () => createAuth({ providers: [], secret: '' }),
    /secret/,
  );
});

test('signIn with valid credentials returns redirect with cookie', async () => {
  const { signIn } = createAuth({
    secret: SECRET,
    providers: [
      Credentials({
        authorize: async (creds) => {
          if (creds.email === 'a@b.com' && creds.password === 'pw') {
            return { id: '1', name: 'Alice', email: 'a@b.com' };
          }
          return null;
        },
      }),
    ],
  });

  const resp = await signIn('credentials', { email: 'a@b.com', password: 'pw' });
  assert.equal(resp.status, 302);
  assert.equal(resp.headers.get('location'), '/');
  const setCookie = resp.headers.get('set-cookie');
  assert.ok(setCookie);
  assert.ok(setCookie.includes('webjs.auth='));
});

test('signIn with bad credentials redirects to error', async () => {
  const { signIn } = createAuth({
    secret: SECRET,
    providers: [
      Credentials({
        authorize: async () => null,
      }),
    ],
  });

  const resp = await signIn('credentials', { email: 'bad', password: 'bad' });
  assert.equal(resp.status, 302);
  assert.ok(resp.headers.get('location').includes('error=CredentialsSignin'));
});

test('signIn with unknown provider returns 400', async () => {
  const { signIn } = createAuth({
    secret: SECRET,
    providers: [Credentials({ authorize: async () => null })],
  });
  const resp = await signIn('nonexistent', {});
  assert.equal(resp.status, 400);
});

test('auth returns null when no cookie is present', async () => {
  const { auth } = createAuth({
    secret: SECRET,
    providers: [Credentials({ authorize: async () => null })],
  });
  const req = new Request('http://localhost/');
  const session = await auth(req);
  assert.equal(session, null);
});

test('signOut clears cookie', async () => {
  const { signOut } = createAuth({
    secret: SECRET,
    providers: [Credentials({ authorize: async () => null })],
  });
  const resp = await signOut({ redirectTo: '/login' });
  assert.equal(resp.status, 302);
  assert.equal(resp.headers.get('location'), '/login');
  const setCookie = resp.headers.get('set-cookie');
  assert.ok(setCookie);
  assert.ok(setCookie.includes('Max-Age=0'));
});

test('full sign-in then auth round-trip reads session back', async () => {
  const { signIn, auth } = createAuth({
    secret: SECRET,
    providers: [
      Credentials({
        authorize: async () => ({ id: '7', name: 'Bob', email: 'bob@b.com' }),
      }),
    ],
  });

  const signInResp = await signIn('credentials', {});
  const cookie = signInResp.headers.get('set-cookie');
  // Extract the cookie value
  const match = cookie.match(/webjs\.auth=([^;]+)/);
  assert.ok(match);

  const req = new Request('http://localhost/', {
    headers: { cookie: `webjs.auth=${match[1]}` },
  });
  const session = await auth(req);
  assert.ok(session);
  assert.equal(session.user.name, 'Bob');
  assert.equal(session.user.email, 'bob@b.com');
});
