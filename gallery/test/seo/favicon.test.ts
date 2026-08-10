import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createRequestHandler } from '@webjsdev/server';
import { testRequest } from '@webjsdev/server/testing';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The gallery served its favicon and linked it nowhere.
 *
 * `app/icon.ts` answered /icon with a real SVG the whole time, but a metadata
 * ROUTE is not auto-linked: the framework emits `<link rel="icon">` only from
 * `metadata.icons` (packages/server/src/ssr.js). The gallery's root layout
 * declared only a title and a description, so the head pointed at nothing, the
 * browser fell back to /favicon.ico, and the gallery ships no such file. Tab
 * showed no mark on gallery.webjs.dev.
 *
 * Each half alone stayed green through that, which is why this asserts BOTH
 * and, critically, that the href the head declares is the URL that answers.
 */

function makeHandler() {
  return createRequestHandler({ appDir, dev: true });
}

test('the home page head declares a favicon', async () => {
  const app = await makeHandler();
  const res = await testRequest(app.handle, '/');
  assert.equal(res.status, 200, 'the home page renders');

  const head = (await res.text()).split('</head>')[0];
  const link = head.match(/<link rel="icon"[^>]*>/);
  assert.ok(link, 'the head emits a <link rel="icon">');
  // A favicon <link> in <body> is ignored by browsers, so landing in the head
  // is the assertion, not merely appearing in the document.
  assert.match(link[0], /href="[^"]*\/icon"/, 'it points at the /icon route');
});

test('the declared favicon URL actually serves an image', async () => {
  const app = await makeHandler();
  const res = await testRequest(app.handle, '/icon');
  assert.equal(res.status, 200, '/icon answers');
  assert.match(
    res.headers.get('content-type') ?? '',
    /^image\//,
    'served as an image, so a browser renders it rather than downloading markup',
  );
});

test('the head links no favicon the app does not serve', async () => {
  // The failure mode this whole file exists for is a head that names a URL
  // nothing answers. Resolve every icon href the layout emits, so a later edit
  // pointing at /public/favicon.svg (which the gallery has never shipped)
  // fails here instead of on a live tab.
  const app = await makeHandler();
  const head = (await (await testRequest(app.handle, '/')).text()).split('</head>')[0];

  // One pattern covering every rel the framework emits from metadata.icons:
  // "icon", "shortcut icon" and "apple-touch-icon" all carry `icon` in the rel.
  const hrefs = [...head.matchAll(/<link rel="[^"]*icon[^"]*"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length > 0, 'at least one icon is declared');

  for (const href of new Set(hrefs)) {
    // absUrl() may have made it absolute; the handler routes on the path.
    const path = href.startsWith('http') ? new URL(href).pathname : href;
    const res = await testRequest(app.handle, path);
    assert.equal(res.status, 200, `${href} is served, not a 404`);
  }
});
