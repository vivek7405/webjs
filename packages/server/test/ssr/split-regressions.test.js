/**
 * Guards for the behaviour changes the #1365 ssr/dev splits introduced while
 * moving code. Every one of these survived a fully green suite, which is the
 * point: the split was reviewed as a move, and nothing asserted the parts of
 * the contract it quietly rewrote.
 *
 * Each test states the defect it would have caught, so a future reader can
 * tell a real failure from a byte-level nit.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRequestHandler } from '../../src/dev.js';
import { escapeAttr, escapeHtml } from '../../src/ssr/escape.js';

let tmpRoot;
before(() => { tmpRoot = mkdtempSync(join(tmpdir(), 'webjs-ssr-split-')); });
after(() => { rmSync(tmpRoot, { recursive: true, force: true }); });

const PKGS = resolve(fileURLToPath(new URL('../../../', import.meta.url)));

function makeApp(files) {
  const appDir = mkdtempSync(join(tmpRoot, 'app-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(appDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  // A fixture that imports `@webjsdev/core` (for notFound) has to resolve it.
  mkdirSync(join(appDir, 'node_modules/@webjsdev'), { recursive: true });
  for (const pkg of ['core', 'server']) {
    try { symlinkSync(join(PKGS, pkg), join(appDir, `node_modules/@webjsdev/${pkg}`)); } catch { /* already linked */ }
  }
  return appDir;
}

test('a 404 does not inherit the page metadata cache-control', async () => {
  // The split passed the merged page metadata to the 404 / 500 builder, which
  // sets cache-control from metadata.cacheControl and has no non-200 guard. An
  // app that marks a visitor-identical layout publicly cacheable would then
  // serve its notFound() 404 publicly cacheable, at the page's own URL.
  const appDir = makeApp({
    'app/layout.ts': `
      export const metadata = { cacheControl: 'public, max-age=600' };
      export default ({ children }) => children;
    `,
    'app/page.ts': `
      import { notFound } from '@webjsdev/core';
      export default () => { notFound(); };
    `,
  });
  const app = await createRequestHandler({ appDir, dev: false });
  await app.warmup();
  const resp = await app.handle(new Request('http://x/'));

  assert.equal(resp.status, 404);
  assert.equal(
    resp.headers.get('cache-control'),
    'no-store',
    'a 404 must never be stored, whatever the page metadata asks for',
  );
});

test('a 200 still honours the page metadata cache-control', async () => {
  // The counterfactual for the test above: the guard must be about the STATUS,
  // not about dropping metadata everywhere.
  const appDir = makeApp({
    'app/layout.ts': `
      export const metadata = { cacheControl: 'public, max-age=600' };
      export default ({ children }) => children;
    `,
    'app/page.ts': `export default () => 'ok';`,
  });
  const app = await createRequestHandler({ appDir, dev: false });
  await app.warmup();
  const resp = await app.handle(new Request('http://x/'));

  assert.equal(resp.status, 200);
  assert.equal(resp.headers.get('cache-control'), 'public, max-age=600');
});

test('the CSP nonce ignores a client-supplied request header', async () => {
  // The split gave getNonce a fallback to an invented `x-webjs-csp-nonce`
  // request header. cspNonce() wins whenever CSP is on, so the fallback only
  // ever fires when the app did NOT ask for a nonce, which is exactly when a
  // client-chosen value must not end up stamped on the boot script.
  const appDir = makeApp({ 'app/page.ts': `export default () => 'ok';` });
  const app = await createRequestHandler({ appDir, dev: false });
  await app.warmup();
  const resp = await app.handle(new Request('http://x/', {
    headers: { 'x-webjs-csp-nonce': 'attacker-chosen' },
  }));
  const html = await resp.text();

  assert.equal(resp.status, 200);
  assert.ok(
    !html.includes('attacker-chosen'),
    'a request header must never reach a nonce attribute',
  );
});

test('a throwing not-found module emits no stack trace in production', async () => {
  // The split rewrote the boundary renderer to emit err.stack with no dev
  // gate, so a broken not-found / forbidden / unauthorized module put a server
  // stack trace on the page for every visitor.
  const appDir = makeApp({
    'app/page.ts': `
      import { notFound } from '@webjsdev/core';
      export default () => { notFound(); };
    `,
    'app/not-found.ts': `export default () => { throw new Error('boundary blew up'); };`,
  });
  const app = await createRequestHandler({ appDir, dev: false });
  await app.warmup();
  const resp = await app.handle(new Request('http://x/'));
  const html = await resp.text();

  assert.equal(resp.status, 404);
  assert.ok(!/\bat\s+\S+:\d+:\d+/.test(html), 'no stack frames in the served HTML');
  assert.ok(!html.includes('/packages/'), 'no server paths in the served HTML');
});

test('the escapers escape what main escaped, and no more', () => {
  // These decide served bytes, so widening them moves every ETag they touch.
  // The split produced three copies and widened two of them to also escape
  // `>`; the head copy serves <title>, every <meta content>, every <link href>
  // and integrity=, so most of the divergence was in the head.
  assert.equal(escapeHtml('a > b'), 'a > b');
  assert.equal(escapeAttr('a > b'), 'a > b');
  assert.equal(escapeHtml('a & <b>'), 'a &amp; &lt;b>');
  assert.equal(escapeAttr('a & "b" <c>'), 'a &amp; &quot;b&quot; &lt;c>');
});

test('the head builder uses those same escapers, not a widened copy', async () => {
  // The regression this catches is a SECOND copy reappearing in head.js: the
  // assertion is on the served bytes, so it fails whether the divergence comes
  // back as a local function or as a different import.
  const appDir = makeApp({
    'app/page.ts': `
      export const metadata = { title: 'a > b', description: 'x > y' };
      export default () => 'ok';
    `,
  });
  const app = await createRequestHandler({ appDir, dev: false });
  await app.warmup();
  const html = await (await app.handle(new Request('http://x/'))).text();

  assert.ok(html.includes('<title>a > b</title>'), 'title keeps a bare >');
  assert.ok(html.includes('content="x > y"'), 'meta content keeps a bare >');
});

test('the app-source id is a real digest, not a stringified promise', async () => {
  // fileByteHash was made async while its only call site interpolated it
  // directly, so every entry became `[object Promise]` and the id stopped
  // changing when app source changed, killing the #899 deploy signal. The
  // branch is production-only, which is why nothing saw it.
  const appDir = makeApp({ 'app/page.ts': `export default () => 'ok';` });
  const app = await createRequestHandler({ appDir, dev: false });
  await app.warmup();
  const src = (await app.handle(new Request('http://x/'))).headers.get('x-webjs-src');

  assert.ok(src, 'a prod response carries the app-source id');
  assert.ok(!src.includes('object Promise'), 'the id is not a stringified promise');
});

test('the app-source id changes when app source changes', async () => {
  // The counterfactual: an id that never changes still satisfies the check
  // above, and a frozen id is precisely the defect.
  const files = { 'app/page.ts': `export default () => 'one';` };
  const a = makeApp(files);
  const appA = await createRequestHandler({ appDir: a, dev: false });
  await appA.warmup();
  const idA = (await appA.handle(new Request('http://x/'))).headers.get('x-webjs-src');

  const b = makeApp({ 'app/page.ts': `export default () => 'two, and rather longer';` });
  const appB = await createRequestHandler({ appDir: b, dev: false });
  await appB.warmup();
  const idB = (await appB.handle(new Request('http://x/'))).headers.get('x-webjs-src');

  assert.notEqual(idA, idB, 'different app source yields a different id');
});
