/**
 * Integration test for the deployment-doc secrets posture (#270). Boots the
 * docs app via createRequestHandler (prod) and asserts the /docs/deployment
 * page documents the standard platform-injection posture the issue requires:
 * never commit .env, inject production secrets via the host platform's secret
 * store, .env is local-dev only, and rotate AUTH_SECRET. Also guards the
 * Dockerfile Node-version fix (webjs needs Node 24+).
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestHandler } from '@webjsdev/server';

const __dirname = dirname(fileURLToPath(import.meta.url));
// The docs are served by the marketing app at webjs.dev/docs.
const DOCS_DIR = resolve(__dirname, '..', '..', 'website');

/** @type {(path: string) => Promise<Response>} */
let handle;

before(async () => {
  const app = await createRequestHandler({ appDir: DOCS_DIR, dev: false });
  handle = (path) => app.handle(new Request('http://localhost' + path));
});

test('the deployment page documents the secrets posture', async () => {
  const res = await handle('/docs/deployment');
  assert.equal(res.status, 200);
  const html = await res.text();

  assert.ok(html.includes('Never commit'), 'states never to commit .env');
  assert.ok(/secret store/i.test(html), 'documents platform secret-store injection');
  assert.ok(/local development only/i.test(html), 'documents .env as local-dev only');
  assert.ok(/[Rr]otate/.test(html) && html.includes('AUTH_SECRET'), 'documents AUTH_SECRET rotation');
  // Platform examples are named.
  assert.ok(/Railway|Fly|Render/.test(html), 'names platform secret stores');
  assert.ok(/secrets/i.test(html) && /Docker/.test(html), 'covers Docker / Compose secrets');
});

test('the example Dockerfile pins a supported Node version (24+)', async () => {
  const res = await handle('/docs/deployment');
  const html = await res.text();
  // webjs requires Node 24+ for the built-in TS strip; an older base image
  // would fail at boot, so the doc must not show node:23.
  assert.ok(!html.includes('node:23'), 'the Dockerfile must not pin node:23 (webjs needs 24+)');
  assert.ok(/node:24/.test(html), 'the Dockerfile pins node:24');
});
