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

test('an unrouted 404 stamps its dev frame the way the overlay gate expects', async () => {
  // The browser compares the frame url against `location.pathname +
  // location.search`. A stamp missing the query is refused for any unrouted
  // url carrying one, and the frame is then dropped, so the overlay never
  // paints. This asserts the stamp, which is the half a render test cannot see.
  const appDir = makeApp({
    'package.json': pkg,
    'app/page.js': page('export default function H() { return html`<main>home</main>`; }'),
    'app/not-found.js':
      `export default function NF() { throw new Error('NF_FRAME_BOOM'); }\n`,
  });
  const frames = [];
  const app = await createRequestHandler({
    appDir, dev: true, onDevError: (frame) => frames.push(frame),
  });
  const prev = console.error;
  console.error = () => {};
  try {
    await app.handle(new Request('http://x/missing?page=2'));
  } finally { console.error = prev; }
  assert.equal(frames.length, 1, 'a frame was pushed');
  assert.equal(frames[0].url, '/missing?page=2', 'and it carries the search, as the gate requires');
});

test('a PREFETCH of an unrouted url raises no dev overlay frame (#1047)', async () => {
  // Hovering a link to a broken url must not raise an overlay on the page the
  // user is actually looking at, nor become the frame the SSE replays.
  const appDir = makeApp({
    'package.json': pkg,
    'app/page.js': page('export default function H() { return html`<main>home</main>`; }'),
    'app/not-found.js':
      `export default function NF() { throw new Error('NF_PREFETCH_BOOM'); }\n`,
  });
  const frames = [];
  const errors = [];
  const app = await createRequestHandler({
    appDir, dev: true,
    onDevError: (frame) => frames.push(frame),
    onError: (e) => errors.push(e),
  });
  const prev = console.error;
  console.error = () => {};
  try {
    await app.handle(new Request('http://x/missing', { headers: { 'x-webjs-prefetch': '1' } }));
  } finally { console.error = prev; }
  assert.equal(frames.length, 0, 'no overlay frame from a speculative fetch');
  assert.equal(errors.length, 1, 'but the APM sink still hears about it, since the render really threw');
});

test('a recovered unrouted 404 clears the frame it retained (#1047 supersede)', async () => {
  // An intermittently-failing not-found must not leave a frame that paints
  // over the same url once it renders again. A source edit is cleared by the
  // rebuild; this is the other route in, and it only became reachable once the
  // frame stamp was correct enough for the overlay to accept it.
  const appDir = makeApp({
    'package.json': pkg,
    'app/page.js': page('export default function H() { return html`<main>home</main>`; }'),
    // Fails on the first render of a url, succeeds afterwards.
    // globalThis, not module scope: dev re-imports the module per request with
    // a cache-bust query, so module-level state resets every time.
    'app/not-found.js': `import { html } from ${JSON.stringify(CORE)};
export default function NF() {
  if (!globalThis.__flakyNfSeen) { globalThis.__flakyNfSeen = true; throw new Error('FLAKY_NF_BOOM'); }
  return html\`<main>missing</main>\`;
}
`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const prev = console.error;
  console.error = () => {};
  try {
    const first = await app.handle(new Request('http://x/gone?q=1'));
    assert.equal(first.status, 404);
    const second = await app.handle(new Request('http://x/gone?q=1'));
    assert.equal(second.status, 404);
    assert.match(await second.text(), /missing/, 'the second render succeeded');
  } finally { console.error = prev; }
  // Observed directly, not through a probe endpoint that might not exist: a
  // conditional assertion here would pass whether or not the fix works.
  assert.equal(typeof app.getLastDevError, 'function', 'the handler exposes the retained frame');
  const held = app.getLastDevError();
  assert.equal(held, null, 'no stale frame retained for a url that recovered');
});

test('a PREFETCH that fails again does not wipe a still-current overlay frame', async () => {
  // The clear infers "this render succeeded" from "the retained frame is still
  // the one I captured". A prefetch installs no sink, so a prefetch of a url
  // that throws AGAIN writes no frame and would look exactly like a recovery.
  // The url is still broken; wiping the frame is the #893 gap the retention
  // exists to close.
  const appDir = makeApp({
    'package.json': pkg,
    'app/page.js': page('export default function H() { return html`<main>home</main>`; }'),
    'app/not-found.js':
      `export default function NF() { throw new Error('STILL_BROKEN_NF'); }\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const prev = console.error;
  console.error = () => {};
  try {
    await app.handle(new Request('http://x/gone'));
    const held = app.getLastDevError();
    assert.ok(held, 'the first, real navigation retained a frame');
    assert.match(String(held.url), /\/gone$/);

    // Now hover a link to it. Same url, still broken, speculative.
    await app.handle(new Request('http://x/gone', { headers: { 'x-webjs-prefetch': '1' } }));
  } finally { console.error = prev; }
  const after = app.getLastDevError();
  assert.ok(after, 'the frame survives a prefetch that failed again');
  assert.match(String(after.url), /\/gone$/);
});
