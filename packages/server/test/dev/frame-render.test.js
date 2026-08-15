/**
 * Tests for issue #253: the server-side `<webjs-frame>` subtree render.
 *
 * When a `<webjs-frame src>` self-loads (or a click drives a frame nav) the
 * client sends `x-webjs-frame: <id>` and applies ONLY the matching
 * `<webjs-frame id>` subtree from the response. The server reads that header
 * and, for an isolable route (the requested frame is in the rendered output),
 * returns JUST that subtree instead of the whole page, byte-equivalent by
 * construction to what the client would slice from a full-page render.
 *
 * Headline behaviours:
 *   - a request WITH `x-webjs-frame: <id>` to a page containing that frame
 *     returns ONLY the frame subtree (NOT the full page), and that subtree is
 *     byte-equivalent to extracting the same frame from the full-page render.
 *   - a request whose frame id is ABSENT falls back to the full page.
 *   - a request with NO `x-webjs-frame` header is byte-identical to before this
 *     feature (the differential guard).
 *
 * Exercised through createRequestHandler against minimal app fixtures using
 * Web-standard Request/Response, plus direct unit tests of the extractor.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createRequestHandler } from '../../src/dev.js';
import { extractFrameSubtree, requestedFrameId } from '../../src/frame-render.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_URL = pathToFileURL(
  resolve(__dirname, '../../../core/src/html.js')
).toString();
const FRAME_URL = pathToFileURL(
  resolve(__dirname, '../../../core/src/webjs-frame.js')
).toString();

let tmpRoot;
before(() => { tmpRoot = mkdtempSync(join(tmpdir(), 'webjs-framerender-')); });
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

// A page rendering surrounding chrome plus a <webjs-frame id="rail"> with
// identifiable content, so we can prove the frame-only response contains the
// frame and NOT the surrounding chrome.
function framePage() {
  return (
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `import ${JSON.stringify(FRAME_URL)};\n` +
    `export default function P() {\n` +
    `  return html\`<main><h1 id="chrome">PAGE CHROME</h1>\n` +
    `    <webjs-frame id="rail"><span id="rail-body">RAIL CONTENT</span></webjs-frame>\n` +
    `  </main>\`;\n` +
    `}\n`
  );
}

/* ---------------- the isolable frame-only render ---------------- */

test('a request with x-webjs-frame returns ONLY the frame subtree, not the full page', async () => {
  const appDir = makeApp({ 'app/page.js': framePage() });
  const app = await createRequestHandler({ appDir, dev: true });

  const res = await app.handle(new Request('http://x/', {
    headers: { 'x-webjs-frame': 'rail' },
  }));
  assert.equal(res.status, 200);
  const body = await res.text();

  // The frame subtree is present...
  assert.ok(body.includes('<webjs-frame id="rail"'), 'response carries the requested frame');
  assert.ok(body.includes('RAIL CONTENT'), 'frame content is present');
  // ...and the surrounding page chrome + document shell are NOT.
  assert.ok(!body.includes('PAGE CHROME'), 'the surrounding chrome is NOT in the frame-only response');
  assert.ok(!/<html|<head|<body|importmap/i.test(body),
    'the full document shell (html/head/body/importmap) is elided from the frame-only response');
});

test('the frame-only response is byte-equivalent to the frame extracted from the full render', async () => {
  const appDir = makeApp({ 'app/page.js': framePage() });
  const app = await createRequestHandler({ appDir, dev: true });

  // Full-page render (no frame header).
  const full = await app.handle(new Request('http://x/'));
  const fullBody = await full.text();
  const extracted = extractFrameSubtree(fullBody, 'rail');
  assert.ok(extracted, 'the frame is present in the full-page render');

  // Frame-only render (with the header).
  const frameOnly = await app.handle(new Request('http://x/', {
    headers: { 'x-webjs-frame': 'rail' },
  }));
  const frameBody = await frameOnly.text();

  assert.equal(frameBody, extracted,
    'the frame-only response body equals the frame subtree sliced from the full page (byte-equivalent)');
});

/* ---------------- the full-page fallback ---------------- */

test('a request whose frame id is ABSENT falls back to the full page', async () => {
  const appDir = makeApp({ 'app/page.js': framePage() });
  const app = await createRequestHandler({ appDir, dev: true });

  const res = await app.handle(new Request('http://x/', {
    headers: { 'x-webjs-frame': 'does-not-exist' },
  }));
  assert.equal(res.status, 200);
  const body = await res.text();
  // The requested frame is not in the page, so the server returns the FULL
  // page (the client then handles the absence via webjs:frame-missing).
  assert.ok(body.includes('PAGE CHROME'), 'an absent frame id falls back to the full page');
  assert.ok(/<html|importmap/i.test(body), 'the full document shell is present in the fallback');
});

/* ---------------- the sliced-subtree response marker (#1407) ---------------- */

/**
 * The frame branch is not the only answer to an `x-webjs-frame` request: a
 * streamed render skips it and an absent frame id falls through, and both send
 * a whole document instead. The speculative prefetch cache keys an entry by the
 * frame it asked for, so it has to tell the sliced shape apart from a whole
 * document BEFORE it stores the body, and it cannot infer that from the bytes
 * (a page whose first element is a frame looks exactly like a subtree). So the
 * server states it: only the sliced branch sets `x-webjs-frame` on the way out.
 */
test('the sliced frame response carries x-webjs-frame; the fall-throughs do not (#1407)', async () => {
  const appDir = makeApp({ 'app/page.js': framePage() });
  const app = await createRequestHandler({ appDir, dev: true });

  const sliced = await app.handle(new Request('http://x/', {
    headers: { 'x-webjs-frame': 'rail' },
  }));
  assert.equal(sliced.headers.get('x-webjs-frame'), 'rail',
    'the sliced subtree is positively marked with the id it was sliced for');
  assert.match(sliced.headers.get('vary') || '', /X-Webjs-Frame/i,
    'and still declares the request dimension it varies on');

  // Fall-through 1: the id is not in the render, so this is the whole page.
  const absent = await app.handle(new Request('http://x/', {
    headers: { 'x-webjs-frame': 'does-not-exist' },
  }));
  assert.equal(absent.headers.get('x-webjs-frame'), null,
    'a full-page fall-through carries no marker, so a client cannot mistake it for a subtree');

  // A request that never asked for a frame obviously carries none either.
  const plain = await app.handle(new Request('http://x/'));
  assert.equal(plain.headers.get('x-webjs-frame'), null, 'a plain GET carries no marker');
});

test('a STREAMED page answering a frame request carries no marker (#1407)', async () => {
  // Fall-through 2. A `loading.js` sibling wraps the async page in Suspense, so
  // the render streams and the frame branch is skipped by its own guard. The
  // response is a whole document, and must not look like a subtree.
  const ASYNC_FRAME_PAGE =
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `import ${JSON.stringify(FRAME_URL)};\n` +
    `export default async function P() {\n` +
    `  await new Promise((r) => setTimeout(r, 5));\n` +
    `  return html\`<main><h1 id="chrome">PAGE CHROME</h1>\n` +
    `    <webjs-frame id="rail"><span id="rail-body">RAIL CONTENT</span></webjs-frame>\n` +
    `  </main>\`;\n` +
    `}\n`;
  const LOADING =
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `export default () => html\`<p>loading</p>\`;\n`;
  const appDir = makeApp({ 'app/page.js': ASYNC_FRAME_PAGE, 'app/loading.js': LOADING });
  const app = await createRequestHandler({ appDir, dev: true });

  const res = await app.handle(new Request('http://x/', {
    headers: { 'x-webjs-frame': 'rail' },
  }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-webjs-frame'), null,
    'a streamed answer to a frame request is a whole document and carries no marker');
  const body = await res.text();
  assert.ok(body.includes('PAGE CHROME'), 'precondition: it really is the whole page, not a subtree');
});

/* ---------------- the no-header differential guard ---------------- */

test('a request with NO x-webjs-frame header is byte-identical to before the feature', async () => {
  const appDir = makeApp({ 'app/page.js': framePage() });
  const app = await createRequestHandler({ appDir, dev: true });

  const a = await app.handle(new Request('http://x/'));
  const b = await app.handle(new Request('http://x/'));
  const bodyA = await a.text();
  const bodyB = await b.text();
  assert.equal(bodyA, bodyB, 'a plain GET is deterministic full-page HTML');
  assert.ok(bodyA.includes('PAGE CHROME') && /<html|importmap/i.test(bodyA),
    'a no-header request renders the full page (the subtree branch never fires)');
});

/* ---------------- unit tests of the extractor ---------------- */

test('extractFrameSubtree finds the exact subtree, balancing nested frames', () => {
  const html =
    '<div><webjs-frame id="outer">A' +
    '<webjs-frame id="inner">B</webjs-frame>' +
    'C</webjs-frame></div>';
  assert.equal(
    extractFrameSubtree(html, 'outer'),
    '<webjs-frame id="outer">A<webjs-frame id="inner">B</webjs-frame>C</webjs-frame>',
    'the outer frame includes its nested inner frame, balanced correctly',
  );
  assert.equal(
    extractFrameSubtree(html, 'inner'),
    '<webjs-frame id="inner">B</webjs-frame>',
    'the inner frame is extracted on its own',
  );
});

test('extractFrameSubtree ignores prefix-collision tags inside the frame (balanced + unbalanced)', () => {
  // A hyphenated child whose name STARTS with "webjs-frame" must not be
  // miscounted as a nested frame. Balanced cancels; an unbalanced/void one used
  // to corrupt the depth scan.
  const balanced =
    '<webjs-frame id="x">A<webjs-frame-nav>nav</webjs-frame-nav>B</webjs-frame>';
  assert.equal(
    extractFrameSubtree(balanced, 'x'),
    '<webjs-frame id="x">A<webjs-frame-nav>nav</webjs-frame-nav>B</webjs-frame>',
    'a balanced webjs-frame-* child is left intact, not counted as a nested frame',
  );
  // An ORPHAN close-prefix tag (no matching open) must not decrement depth.
  const orphanClose = '<webjs-frame id="x">A</webjs-frame-x>B</webjs-frame>after';
  assert.equal(
    extractFrameSubtree(orphanClose, 'x'),
    '<webjs-frame id="x">A</webjs-frame-x>B</webjs-frame>',
    'an orphan </webjs-frame-x> does not close the real frame early',
  );
  // A VOID open-prefix tag (no close) must not inflate depth and lose the close.
  const voidOpen = '<webjs-frame id="x">A<webjs-frame-spacer>B</webjs-frame>after';
  assert.equal(
    extractFrameSubtree(voidOpen, 'x'),
    '<webjs-frame id="x">A<webjs-frame-spacer>B</webjs-frame>',
    'a void <webjs-frame-spacer> does not consume the real close',
  );
});

test('extractFrameSubtree returns null when the id is absent', () => {
  assert.equal(extractFrameSubtree('<webjs-frame id="a">x</webjs-frame>', 'b'), null);
  assert.equal(extractFrameSubtree('<div>no frames here</div>', 'a'), null);
});

test('extractFrameSubtree is id-attribute-aware, not a substring match', () => {
  // "rail" must not match "rail-extra".
  const html = '<webjs-frame id="rail-extra">X</webjs-frame><webjs-frame id="rail">Y</webjs-frame>';
  assert.equal(extractFrameSubtree(html, 'rail'), '<webjs-frame id="rail">Y</webjs-frame>');
});

test('extractFrameSubtree handles single-quoted and unquoted ids and a self-closing frame', () => {
  assert.equal(extractFrameSubtree("<webjs-frame id='q'>z</webjs-frame>", 'q'),
    "<webjs-frame id='q'>z</webjs-frame>");
  assert.equal(extractFrameSubtree('<webjs-frame id=u>z</webjs-frame>', 'u'),
    '<webjs-frame id=u>z</webjs-frame>');
  assert.equal(extractFrameSubtree('<webjs-frame id="s"/>', 's'), '<webjs-frame id="s"/>');
});

test('requestedFrameId reads and trims the header, null when absent', () => {
  const mk = (v) => new Request('http://x/', v ? { headers: { 'x-webjs-frame': v } } : {});
  assert.equal(requestedFrameId(mk('rail')), 'rail');
  assert.equal(requestedFrameId(mk('  rail  ')), 'rail');
  assert.equal(requestedFrameId(mk('')), null);
  assert.equal(requestedFrameId(mk(null)), null);
  assert.equal(requestedFrameId(undefined), null);
});
