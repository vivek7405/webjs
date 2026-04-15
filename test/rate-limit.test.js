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
