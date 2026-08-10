import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createRequestHandler } from '@webjsdev/server';
import { testRequest } from '@webjsdev/server/testing';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const PING = '/features/rate-limit/ping';

// The demo's own numbers, so a change to the middleware that these tests do not
// notice is a change that made them stale rather than one they tolerated.
const MAX = 5;

// Each test picks its own visitor addresses. The limiter counts into the global
// in-memory cache store, which outlives a handler instance, so two tests sharing
// an address would share a bucket and the second would start already exhausted.
function ping(handle: (req: Request) => Promise<Response>, forwardedFor: string) {
  return testRequest(handle, PING, { headers: { 'x-forwarded-for': forwardedFor } });
}

test('the demo limits one visitor to five requests per window', async () => {
  const app = await createRequestHandler({ appDir, dev: true });
  const visitor = '203.0.113.10';

  for (let i = 1; i <= MAX; i += 1) {
    const res = await ping(app.handle, visitor);
    assert.equal(res.status, 200, `request ${i} is inside the window`);
    assert.equal(res.headers.get('x-ratelimit-remaining'), String(MAX - i));
  }

  const limited = await ping(app.handle, visitor);
  assert.equal(limited.status, 429, 'the sixth request is refused');
  assert.equal(limited.headers.get('retry-after'), '10');
});

// This is the assertion the deployed bug would have failed. Both visitors reach
// the app through the same proxy, so the socket peer is identical for both and a
// peer-keyed limiter would count them into ONE bucket: exhausting the first
// would refuse the second. Keying on the forwarded address keeps them apart.
//
// Counterfactual, proven at this commit: removing `trustProxy: true` from
// gallery/app/features/rate-limit/ping/middleware.ts fails this test on the last
// assertion (the second visitor gets a 429), while the single-visitor test above
// still passes. That asymmetry is the point, since the single-visitor test is
// what a peer-keyed limiter satisfies too.
test('one visitor exhausting the window does not refuse another behind the same proxy', async () => {
  const app = await createRequestHandler({ appDir, dev: true });
  const noisy = '203.0.113.20';
  const bystander = '203.0.113.21';

  for (let i = 0; i < MAX; i += 1) await ping(app.handle, noisy);
  assert.equal((await ping(app.handle, noisy)).status, 429, 'the noisy visitor is limited');

  const other = await ping(app.handle, bystander);
  assert.equal(other.status, 200, 'a different visitor keeps their own window');
  assert.equal(other.headers.get('x-ratelimit-remaining'), String(MAX - 1));
});
