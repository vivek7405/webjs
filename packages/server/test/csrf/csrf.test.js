/**
 * Cross-origin (CSRF) protection unit tests (#659).
 *
 * The action endpoint defends against CSRF with a `Sec-Fetch-Site` check
 * (browser-set fetch metadata) and an `Origin`-vs-host fallback for older
 * browsers, matching Remix 3's cop-middleware and Go 1.25's
 * http.CrossOriginProtection. No token cookie is involved.
 *
 * The cross-origin-reject cases are the counterfactual: if `verifyOrigin`
 * always returned ok, every `assert.equal(..., false)` here fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCookies, requestHost, verifyOrigin, readAllowedOrigins } from '../../src/csrf.js';

const reqWith = (headers, url = 'http://app.example/__webjs/action/abc/fn') =>
  new Request(url, { method: 'POST', headers });

test('parseCookies handles multiple cookies and trimming', () => {
  const req = new Request('http://x/', { headers: { cookie: 'a=1; b=two%20words; c=3' } });
  assert.deepEqual(parseCookies(req), { a: '1', b: 'two words', c: '3' });
});

test('requestHost prefers x-forwarded-host, then Host, then URL', () => {
  assert.equal(requestHost(reqWith({ 'x-forwarded-host': 'fwd.example', host: 'app.example' })), 'fwd.example');
  assert.equal(requestHost(reqWith({ host: 'app.example' })), 'app.example');
  assert.equal(requestHost(reqWith({})), 'app.example');
});

/* ---------------- the shared trust posture (#1104) ---------------- */

// Run `fn` with WEBJS_NO_TRUST_PROXY=1, restoring whatever was there before.
// The flag is read at CALL time (never cached at boot) precisely so a test can
// toggle it per case.
function withProxyDistrusted(fn) {
  const prev = process.env.WEBJS_NO_TRUST_PROXY;
  process.env.WEBJS_NO_TRUST_PROXY = '1';
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.WEBJS_NO_TRUST_PROXY;
    else process.env.WEBJS_NO_TRUST_PROXY = prev;
  }
}

test('requestHost honors WEBJS_NO_TRUST_PROXY=1 like every other forwarded read', () => {
  const req = reqWith({ 'x-forwarded-host': 'fwd.example', host: 'app.example' });
  assert.equal(requestHost(req), 'fwd.example', 'trusted by default, the proxied deploy');
  withProxyDistrusted(() => {
    assert.equal(
      requestHost(req),
      'app.example',
      'with the flag set the forwarded host is ignored and the raw Host wins',
    );
  });
});

test('requestHost falls through to the URL host when the flag is set and there is no Host', () => {
  withProxyDistrusted(() => {
    assert.equal(requestHost(reqWith({ 'x-forwarded-host': 'fwd.example' })), 'app.example');
  });
});

test('the flag does not touch the primary Sec-Fetch-Site path', () => {
  // requestHost is reached ONLY from the no-Sec-Fetch-Site fallback, and that
  // is the path nearly every real browser request skips. A change to the host
  // resolution must not move any of these verdicts.
  const cases = [
    [{ 'sec-fetch-site': 'same-origin', 'x-forwarded-host': 'fwd.example' }, true],
    [{ 'sec-fetch-site': 'none', 'x-forwarded-host': 'fwd.example' }, true],
    [{ 'sec-fetch-site': 'cross-site', 'x-forwarded-host': 'fwd.example' }, false],
    [{ 'sec-fetch-site': 'same-site', 'x-forwarded-host': 'fwd.example' }, false],
  ];
  for (const [headers, expected] of cases) {
    assert.equal(verifyOrigin(reqWith(headers)).ok, expected, `trusted: ${headers['sec-fetch-site']}`);
    withProxyDistrusted(() => {
      assert.equal(verifyOrigin(reqWith(headers)).ok, expected, `distrusted: ${headers['sec-fetch-site']}`);
    });
  }
});

test('the fallback compares Origin against the raw Host when the flag is set', () => {
  // The proxied shape: the browser is on app.example, the proxy forwards that
  // as x-forwarded-host and the container sees Host: internal:8080.
  const proxied = reqWith({
    origin: 'https://app.example',
    'x-forwarded-host': 'app.example',
    host: 'internal:8080',
  });
  assert.equal(verifyOrigin(proxied).ok, true, 'behind a trusted proxy this is the same origin');
  withProxyDistrusted(() => {
    assert.equal(
      verifyOrigin(proxied).ok,
      false,
      'with the flag set on a proxied deploy (a misconfiguration) the fallback compares against Host and rejects: the flag saying "nothing in front of me" is exactly this',
    );
  });
});

test('Sec-Fetch-Site same-origin / none pass', () => {
  assert.equal(verifyOrigin(reqWith({ 'sec-fetch-site': 'same-origin' })).ok, true);
  assert.equal(verifyOrigin(reqWith({ 'sec-fetch-site': 'none' })).ok, true);
});

test('Sec-Fetch-Site cross-site / same-site are rejected', () => {
  assert.equal(verifyOrigin(reqWith({ 'sec-fetch-site': 'cross-site' })).ok, false);
  assert.equal(verifyOrigin(reqWith({ 'sec-fetch-site': 'same-site' })).ok, false);
});

test('a cross-site request from an allowlisted origin passes', () => {
  const req = reqWith({ 'sec-fetch-site': 'cross-site', origin: 'https://trusted.example' });
  assert.equal(verifyOrigin(req, ['trusted.example']).ok, true);
  assert.equal(verifyOrigin(req, ['https://trusted.example']).ok, true, 'full-origin form also accepted');
  assert.equal(verifyOrigin(req, ['trusted.example/']).ok, true, 'a stray trailing slash is tolerated');
  assert.equal(verifyOrigin(req, ['other.example']).ok, false, 'a different allowlist does not help');
});

test('fallback: no Sec-Fetch-Site, Origin host matches host -> ok', () => {
  const req = reqWith({ origin: 'http://app.example', host: 'app.example' });
  assert.equal(verifyOrigin(req).ok, true);
});

test('fallback: no Sec-Fetch-Site, Origin host differs -> reject', () => {
  const req = reqWith({ origin: 'https://evil.example', host: 'app.example' });
  assert.equal(verifyOrigin(req).ok, false);
});

test('fallback honors x-forwarded-host (proxy / CDN)', () => {
  const req = reqWith({ origin: 'https://app.example', 'x-forwarded-host': 'app.example', host: 'internal:8080' });
  assert.equal(verifyOrigin(req).ok, true);
});

test('no Sec-Fetch-Site and no Origin is allowed (non-browser client)', () => {
  assert.equal(verifyOrigin(reqWith({ host: 'app.example' })).ok, true);
});

test("Origin 'null' (sandboxed iframe) is treated as cross-origin", () => {
  const req = reqWith({ origin: 'null', host: 'app.example' });
  assert.equal(verifyOrigin(req).ok, false);
});

test('readAllowedOrigins reads + filters webjs.allowedOrigins', () => {
  assert.deepEqual(
    readAllowedOrigins({ webjs: { allowedOrigins: ['a.example', 'https://b.example', 1, ''] } }),
    ['a.example', 'https://b.example'],
  );
  assert.deepEqual(readAllowedOrigins({}), []);
  assert.deepEqual(readAllowedOrigins(null), []);
  assert.deepEqual(readAllowedOrigins({ webjs: {} }), []);
});
