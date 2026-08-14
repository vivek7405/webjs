/**
 * Cross-runtime proof of the sliced-frame response marker (#1407). Runs under
 * WHICHEVER runtime executes it (Bun via the CI `bun` job /
 * `bun test/bun/frame-prefetch.mjs`, Node via the `.test.mjs` wrapper in
 * `npm test`).
 *
 * The marker is runtime-sensitive surface: it rides the SSR render + response
 * path, which the Bun listener shell serves through a different shell than the
 * node:http one, and it is a HEADER, which is exactly where the two runtimes'
 * Response implementations can diverge without any test noticing. The client's
 * speculative cache keys a prefetched body by the frame it asked for, and the
 * ONLY thing telling a sliced subtree apart from one of the two full-document
 * fall-throughs is this header, so a runtime that dropped it would let a whole
 * document be cached under a frame key, and a click consuming that entry can
 * find no frame in it and leave the region unchanged instead of fetching.
 *
 * Asserts on a real app boot + real GETs, identically on both runtimes:
 *   - a GET carrying `x-webjs-frame` for an id IN the render returns only the
 *     subtree, marked `x-webjs-frame: <id>` and varying on `X-Webjs-Frame`
 *   - a GET with no frame header carries no marker
 *   - a GET naming an ABSENT frame id returns the full page with no marker
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createRequestHandler } from '@webjsdev/server';

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;
// The tmp app has no node_modules, so its modules import core by absolute file
// URL (the same pattern the server unit fixtures and the sibling proofs use).
const here = dirname(fileURLToPath(import.meta.url));
const HTML_URL = pathToFileURL(resolve(here, '../../packages/core/src/html.js')).toString();
const FRAME_URL = pathToFileURL(resolve(here, '../../packages/core/src/webjs-frame.js')).toString();

const dir = mkdtempSync(join(tmpdir(), 'webjs-bun-frameprefetch-'));
try {
  const appDir = join(dir, 'app');
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(dir, 'package.json'),
    JSON.stringify({ name: 'fx', type: 'module', imports: { '#*': './*' } }));
  writeFileSync(join(appDir, 'page.ts'),
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `import ${JSON.stringify(FRAME_URL)};\n` +
    `export default () => html\`<main><h1 id="chrome">PAGE CHROME</h1>\n` +
    `  <webjs-frame id="panel"><span id="panel-body">PANEL CONTENT</span></webjs-frame>\n` +
    `</main>\`;\n`);

  const h = await createRequestHandler({ appDir: dir, dev: false });
  if (h.warmup) await h.warmup();

  // 1. The sliced subtree: marked, varying, and free of the page chrome.
  {
    const res = await h.handle(new Request('http://localhost/', {
      headers: { 'x-webjs-frame': 'panel' },
    }));
    assert.equal(res.status, 200, `framed GET on ${runtime}`);
    assert.equal(res.headers.get('x-webjs-frame'), 'panel',
      `the sliced subtree is marked with the id it was sliced for on ${runtime}`);
    assert.match(res.headers.get('vary') || '', /X-Webjs-Frame/i,
      `and declares the request dimension it varies on, on ${runtime}`);
    const body = await res.text();
    assert.ok(body.includes('PANEL CONTENT'), `the frame content is served on ${runtime}`);
    assert.ok(!body.includes('PAGE CHROME'),
      `and the surrounding chrome is not, so it really is the slice, on ${runtime}`);
  }

  // 2. A request that never asked for a frame carries no marker.
  {
    const res = await h.handle(new Request('http://localhost/'));
    assert.equal(res.status, 200, `plain GET on ${runtime}`);
    assert.equal(res.headers.get('x-webjs-frame'), null,
      `a plain GET carries no frame marker on ${runtime}`);
    const body = await res.text();
    assert.ok(body.includes('PAGE CHROME'), `and is the whole page on ${runtime}`);
  }

  // 3. The absent-id fall-through: a whole document, and it must NOT look like
  //    a subtree, or the client would cache a full page under a frame key.
  {
    const res = await h.handle(new Request('http://localhost/', {
      headers: { 'x-webjs-frame': 'does-not-exist' },
    }));
    assert.equal(res.status, 200, `absent-id framed GET on ${runtime}`);
    assert.equal(res.headers.get('x-webjs-frame'), null,
      `a full-page fall-through carries no marker on ${runtime}`);
    const body = await res.text();
    assert.ok(body.includes('PAGE CHROME'),
      `precondition: the fall-through really is the whole page on ${runtime}`);
  }

  console.log(`[frame-prefetch] OK on ${runtime}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
