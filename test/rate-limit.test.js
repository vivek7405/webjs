import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { rateLimit, parseWindow, _resetRateLimits } from '../packages/server/src/rate-limit.js';

beforeEach(() => _resetRateLimits());

test('parseWindow handles ms/s/m/h suffixes', () => {
  assert.equal(parseWindow(500), 500);
  assert.equal(parseWindow('250'), 250);
  assert.equal(parseWindow('30s'), 30_000);
  assert.equal(parseWindow('2m'), 120_000);
  assert.equal(parseWindow('1h'), 3_600_000);
  assert.equal(parseWindow('bogus'), 60_000);
});

test('rateLimit allows up to max then 429s with Retry-After', async () => {
  const mw = rateLimit({ window: '1s', max: 2 });
  const req = new Request('http://x/', { headers: { 'x-forwarded-for': '9.9.9.9' } });
  const ok1 = await mw(req, async () => new Response('ok'));
  const ok2 = await mw(req, async () => new Response('ok'));
  const no3 = await mw(req, async () => new Response('ok'));
  assert.equal(ok1.status, 200);
  assert.equal(ok2.status, 200);
  assert.equal(no3.status, 429);
  assert.ok(no3.headers.get('retry-after'));
  assert.equal(no3.headers.get('x-ratelimit-remaining'), '0');
});

test('separate keys get separate buckets', async () => {
  const mw = rateLimit({ window: '1s', max: 1 });
  const reqA = new Request('http://x/', { headers: { 'x-forwarded-for': '1.1.1.1' } });
  const reqB = new Request('http://x/', { headers: { 'x-forwarded-for': '2.2.2.2' } });
  assert.equal((await mw(reqA, async () => new Response())).status, 200);
  assert.equal((await mw(reqB, async () => new Response())).status, 200);
  assert.equal((await mw(reqA, async () => new Response())).status, 429);
  assert.equal((await mw(reqB, async () => new Response())).status, 429);
});

test('custom key function is honoured', async () => {
  const mw = rateLimit({
    window: '1s',
    max: 1,
    key: (req) => req.headers.get('x-user') || 'anon',
  });
  const u1 = new Request('http://x/', { headers: { 'x-user': 'alice' } });
  const u2 = new Request('http://x/', { headers: { 'x-user': 'bob' } });
  assert.equal((await mw(u1, async () => new Response())).status, 200);
  assert.equal((await mw(u2, async () => new Response())).status, 200);
  assert.equal((await mw(u1, async () => new Response())).status, 429);
});

test('passes through x-ratelimit-* headers on the success path', async () => {
  const mw = rateLimit({ window: '1s', max: 5 });
  const req = new Request('http://x/', { headers: { 'x-forwarded-for': '3.3.3.3' } });
  const r = await mw(req, async () => new Response('ok'));
  assert.equal(r.headers.get('x-ratelimit-limit'), '5');
  assert.equal(r.headers.get('x-ratelimit-remaining'), '4');
  assert.ok(r.headers.get('x-ratelimit-reset'));
});

test('defaultKey falls back through cf-connecting-ip, x-real-ip, then `_anon_`', async () => {
  const mw = rateLimit({ window: '1s', max: 1 });
  const cf = new Request('http://x/', { headers: { 'cf-connecting-ip': '4.4.4.4' } });
  const real = new Request('http://x/', { headers: { 'x-real-ip': '5.5.5.5' } });
  const anon = new Request('http://x/');
  // Each hits its own bucket on the first call and 429s on the second.
  assert.equal((await mw(cf, async () => new Response())).status, 200);
  assert.equal((await mw(cf, async () => new Response())).status, 429);
  assert.equal((await mw(real, async () => new Response())).status, 200);
  assert.equal((await mw(real, async () => new Response())).status, 429);
  assert.equal((await mw(anon, async () => new Response())).status, 200);
  assert.equal((await mw(anon, async () => new Response())).status, 429);
});

test('immutable response headers do not throw (catch branch)', async () => {
  // A cross-realm Response can expose immutable headers. Simulate that
  // by returning a Response whose `headers.set` throws.
  const mw = rateLimit({ window: '1s', max: 5 });
  const req = new Request('http://x/', { headers: { 'x-forwarded-for': '8.8.8.8' } });
  const frozenHeaders = new Headers({ 'content-type': 'text/plain' });
  frozenHeaders.set = () => { throw new TypeError('immutable'); };
  const resp = new Response('ok', { headers: {} });
  Object.defineProperty(resp, 'headers', { value: frozenHeaders });
  const out = await mw(req, async () => resp);
  // Middleware swallows the error; pass-through still works.
  assert.equal(out.status, 200);
});

test('static string key acts as a bucket prefix (namespaces IP buckets)', async () => {
  // opts.key as a string prefixes the default IP-derived key — it doesn't
  // collapse all callers into one bucket.
  const mwA = rateLimit({ window: '1s', max: 1, key: 'group-a:' });
  const mwB = rateLimit({ window: '1s', max: 1, key: 'group-b:' });
  const req = new Request('http://x/', { headers: { 'x-forwarded-for': '7.7.7.7' } });
  // Same IP, different prefix → independent buckets.
  assert.equal((await mwA(req, async () => new Response())).status, 200);
  assert.equal((await mwB(req, async () => new Response())).status, 200);
  // Second hit under the same prefix → 429.
  assert.equal((await mwA(req, async () => new Response())).status, 429);
});

test('custom message is surfaced in the 429 body', async () => {
  const mw = rateLimit({ window: '1s', max: 0, message: 'chill out' });
  const req = new Request('http://x/', { headers: { 'x-forwarded-for': '10.10.10.10' } });
  const resp = await mw(req, async () => new Response());
  assert.equal(resp.status, 429);
  assert.deepEqual(await resp.json(), { error: 'chill out' });
});
