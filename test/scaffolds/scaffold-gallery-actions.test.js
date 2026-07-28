/**
 * Behaviour test for the gallery's HTTP-verb card (#1151): the scaffold-gallery
 * suite next door asserts the demo's SOURCE declares `method` / `cache` / `tags`
 * / `invalidates`, which cannot tell whether the framework actually honours them.
 * This boots a freshly generated app through the in-process handler and asserts
 * the WIRE the card describes: a private, max-age'd, tagged, ETagged GET, and a
 * mutation that reports its invalidated tag.
 *
 * That wire IS the browser-cache behaviour the card demonstrates (a repeat click
 * inside the window is served by the browser from the `Cache-Control` entry, and
 * the invalidation header is what makes the next read bypass it). What this seam
 * CANNOT observe is the cache itself: there is no browser here, and WebJs never
 * caches a GET action server-side, so every call through the handler executes.
 * The headers are therefore the load-bearing assertions, and the demo's own
 * cache behaviour is verified in a browser.
 *
 * The generated app is symlinked to the repo's node_modules so its bare
 * `@webjsdev/*` imports resolve; a scaffolded app in a bare tmpdir cannot boot.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { createRequestHandler } from '@webjsdev/server';
import { hashFile } from '../../packages/server/src/actions.js';
import { scaffoldApp } from '../../packages/cli/lib/create.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function mute() {
  const log = console.log, err = console.error;
  console.log = () => {}; console.error = () => {};
  return () => { console.log = log; console.error = err; };
}

test('the gallery GET action is cached, tagged, and invalidated on the wire', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'webjs-gallery-actions-'));
  const restore = mute();
  try {
    await scaffoldApp('demo', cwd, { template: 'full-stack' });
    const appDir = join(cwd, 'demo');
    await symlink(join(ROOT, 'node_modules'), join(appDir, 'node_modules'));

    const h = await createRequestHandler({ appDir, dev: false });
    if (h.warmup) await h.warmup();
    const get = (url, init) => h.handle(new Request('http://localhost' + url, init));
    const same = { 'sec-fetch-site': 'same-origin' };

    // The card renders and ships the demo module, so the element upgrades. An
    // unimported component would still emit its tag, hence the module assertion.
    const page = await get('/features/server-actions');
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<clock-reader/, 'the card renders the demo element');
    assert.match(html, /modules\/server-actions\/components\/clock-reader\.ts/, 'the demo module is shipped to the browser');

    const readHash = await hashFile(join(appDir, 'modules/server-actions/queries/read-clock.server.ts'));
    const bumpHash = await hashFile(join(appDir, 'modules/server-actions/actions/bump-clock.server.ts'));

    // A GET action: args on the URL, private cache window, tagged, ETagged.
    const first = await get(`/__webjs/action/${readHash}/readClock`, { headers: same });
    assert.equal(first.status, 200);
    assert.match(first.headers.get('cache-control') || '', /private/, 'the cache window is private, never shared');
    // Pinned to 10, not any number: the card copy tells the visitor to read twice
    // "inside ten seconds", so a changed window makes the page wrong.
    assert.match(first.headers.get('cache-control') || '', /max-age=10\b/, 'the window matches the ten seconds the card promises');
    assert.equal(first.headers.get('x-webjs-tags'), 'clock', 'the entry is tagged');
    assert.ok(first.headers.get('etag'), 'a weak ETag rides the response');
    const firstBody = await first.json();
    assert.equal(typeof firstBody.serving, 'number', 'the read reports its server executions');
    // No 304 assertion here on purpose. This demo's payload carries a per-execution
    // counter, so its ETag is different every run by design and a revalidation is
    // always a fresh 200. That a STABLE read answers 304 is the framework's own
    // contract, covered in packages/server/test/action-verbs/verb-dispatch.test.js.

    // The mutation reports the tag it invalidated; that header is what makes the
    // client coordinator bypass the browser-cached read on the next call.
    const bump = await get(`/__webjs/action/${bumpHash}/bumpClock`, {
      method: 'POST', headers: { ...same, 'content-type': 'application/json' }, body: '{"args":[]}',
    });
    assert.equal(bump.status, 200);
    assert.equal(bump.headers.get('x-webjs-invalidate'), 'clock', 'the mutation reports its invalidated tag');
    const envelope = await bump.json();
    assert.equal(envelope.success, true, 'the mutation returns the ActionResult envelope');

    // The read really does return something different afterwards, so the demo has
    // a visible change to show once the invalidation lands.
    const after = await get(`/__webjs/action/${readHash}/readClock`, { headers: same });
    const afterBody = await after.json();
    assert.equal(afterBody.reading, firstBody.reading + 1, 'the mutation moved the value the read returns');
    // Not evidence of a cache bypass (nothing is cached at this seam); it asserts
    // the counter the card points at as the cache tell actually advances per run.
    assert.ok(afterBody.serving > firstBody.serving, 'the serving counter advances on each execution');
  } finally {
    restore();
    await rm(cwd, { recursive: true, force: true });
  }
});
