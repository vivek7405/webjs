/**
 * Integration test for the /docs/troubleshooting page (#275): the symptom-keyed
 * error reference. Boots the docs app via createRequestHandler (prod) and
 * asserts the page serves, is in the sidebar nav, and covers at least the five
 * distinctive failure signatures the issue requires (throw-at-load server
 * import, backtick-in-template 500, TypeScript strip failure, SSR browser-global
 * crash, missing-frame swap), each linking the relevant check rule / doc page.
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

test('/docs/troubleshooting serves and covers the required failure signatures', async () => {
  const res = await handle('/docs/troubleshooting');
  assert.equal(res.status, 200, 'the troubleshooting page serves');
  const html = await res.text();

  // The five required symptoms (by a distinctive phrase from each).
  for (const needle of [
    'server-only', // throw-at-load server-util import
    'backtick', // backtick-in-template 500
    'no-non-erasable-typescript', // TypeScript strip failure + its check rule
    'no-browser-globals-in-render', // SSR browser-global crash + its check rule
    'webjs:frame-missing', // missing-frame swap
  ]) {
    assert.ok(html.includes(needle), `troubleshooting page must cover ${needle}`);
  }

  // It points back at webjs check (the ahead-of-time guard).
  assert.ok(html.includes('webjs check'), 'page references webjs check');
});

test('the troubleshooting page is registered in the sidebar nav', async () => {
  const res = await handle('/docs/getting-started');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(
    /href="\/docs\/troubleshooting"/.test(html),
    'the sidebar nav must contain a link to /docs/troubleshooting',
  );
});
