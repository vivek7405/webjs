/**
 * Integration test for the /docs/migrating-from-nextjs page (#273). Boots the
 * docs app via createRequestHandler (prod) and asserts the page serves, states
 * the no-RSC execution model and the .server boundary, carries the concept-map
 * table mapping the required Next idioms, includes a before/after sample, is in
 * the nav, and is cross-linked from getting-started and architecture.
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

test('/docs/migrating-from-nextjs serves and maps the required Next idioms', async () => {
  const res = await handle('/docs/migrating-from-nextjs');
  assert.equal(res.status, 200, 'the migration page serves');
  const html = await res.text();

  // The no-RSC execution model + the .server boundary are stated explicitly.
  assert.ok(/no server\/client component split|no RSC|React Server Components/i.test(html), 'states the no-RSC model');
  assert.ok(/\.server/.test(html), 'states the .server boundary');

  // The concept map covers each required Next idiom.
  for (const idiom of [
    'use client',
    'use server',
    'next/link',
    'next/image',
    'getServerSideProps',
    'generateStaticParams',
    'middleware',
  ]) {
    assert.ok(html.includes(idiom), `concept map must mention ${idiom}`);
  }

  // A before/after code sample (a Next page and its webjs equivalent).
  assert.ok(/Next\.js\)/.test(html) && /webjs:/.test(html), 'has a before/after sample');
});

test('the migration page is in the nav and cross-linked from getting-started and architecture', async () => {
  for (const from of ['/docs/getting-started', '/docs/architecture']) {
    const res = await handle(from);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(
      /href="\/docs\/migrating-from-nextjs"/.test(html),
      `${from} must link the migration guide`,
    );
  }
});
