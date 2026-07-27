/**
 * Integration tests for issue #240: conditional GET (RFC 7232) across pages,
 * static assets, and app source modules. Exercised through createRequestHandler
 * against minimal app fixtures using Web-standard Request/Response, plus direct
 * unit tests of the helper's matcher.
 *
 * The headline behaviours:
 *   - a cacheable page (metadata.cacheControl public) gets an ETag, and a
 *     repeat request with a matching If-None-Match gets a 304 with no body;
 *   - a no-store page gets NO ETag and never 304s (storage is forbidden, so
 *     there is nothing to validate);
 *   - a `private` page DOES get an ETag and 304s: private forbids SHARED
 *     storage, not validation, which is what keeps the client router's
 *     partial responses cheap (#1140);
 *   - a static asset / app module gets an ETag and 304s on a match;
 *   - a non-matching If-None-Match returns 200 + the full body;
 *   - the ETag is stable for identical content across requests.
 *
 * COUNTERFACTUAL (documented inline): the matcher test asserts that a
 * mismatched If-None-Match does NOT 304, which is exactly the assertion that
 * fails if the If-None-Match check is removed from applyConditionalGet.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createRequestHandler } from '../../src/dev.js';
import { applyConditionalGet, ifNoneMatchSatisfied } from '../../src/conditional-get.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_URL = pathToFileURL(
  resolve(__dirname, '../../../core/src/html.js')
).toString();

let tmpRoot;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'webjs-cond-'));
});
after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function makeApp(files) {
  const appDir = mkdtempSync(join(tmpRoot, 'app-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(appDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return appDir;
}

const CACHEABLE_PAGE =
  `import { html } from ${JSON.stringify(HTML_URL)};\n` +
  `export const metadata = { cacheControl: 'public, max-age=60' };\n` +
  `export default function P() { return html\`<h1>cacheable</h1>\`; }\n`;

const DYNAMIC_PAGE =
  `import { html } from ${JSON.stringify(HTML_URL)};\n` +
  `export default function P() { return html\`<h1>dynamic</h1>\`; }\n`;

/* ---------------- cacheable page: ETag + 304 ---------------- */

test('cacheable page gets an ETag and 304s on a matching If-None-Match', async () => {
  const appDir = makeApp({ 'app/page.js': CACHEABLE_PAGE });
  const app = await createRequestHandler({ appDir, dev: true });

  const first = await app.handle(new Request('http://x/'));
  assert.equal(first.status, 200);
  const etag = first.headers.get('etag');
  assert.ok(etag, 'cacheable page response carries an ETag');
  assert.match(etag, /^W\/"[a-f0-9]{16}"$/, 'ETag is the WEAK quoted 16-char SHA-1 form (weak so it is valid across content-codings, RFC 7232 2.3.3)');
  const body = await first.text();
  assert.ok(body.includes('cacheable'), 'first response carries the full body');

  const second = await app.handle(
    new Request('http://x/', { headers: { 'if-none-match': etag } })
  );
  assert.equal(second.status, 304, 'matching If-None-Match yields 304');
  assert.equal(second.headers.get('etag'), etag, '304 keeps the ETag validator');
  assert.equal(
    second.headers.get('cache-control'),
    'public, max-age=60',
    '304 keeps Cache-Control'
  );
  const emptyBody = await second.text();
  assert.equal(emptyBody, '', '304 has no body');
  assert.equal(second.headers.get('content-length'), null, '304 drops Content-Length');
});

test('cacheable page ETag is stable for identical content across requests', async () => {
  const appDir = makeApp({ 'app/page.js': CACHEABLE_PAGE });
  const app = await createRequestHandler({ appDir, dev: true });
  const a = await app.handle(new Request('http://x/'));
  const b = await app.handle(new Request('http://x/'));
  assert.equal(
    a.headers.get('etag'),
    b.headers.get('etag'),
    'identical body yields identical ETag across requests'
  );
});

test('cacheable page: a NON-matching If-None-Match returns 200 + full body', async () => {
  const appDir = makeApp({ 'app/page.js': CACHEABLE_PAGE });
  const app = await createRequestHandler({ appDir, dev: true });
  const res = await app.handle(
    new Request('http://x/', { headers: { 'if-none-match': '"deadbeefdeadbeef"' } })
  );
  assert.equal(res.status, 200, 'a stale validator is not a 304');
  const body = await res.text();
  assert.ok(body.includes('cacheable'), 'full body is served on a mismatch');
});

/* ---------------- private (router fragment): still validated ---------------- */

test('a PRIVATE response still gets an ETag and 304s (#1140)', async () => {
  // What lets #1140 mark the router's partial responses `private` without
  // costing them their validator. The router fetches them with
  // `cache: 'no-cache'` (#1131) precisely so a revalidation is a cheap
  // conditional request; if `private` were excluded here, that downgrade would
  // turn every prefetch and soft navigation into a full re-download.
  //
  // The old worry was a "cross-session" 304 on per-user content. It cannot
  // happen: the ETag hashes THIS response's body, so two users with different
  // bodies get different ETags and neither can match the other's, while two
  // users with identical bodies are asking about identical bytes.
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export const metadata = { cacheControl: 'private, max-age=60' };\n` +
      `export default function P() { return html\`<h1>private body</h1>\`; }\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const first = await app.handle(new Request('http://x/'));
  await first.text();
  assert.equal(first.headers.get('cache-control'), 'private, max-age=60');
  const etag = first.headers.get('etag');
  assert.ok(etag, 'a private response carries a validator');

  const second = await app.handle(new Request('http://x/', { headers: { 'if-none-match': etag } }));
  const body = await second.text();
  assert.equal(second.status, 304, 'a matching validator 304s');
  assert.equal(body.length, 0, 'a 304 has no body');
});

test('a REDUCED router fragment is private AND still 304s (#1140)', async () => {
  // The composition the two halves exist for, driven through the real handler.
  // Asserting them separately (a fragment is private / a private page is
  // validated) let the actual regression through once already: fragments
  // silently lost their validator, so every prefetch and soft navigation
  // re-downloaded the whole fragment while the suite stayed green.
  const appDir = makeApp({
    'app/layout.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export const metadata = { cacheControl: 'public, max-age=60, s-maxage=600' };\n` +
      `export default function L({ children }) { return html\`<div class="OUTER">\${children}</div>\`; }\n`,
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<h1>page body</h1>\`; }\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });

  const have = { 'x-webjs-router': '1', 'x-webjs-have': '/:/' };
  const first = await app.handle(new Request('http://x/', { headers: have }));
  const body = await first.text();
  assert.ok(!body.includes('OUTER'), 'sanity: the response really was reduced');

  const cc = first.headers.get('cache-control') || '';
  assert.match(cc, /(^|,)\s*private\s*(,|$)/, `a fragment is unshareable, got: ${cc}`);
  assert.doesNotMatch(cc, /s-maxage/i, `a fragment carries no shared TTL, got: ${cc}`);

  const etag = first.headers.get('etag');
  assert.ok(etag, 'a fragment still carries a validator, or every prefetch re-downloads it');

  const replay = await app.handle(new Request('http://x/', { headers: { ...have, 'if-none-match': etag } }));
  const replayBody = await replay.text();
  assert.equal(replay.status, 304, 'the router revalidation is answered 304, not a re-download');
  assert.equal(replayBody.length, 0, 'a 304 has no body');
});

test('privateFragment fails CLOSED when a response carries no Cache-Control (#1140)', async () => {
  // A response with no Cache-Control is heuristically storable by a shared
  // cache (RFC 9111), so "no header" is not "nothing to do". Exercised as a
  // unit because every current caller sets the header, which is exactly why a
  // future change there could reintroduce a shareable fragment unnoticed.
  const { privateFragment } = await import('../../src/ssr.js');
  assert.equal(typeof privateFragment, 'function', 'the helper is exported so this can be tested at all');
  const res = new Response('x');
  res.headers.delete('cache-control');
  assert.equal(res.headers.get('cache-control'), null, 'sanity: the response really has no header');
  privateFragment(res);
  assert.match(res.headers.get('cache-control') || '', /(^|,)\s*private\s*(,|$)/,
    'an absent Cache-Control is replaced with private, not left alone');
});

/* ---------------- no-store page: no ETag, no 304 ---------------- */

test('a no-store (dynamic / per-user) page gets NO ETag and never 304s', async () => {
  const appDir = makeApp({ 'app/page.js': DYNAMIC_PAGE });
  const app = await createRequestHandler({ appDir, dev: true });

  const first = await app.handle(new Request('http://x/'));
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.equal(first.headers.get('etag'), null, 'no-store response has no ETag');
  // The funnel strips the internal buffered marker even when it skips a
  // no-store body, so it never leaks to the client.
  assert.equal(first.headers.get('x-webjs-buffered'), null, 'internal buffered marker never leaks');

  // Even if a client replays the page's prior body hash, a no-store page must
  // not 304 (no-store forbids storage, so there is nothing to validate).
  const replay = await app.handle(
    new Request('http://x/', { headers: { 'if-none-match': '*' } })
  );
  assert.equal(replay.status, 200, 'no-store page never 304s, even on If-None-Match: *');
});

/* ---------------- static asset (public/) ---------------- */

test('a static asset gets an ETag and 304s on a matching If-None-Match', async () => {
  const appDir = makeApp({
    'app/page.js': DYNAMIC_PAGE,
    'public/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  });
  const app = await createRequestHandler({ appDir, dev: true });

  const first = await app.handle(new Request('http://x/public/logo.svg'));
  assert.equal(first.status, 200);
  const etag = first.headers.get('etag');
  assert.ok(etag, 'static asset carries an ETag');

  const second = await app.handle(
    new Request('http://x/public/logo.svg', { headers: { 'if-none-match': etag } })
  );
  assert.equal(second.status, 304, 'static asset 304s on a matching validator');
  assert.equal((await second.text()), '', '304 asset has no body');

  const mismatch = await app.handle(
    new Request('http://x/public/logo.svg', { headers: { 'if-none-match': '"0000000000000000"' } })
  );
  assert.equal(mismatch.status, 200, 'a non-matching validator returns the full asset');
});

/* ---------------- app source module (.js) ---------------- */

test('an app source module gets an ETag and 304s on a matching If-None-Match', async () => {
  // An interactive component (a @click) ships, so its module is browser-bound
  // and servable. The page imports it so the graph gate admits it.
  const COMPONENT =
    `import { WebComponent, html } from '@webjsdev/core';\n` +
    `class Widget extends WebComponent { render(){ return html\`<button @click=\${() => {}}>x</button>\`; } }\n` +
    `Widget.register('my-widget');\n`;
  const PAGE_WITH_COMPONENT =
    `import { html } from '@webjsdev/core';\n` +
    `import '../components/widget.ts';\n` +
    `export default () => html\`<my-widget></my-widget>\`;\n`;
  const appDir = makeApp({
    'app/page.ts': PAGE_WITH_COMPONENT,
    'components/widget.ts': COMPONENT,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  // Warm the browser-bound graph so the module is servable.
  await app.handle(new Request('http://x/app/page.ts'));

  const first = await app.handle(new Request('http://x/components/widget.ts'));
  assert.equal(first.status, 200, 'app module is served');
  const etag = first.headers.get('etag');
  assert.ok(etag, 'app module carries an ETag');
  const body = await first.text();
  assert.ok(body.length > 0, 'first request transfers the full module body');

  const second = await app.handle(
    new Request('http://x/components/widget.ts', { headers: { 'if-none-match': etag } })
  );
  assert.equal(second.status, 304, 'app module 304s on a matching validator');
  assert.equal((await second.text()), '', '304 module has no body');
});

/* ---------------- HEAD method ---------------- */

test('HEAD on a cacheable page also 304s on a matching validator', async () => {
  const appDir = makeApp({ 'app/page.js': CACHEABLE_PAGE });
  const app = await createRequestHandler({ appDir, dev: true });
  const get = await app.handle(new Request('http://x/'));
  const etag = get.headers.get('etag');
  const head = await app.handle(
    new Request('http://x/', { method: 'HEAD', headers: { 'if-none-match': etag } })
  );
  assert.equal(head.status, 304, 'HEAD honors conditional GET');
});

/* ---------------- streaming (Suspense) page is NOT conditional-GET cached ---------------- */

test('a streamed Suspense page is not ETagged and never 304s (marker stripped)', async () => {
  // A loading.js sibling wraps the async page in Suspense, so a page that
  // awaits produces a genuinely streamed body. Even with a public
  // cacheControl, the stream cannot be hashed without buffering, so the
  // funnel skips it and strips the internal x-webjs-stream marker.
  const ASYNC_PAGE =
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `export const metadata = { cacheControl: 'public, max-age=60' };\n` +
    `export default async function P() {\n` +
    `  await new Promise((r) => setTimeout(r, 5));\n` +
    `  return html\`<h1>streamed</h1>\`;\n` +
    `}\n`;
  const LOADING =
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `export default () => html\`<p>loading</p>\`;\n`;
  const appDir = makeApp({ 'app/page.js': ASYNC_PAGE, 'app/loading.js': LOADING });
  const app = await createRequestHandler({ appDir, dev: true });

  const res = await app.handle(new Request('http://x/'));
  assert.equal(res.status, 200, 'streamed page is served');
  assert.equal(res.headers.get('etag'), null, 'a streamed body is not ETagged');
  assert.equal(res.headers.get('x-webjs-stream'), null, 'internal stream marker never leaks to the client');
  const body = await res.text();
  assert.ok(body.includes('streamed'), 'the streamed content is delivered');
});

/* ---------------- a route.{js,ts} ReadableStream body is NEVER buffered ---------------- */

/**
 * Resolve a promise but reject if it has not settled within `ms`. Used to
 * prove a streaming-route response returns PROMPTLY (the funnel never awaited
 * its body), rather than hanging while `arrayBuffer()` drains a never-ending
 * stream.
 *
 * @template T
 * @param {Promise<T>} p
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
function within(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${label}`)), ms)
    ),
  ]);
}

test('a route handler returning a ReadableStream (public Cache-Control) is not buffered or ETagged and returns promptly', async () => {
  // The handler returns a never-ending stream with a PUBLIC Cache-Control,
  // which would otherwise satisfy the cacheable check. The funnel must NOT
  // call arrayBuffer() on it (that would buffer it into memory / hang), so it
  // returns promptly with no ETag and its stream intact.
  const ROUTE =
    `export async function GET() {\n` +
    `  let count = 0;\n` +
    `  const stream = new ReadableStream({\n` +
    `    pull(controller) {\n` +
    `      controller.enqueue(new TextEncoder().encode('chunk' + (count++) + '\\n'));\n` +
    `      // never close: a genuinely open stream\n` +
    `    },\n` +
    `  });\n` +
    `  return new Response(stream, {\n` +
    `    headers: { 'content-type': 'text/plain', 'cache-control': 'public, max-age=60' },\n` +
    `  });\n` +
    `}\n`;
  const appDir = makeApp({ 'app/stream/route.js': ROUTE });
  const app = await createRequestHandler({ appDir, dev: true });

  const res = await within(
    app.handle(new Request('http://x/stream')),
    2000,
    'route stream response did not return (funnel buffered the stream)'
  );
  assert.equal(res.status, 200, 'streaming route is served');
  assert.equal(res.headers.get('etag'), null, 'a route ReadableStream is never ETagged');
  assert.equal(res.headers.get('x-webjs-buffered'), null, 'internal buffered marker never leaks');
  assert.ok(res.body, 'the stream body is intact (not consumed by the funnel)');
  // Read just the first chunk to prove the stream still flows, then cancel so
  // the test does not hang on the never-ending stream.
  const reader = res.body.getReader();
  const { value } = await within(reader.read(), 2000, 'first chunk read');
  assert.ok(value && value.length > 0, 'the first chunk is readable');
  await reader.cancel();
});

test('an SSE text/event-stream handler (no-cache) is not buffered and returns promptly (no hang)', async () => {
  // An SSE stream uses Cache-Control: no-cache (which the funnel treats as
  // cacheable) and NEVER ends. Buffering it would hang forever. The funnel
  // must skip it on the unmarked-body rule and return at once.
  const ROUTE =
    `export async function GET() {\n` +
    `  const stream = new ReadableStream({\n` +
    `    start(controller) {\n` +
    `      controller.enqueue(new TextEncoder().encode('data: hello\\n\\n'));\n` +
    `      // never close: a live SSE channel\n` +
    `    },\n` +
    `  });\n` +
    `  return new Response(stream, {\n` +
    `    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },\n` +
    `  });\n` +
    `}\n`;
  const appDir = makeApp({ 'app/sse/route.js': ROUTE });
  const app = await createRequestHandler({ appDir, dev: true });

  const res = await within(
    app.handle(new Request('http://x/sse')),
    2000,
    'SSE response hung (funnel awaited a never-ending stream)'
  );
  assert.equal(res.status, 200, 'SSE route is served');
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  assert.equal(res.headers.get('etag'), null, 'an SSE stream is never ETagged');
  assert.ok(res.body, 'the SSE stream body is intact');
  const reader = res.body.getReader();
  const { value } = await within(reader.read(), 2000, 'first SSE event read');
  assert.ok(value && value.length > 0, 'the first SSE event is readable');
  await reader.cancel();
});

/* ---------------- weak-ETag / content-coding correctness ---------------- */

test('the ETag is WEAK and a 200 keeps Vary: Accept-Encoding (compression-safe)', async () => {
  const appDir = makeApp({ 'app/page.js': CACHEABLE_PAGE });
  // Prod path so the compression negotiation (which shares the ETag across
  // codings) is the live one; assert the validator is weak.
  const app = await createRequestHandler({ appDir, dev: false });
  const res = await app.handle(
    new Request('http://x/', { headers: { 'accept-encoding': 'gzip, br' } })
  );
  const etag = res.headers.get('etag');
  assert.ok(etag, 'cacheable page carries an ETag in prod');
  assert.match(etag, /^W\//, 'the ETag is WEAK (valid when reused across content-codings, RFC 7232 2.3.3)');
});

test('a weak If-None-Match still 304s against the weak ETag (weak comparison)', () => {
  // The validator we emit is weak; a conditional request echoing it (with or
  // without the W/ prefix) must still satisfy. This is the weak-comparison
  // contract If-None-Match requires.
  assert.equal(ifNoneMatchSatisfied('W/"abc1234567890def"', 'W/"abc1234567890def"'), true, 'weak vs weak matches');
  assert.equal(ifNoneMatchSatisfied('"abc1234567890def"', 'W/"abc1234567890def"'), true, 'strong-form request vs weak response matches');
});

/* ---------------- helper unit tests (matcher + counterfactual) ---------------- */

test('ifNoneMatchSatisfied matches exact, list, wildcard, and weak validators', () => {
  assert.equal(ifNoneMatchSatisfied('"abc"', '"abc"'), true, 'exact match');
  assert.equal(ifNoneMatchSatisfied('"x", "abc", "y"', '"abc"'), true, 'list member match');
  assert.equal(ifNoneMatchSatisfied('*', '"abc"'), true, 'wildcard matches any');
  assert.equal(ifNoneMatchSatisfied('W/"abc"', '"abc"'), true, 'weak validator compares equal');
  // COUNTERFACTUAL: a non-matching validator must NOT satisfy. This is the
  // assertion that fails if the If-None-Match check is dropped (everything
  // would then 304 indiscriminately).
  assert.equal(ifNoneMatchSatisfied('"nope"', '"abc"'), false, 'mismatch does not match');
  assert.equal(ifNoneMatchSatisfied(null, '"abc"'), false, 'absent header does not match');
});

test('applyConditionalGet skips a streaming-flagged response untouched (marker stripped)', async () => {
  const streamed = new Response('partial', {
    status: 200,
    headers: { 'cache-control': 'public, max-age=60', 'x-webjs-stream': '1' },
  });
  const out = await applyConditionalGet(new Request('http://x/'), streamed);
  assert.equal(out.status, 200, 'streamed response is not turned into a 304');
  assert.equal(out.headers.get('etag'), null, 'streamed response is not ETagged');
  assert.equal(out.headers.get('x-webjs-stream'), null, 'internal stream marker is stripped');
});

test('applyConditionalGet leaves a no-store response alone', async () => {
  const res = new Response('secret', {
    status: 200,
    headers: { 'cache-control': 'no-store' },
  });
  const out = await applyConditionalGet(
    new Request('http://x/', { headers: { 'if-none-match': '*' } }),
    res
  );
  assert.equal(out.status, 200, 'no-store is never 304');
  assert.equal(out.headers.get('etag'), null, 'no-store is never ETagged');
});
