/**
 * docs.webjs.dev stays alive as a redirect-only host (#1098).
 *
 * The docs moved to webjs.dev/docs, but this host can never be retired.
 * Framework error messages in ALREADY-PUBLISHED npm packages point at it
 * (packages/core/src/component.js, packages/server/src/actions.js), and a
 * published version cannot be corrected after the fact, so every install of
 * every old release will keep sending people here for as long as it runs.
 *
 * So the requirement is stronger than "redirect during a migration window":
 * this host must answer forever, and it must answer with the page the visitor
 * actually asked for. A hub-page redirect would technically resolve while
 * still stranding someone who followed a deep link from an error message.
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestHandler } from '@webjsdev/server';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

let handle;

before(async () => {
  const app = await createRequestHandler({ appDir: resolve(ROOT, 'docs'), dev: false });
  await app.warmup?.();
  handle = (path) => app.handle(new Request('http://localhost' + path));
});

test('a deep doc URL redirects to the SAME path on webjs.dev', async () => {
  // The whole point: an error message linking /docs/components must land on
  // the components page, not on a hub the reader has to search again.
  for (const path of ['/docs/components', '/docs/server-actions', '/docs/troubleshooting']) {
    const res = await handle(path);
    assert.equal(res.status, 301, `${path} is a permanent redirect`);
    assert.equal(res.headers.get('location'), `https://webjs.dev${path}`);
  }
});

test('the redirect is permanent, so ranking signal transfers', async () => {
  const res = await handle('/docs/routing');
  assert.equal(res.status, 301, 'a 302 would keep the signal on the dead host');
});

test('a query string survives the redirect', async () => {
  const res = await handle('/docs/routing?utm_source=x');
  assert.equal(res.headers.get('location'), 'https://webjs.dev/docs/routing?utm_source=x');
});

test('a bare visit to the host lands on the docs, not the marketing home', async () => {
  const res = await handle('/');
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), 'https://webjs.dev/docs');
});

test('the machine-readable entrypoints redirect too', async () => {
  for (const path of ['/llms.txt', '/llms-full.txt']) {
    const res = await handle(path);
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('location'), `https://webjs.dev${path}`);
  }
});

test('an unknown path still redirects rather than 404ing', async () => {
  // Path-preserving means the destination decides what is missing, and the
  // destination is the app that actually knows. A 404 here would be a dead
  // end on a host whose only job is to not be a dead end.
  const res = await handle('/whatever/old/path');
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), 'https://webjs.dev/whatever/old/path');
});

test('the readiness probe is exempt, so deploys can still gate on it', async () => {
  // Redirecting /__webjs/ready would fail every healthcheck and the service
  // would never come up, which is the one way to actually break this host.
  const res = await handle('/__webjs/ready');
  assert.ok(res.status < 300, `expected a local 2xx, got ${res.status}`);
});
