/**
 * The caching contract end to end (#1127): the served page must carry a
 * browser-reusable Cache-Control, an ETag, and answer a matching
 * If-None-Match with an empty 304.
 *
 * This is the test of record for the whole fix, through the real request
 * pipeline rather than renderToString. It fails on either regression path:
 *
 * - Revert the header to `max-age=0` (or to `no-store`) and the max-age
 *   assertion fails. Nothing else in the suite reads the header, so without
 *   this a one-line revert of the fix ships green.
 * - Reintroduce any per-render nondeterminism (the copy-cmd counter class)
 *   and the replay fails: the second render hashes to a different ETag, the
 *   recorded validator no longer matches, and the expected 304 comes back
 *   200 with a full body, which is exactly how the bug presented in
 *   production. render-determinism.test.ts diagnoses that failure precisely;
 *   this test proves its consequence at the HTTP layer.
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestHandler } from '@webjsdev/server';

const WEBSITE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

let handle: (path: string, headers?: Record<string, string>) => Promise<Response>;

before(async () => {
  const app = await createRequestHandler({ appDir: WEBSITE_ROOT, dev: false });
  await app.warmup?.();
  handle = async (path, headers = {}) => app.handle(new Request('http://localhost' + path, { headers }));
});

for (const route of ['/', '/docs/getting-started']) {
  test(`${route} is browser-cacheable and revalidates to an empty 304`, async () => {
    const first = await handle(route);
    assert.equal(first.status, 200);

    const cc = first.headers.get('cache-control') || '';
    const maxAge = Number(/(?:^|,)\s*max-age=(\d+)/.exec(cc)?.[1] ?? NaN);
    assert.ok(maxAge > 0,
      `max-age must be positive for the browser to ever reuse a stored copy, got: ${cc}`);
    // Only `no-store` opts a page out of the ETag path; `private` is validated
    // normally (#1140), so asserting against it here would over-constrain the
    // site (a `private, max-age=60` page would still 304 correctly).
    assert.ok(!/no-store/.test(cc),
      `a no-store value opts the page out of the ETag path entirely, got: ${cc}`);

    const etag = first.headers.get('etag');
    assert.ok(etag, 'a cacheable 200 carries a validator');

    const replay = await handle(route, { 'if-none-match': etag! });
    assert.equal(replay.status, 304,
      'replaying the ETag must revalidate; a 200 here means consecutive renders '
      + 'hash differently (see render-determinism.test.ts for the exact divergence)');
    assert.equal((await replay.text()).length, 0, 'a 304 has no body');
    assert.equal(replay.headers.get('etag'), etag, 'the validator survives the 304');
  });
}
