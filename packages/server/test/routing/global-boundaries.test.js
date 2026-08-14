/**
 * Integration tests for #848 Gap 3: nested not-found nearest-wins (a behavior
 * FIX: previously only the ROOT not-found rendered), plus root-only
 * global-error / global-not-found boundaries. Driven through the real SSR
 * pipeline. Web-standard Request/Response, no HTTP server.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createRequestHandler } from '../../src/dev.js';
import { buildRouteTable } from '../../src/router.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE = pathToFileURL(resolve(__dirname, '../../../core/index.js')).toString();

let tmpRoot;
before(() => { tmpRoot = mkdtempSync(join(tmpdir(), 'webjs-global-')); });
after(() => { rmSync(tmpRoot, { recursive: true, force: true }); });

function makeApp(files) {
  const appDir = mkdtempSync(join(tmpRoot, 'app-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(appDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return appDir;
}
const pkg = JSON.stringify({ name: 'global-app' });
const page = (fn) => `import { html, notFound } from ${JSON.stringify(CORE)};\n${fn}\n`;
const nf = (text) => `import { html } from ${JSON.stringify(CORE)};\nexport default function NF() { return html\`<main>${text}</main>\`; }\n`;

test('router: global-error / global-not-found are root-only; notFounds project onto pages', async () => {
  const appDir = makeApp({
    'package.json': pkg,
    'app/page.js': page('export default function H() { return html`<main>home</main>`; }'),
    'app/blog/[slug]/page.js': page('export default function P() { notFound(); }'),
    'app/blog/not-found.js': nf('blog 404'),
    'app/not-found.js': nf('root 404'),
    'app/global-error.js': `import { html } from ${JSON.stringify(CORE)};\nexport default function GE() { return html\`<html><body>global error</body></html>\`; }\n`,
    'app/global-not-found.js': nf('global 404'),
  });
  const rt = await buildRouteTable(appDir);
  assert.ok(rt.globalError, 'globalError parsed');
  assert.ok(rt.globalNotFound, 'globalNotFound parsed');
  const blogPage = rt.pages.find((p) => p.routeDir === 'blog/[slug]');
  // nearest-wins chain is outermost -> innermost: [root, blog]
  assert.equal(blogPage.notFounds.length, 2);
  assert.match(blogPage.notFounds[blogPage.notFounds.length - 1], /blog[/\\]not-found/);
});

test('NEAREST-WINS FIX: a nested notFound() renders the nearest not-found, not the root', async () => {
  const appDir = makeApp({
    'package.json': pkg,
    'app/not-found.js': nf('root 404'),
    'app/shop/not-found.js': nf('shop 404'),
    'app/shop/[id]/page.js': page('export default function P() { notFound(); }'),
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/shop/42'));
  assert.equal(resp.status, 404);
  const body = await resp.text();
  // The FIX: nearest (shop) wins. Before #848 this rendered the bare default,
  // ignoring even the root not-found.
  assert.match(body, /shop 404/, 'nearest not-found wins');
  assert.doesNotMatch(body, /root 404/);
});

test('a thrown notFound() with only a ROOT not-found renders it (was the bare default before)', async () => {
  const appDir = makeApp({
    'package.json': pkg,
    'app/not-found.js': nf('root 404 page'),
    'app/deep/[id]/page.js': page('export default function P() { notFound(); }'),
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/deep/1'));
  assert.equal(resp.status, 404);
  assert.match(await resp.text(), /root 404 page/);
});

test('global-not-found renders for an UNMATCHED url when no root not-found exists', async () => {
  const appDir = makeApp({
    'package.json': pkg,
    'app/page.js': page('export default function H() { return html`<main>home</main>`; }'),
    'app/global-not-found.js': nf('nothing here'),
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/does-not-exist'));
  assert.equal(resp.status, 404);
  assert.match(await resp.text(), /nothing here/);
});

test('global-error renders its OWN full document at 500 when a page throws a real error', async () => {
  const appDir = makeApp({
    'package.json': pkg,
    'app/boom/page.js': page('export default function B() { throw new Error("kaboom"); }'),
    'app/global-error.js':
      `import { html } from ${JSON.stringify(CORE)};\n` +
      `export default function GE({ error }) { return html\`<!doctype html><html><body><h1>App crashed</h1></body></html>\`; }\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/boom'));
  assert.equal(resp.status, 500);
  const body = await resp.text();
  assert.match(body, /App crashed/);
  // It rendered its own <html>, returned verbatim (not double-wrapped).
  assert.equal((body.match(/<html/g) || []).length, 1, 'exactly one <html> (no double wrap)');
});

/* ------------ boundary crashes reach the APM sink (#1298) ------------ */

test('an unrouted 404 whose not-found THROWS reaches the onError sink', async () => {
  // The wiring, not the capability: this goes through the real unmatched-URL
  // path in dev/serve.js rather than calling ssrNotFound directly. That path
  // used to build its own options object without the sinks, so a root
  // not-found that crashed reported to the console and nothing else.
  const appDir = makeApp({
    'package.json': pkg,
    'app/page.js': page('export default function H() { return html`<main>home</main>`; }'),
    'app/not-found.js':
      `export default function NF() { throw new Error('ROOT_NF_BOOM'); }\n`,
  });
  const captured = [];
  const app = await createRequestHandler({
    appDir, dev: true, onError: (e) => captured.push(e),
  });
  const prev = console.error;
  console.error = () => {};
  let resp;
  try {
    resp = await app.handle(new Request('http://x/nothing-here'));
  } finally { console.error = prev; }
  assert.equal(resp.status, 404, 'it still answers 404 rather than failing');
  assert.equal(captured.length, 1, 'the crash reached the APM sink through the real path');
  assert.match(String(captured[0].message), /ROOT_NF_BOOM/);
});
