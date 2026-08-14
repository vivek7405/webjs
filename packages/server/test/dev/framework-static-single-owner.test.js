/**
 * The framework's own static assets have exactly ONE implementation each.
 *
 * `tryServeFrameworkStatic` is called from two places: the early
 * pre-`ensureReady()` path in `handle()`, and the `handleCore` fallback. The
 * fallback exists on purpose. Its comment promises it "covers the (currently
 * unreachable) case of handleCore being entered for one of those assets, so the
 * routing stays correct if a future caller bypasses the early path."
 *
 * The #1365 split briefly broke that promise: the two reload assets were
 * reimplemented inline at the early call site and dropped from the shared
 * helper, so the fallback would have fallen through to app routing and 404'd
 * the live-reload client. Unreachable at the time, which is exactly why nothing
 * caught it, and exactly why it is pinned here now.
 *
 * These assertions call the HELPER directly rather than going through
 * `handle()`, because a request-level test passes either way: the early path
 * serves the asset whether or not the helper knows about it. Only a direct call
 * can tell the two apart.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tryServeFrameworkStatic } from '../../src/dev/serve.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const coreDir = join(__dirname, '../../../core');

const RELOAD_ASSETS = ['/__webjs/reload.js', '/__webjs/reload-worker.js'];

for (const path of RELOAD_ASSETS) {
  test(`the shared helper serves ${path} in dev`, async () => {
    const appDir = mkdtempSync(join(tmpdir(), 'webjs-fwstatic-'));
    try {
      const resp = await tryServeFrameworkStatic(path, 'GET', {
        coreDir, appDir, dev: true, versioned: false,
      });
      assert.ok(
        resp,
        `${path} must be served by the helper, not only by the early inline path. `
        + 'A null here means the handleCore fallback would route it as an app url.',
      );
      assert.equal(resp.status, 200);
      assert.equal(
        resp.headers.get('content-type'),
        'application/javascript; charset=utf-8',
      );
      assert.ok((await resp.text()).length > 0, 'the reload source must not be empty');
    } finally {
      rmSync(appDir, { recursive: true, force: true });
    }
  });

  test(`the shared helper 404s ${path} in prod`, async () => {
    const appDir = mkdtempSync(join(tmpdir(), 'webjs-fwstatic-'));
    try {
      const resp = await tryServeFrameworkStatic(path, 'GET', {
        coreDir, appDir, dev: false, versioned: false,
      });
      // A 404 Response, NOT null: the path is dead in production rather than
      // falling through to be routed like an app url.
      assert.ok(resp, `${path} must return a Response in prod, not fall through`);
      assert.equal(resp.status, 404);
    } finally {
      rmSync(appDir, { recursive: true, force: true });
    }
  });
}

test('the reload assets are implemented in exactly one place', async () => {
  // The counterfactual for the test above: it would still pass if the inline
  // copy were restored alongside the helper's, which is the duplication that
  // let the two drift in the first place. `handler.js` must not carry its own.
  const { readFileSync } = await import('node:fs');
  const handler = readFileSync(join(__dirname, '../../src/dev/handler.js'), 'utf8');
  for (const path of RELOAD_ASSETS) {
    assert.equal(
      handler.includes(`'${path}'`), false,
      `dev/handler.js must not match ${path} itself; it reaches the asset through `
      + 'tryServeFrameworkStatic so there is one implementation, not two.',
    );
  }
});
