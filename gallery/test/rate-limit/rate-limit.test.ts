import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createRequestHandler } from '@webjsdev/server';
import { testRequest } from '@webjsdev/server/testing';
import type { Handle } from '@webjsdev/server/testing';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const PING = '/features/rate-limit/ping';

// The demo's own numbers, so a change to the middleware that these tests do not
// notice is a change that made them stale rather than one they tolerated.
const MAX = 5;

// Each test picks its own visitor addresses. The limiter counts into the global
// in-memory cache store, which outlives a handler instance, so two tests sharing
// an address would share a bucket and the second would start already exhausted.
// The demo names CF-Connecting-IP, because that is the header carrying the
// visitor on the deployment it runs on. Every request here also carries an
// X-Forwarded-For that DISAGREES, standing in for the CDN egress address the
// real deploy puts there, so a test that passes only because the two agree
// cannot exist.
function ping(handle: Handle, visitor: string, cdnEgress = '172.68.1.9') {
  return testRequest(handle, PING, {
    headers: { 'cf-connecting-ip': visitor, 'x-forwarded-for': cdnEgress },
  });
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

// The half `trustProxy: true` alone did not deliver, and the one the live site
// disproved (#1389). A CDN gives each connection a different egress address, so
// one visitor opening several connections arrives with several X-Forwarded-For
// values and ONE CF-Connecting-IP. Keyed on XFF that visitor gets a fresh bucket
// per connection and is never refused, which is what shipped and read as working.
//
// Counterfactual, proven at this commit: removing `clientIpHeader` from the
// middleware fails this test at the sixth request AND the two-visitor test
// above, while the single-visitor test still passes. The one that survives is
// the one whose requests all carry the same CDN address, which is exactly the
// blind spot that let the first fix look complete on a real deployment.
test('one visitor is limited across connections, whatever CDN address they arrive on', async () => {
  const app = await createRequestHandler({ appDir, dev: true });
  const visitor = '203.0.113.30';

  for (let i = 1; i <= MAX; i += 1) {
    const res = await ping(app.handle, visitor, `172.68.9.${i}`);
    assert.equal(res.status, 200, `request ${i} arrives on its own CDN egress address`);
  }

  const limited = await ping(app.handle, visitor, '172.68.9.99');
  assert.equal(limited.status, 429, 'a new CDN egress address does not buy a new window');
});
