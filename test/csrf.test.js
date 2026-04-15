import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  newToken,
  parseCookies,
  readToken,
  cookieHeader,
  verify,
  CSRF_COOKIE,
  CSRF_HEADER,
} from '../packages/server/src/csrf.js';

test('newToken returns 32-char hex', () => {
  const t = newToken();
  assert.match(t, /^[0-9a-f]{32}$/);
});

test('parseCookies handles multiple cookies and trimming', () => {
  const req = new Request('http://x/', {
    headers: { cookie: 'a=1; b=two%20words; c=3' },
  });
  assert.deepEqual(parseCookies(req), { a: '1', b: 'two words', c: '3' });
});

test('readToken extracts the webjs_csrf cookie', () => {
  const req = new Request('http://x/', {
    headers: { cookie: `other=1; ${CSRF_COOKIE}=tokvalue; trailing=x` },
  });
  assert.equal(readToken(req), 'tokvalue');
});

test('cookieHeader includes Secure when requested', () => {
  assert.match(cookieHeader('abc'), /^webjs_csrf=abc; Path=\/; SameSite=Lax; Max-Age=\d+$/);
  assert.match(cookieHeader('abc', { secure: true }), /Secure$/);
});

test('verify passes when cookie matches header', () => {
  const tok = newToken();
  const req = new Request('http://x/', {
    headers: { cookie: `${CSRF_COOKIE}=${tok}`, [CSRF_HEADER]: tok },
  });
  assert.equal(verify(req), true);
});

test('verify fails on missing/mismatched/empty tokens', () => {
  // Missing header
  const r1 = new Request('http://x/', { headers: { cookie: `${CSRF_COOKIE}=xyz` } });
  assert.equal(verify(r1), false);

  // Missing cookie
  const r2 = new Request('http://x/', { headers: { [CSRF_HEADER]: 'xyz' } });
  assert.equal(verify(r2), false);

  // Length mismatch
  const r3 = new Request('http://x/', {
    headers: { cookie: `${CSRF_COOKIE}=aaaa`, [CSRF_HEADER]: 'aaaaa' },
  });
  assert.equal(verify(r3), false);

  // Same length, different content
  const r4 = new Request('http://x/', {
    headers: { cookie: `${CSRF_COOKIE}=aaaa`, [CSRF_HEADER]: 'bbbb' },
  });
  assert.equal(verify(r4), false);
});
