/**
 * The SSR action-seed consumer against a REAL document (#472, #1309).
 *
 * The node-side unit file drives `scanSeeds` through a hand-rolled fake DOM, so
 * it proves the logic but not the DOM contract the client actually depends on:
 * that `querySelectorAll` matches the block the SERVER emits (a
 * `script[type="application/json"]#__webjs-seeds` carrying a `data-webjs-dev`
 * attribute), that `textContent` on a real script element yields the payload
 * back, that removal actually detaches the node, and that the real
 * `requestIdleCallback` fires the report exactly once per scan batch. Each of
 * those is a browser behaviour the fake cannot stand in for.
 */

import { scanSeeds, takeSeed, seedStats, SEED_MISS, __resetSeeds } from '../../../src/action-seed-client.js';
import { stringify } from '../../../src/serialize.js';

import { assert } from '../../../../../test/browser-assert.js';

/** Build the exact block shape `buildSeedScript` emits, attached to the page. */
function seedBlock(payload, devMarker) {
  const s = document.createElement('script');
  s.type = 'application/json';
  s.id = '__webjs-seeds';
  if (devMarker) s.setAttribute('data-webjs-dev', devMarker);
  s.textContent = payload;
  document.body.appendChild(s);
  return s;
}

/** An element carrier: read by the client, not emitted by any server path yet. */
function seedCarrier(payload) {
  const el = document.createElement('div');
  el.setAttribute('data-webjs-seed', payload);
  document.body.appendChild(el);
  return el;
}

/** Run `body`, then wait for the real idle callback the scan scheduled. */
async function withIdle(body) {
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    await body();
    // `requestIdleCallback` is scheduled with a 1000ms timeout, so waiting on a
    // fresh one of our own is enough: idle callbacks run in scheduling order.
    await new Promise((r) => {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(() => r(), { timeout: 1500 });
      else setTimeout(r, 400);
    });
    // One more macrotask, so a report scheduled on the setTimeout fallback
    // (Safari has no requestIdleCallback) has also landed.
    await new Promise((r) => setTimeout(r, 300));
  } finally {
    console.warn = orig;
  }
  return warns;
}

suite('SSR action seeding, real DOM (#1309)', () => {
  setup(() => __resetSeeds());
  teardown(() => {
    for (const el of document.querySelectorAll('#__webjs-seeds, [data-webjs-seed]')) el.remove();
  });

  test('a real server-shaped block is ingested and DETACHED from the document', async () => {
    const block = seedBlock(await stringify({ 'h/getUser/[1]': { id: 1, name: 'User 1' } }), 'ok');
    scanSeeds(document);
    assert.equal(block.isConnected, false, 'the consumed block is removed from the DOM');
    assert.deepEqual(takeSeed('h', 'getUser', '[1]'), { id: 1, name: 'User 1' });
    assert.equal(takeSeed('h', 'getUser', '[1]'), SEED_MISS, 'consume-once holds in a real DOM');
  });

  test('a real [data-webjs-seed] carrier is ingested and its attribute stripped', async () => {
    const carrier = seedCarrier(await stringify({ 'h/getThing/[]': { ok: true } }));
    scanSeeds(document);
    assert.deepEqual(takeSeed('h', 'getThing', '[]'), { ok: true });
    assert.equal(carrier.hasAttribute('data-webjs-seed'), false, 'the attribute is stripped');
    assert.equal(carrier.isConnected, true, 'but the element itself stays, unlike the block');
    carrier.remove();
  });

  test('seedStats matches the calls actually made', async () => {
    seedBlock(await stringify({ 'h/f/[1]': 1, 'h/f/[2]': 2 }), 'ok');
    scanSeeds(document);
    takeSeed('h', 'f', '[1]');
    takeSeed('h', 'f', '[9]');
    const s = seedStats();
    assert.equal(s.ingested, 2);
    assert.equal(s.hits, 1);
    assert.equal(s.misses, 1);
    assert.equal(s.pending, 1, 'the unconsumed seed is still in the store');
  });

  test('the real idle path reports ONCE per scan batch, and only on a miss', async () => {
    const warns = await withIdle(async () => {
      seedBlock(await stringify({ 'h/f/[1]': 1 }), 'ok');
      scanSeeds(document);
      takeSeed('h', 'f', '[1]');
      takeSeed('h', 'f', '[2]');
    });
    assert.equal(warns.length, 1, 'exactly one line for the batch');
    assert.ok(warns[0].indexOf('1 of 2 hydration action call(s) missed') !== -1, warns[0]);
  });

  test('a stale block left in the live document cannot outrank a fresh soft-nav seed', async () => {
    // The regression last-write-wins can cause, and the reason the scan drains
    // the live document before ingesting an incoming page. Page A never called
    // `takeSeed` (every async component on it elided), so the lazy initial scan
    // never ran and its block is still in the live DOM; it sits after the body
    // content, outside every boundary range, so no swap removes it either. When
    // page B arrives, both renders share the key, and if A's block is ingested
    // LAST it wins and the hit contradicts the HTML on screen.
    const stale = seedBlock(await stringify({ 'h/getUser/[1]': 'PAGE-A-STALE' }), 'ok');
    assert.equal(stale.isConnected, true, 'page A was never scanned');

    // The soft nav: `applySwap` scans a DETACHED parse, never the live document.
    const detached = document.implementation.createHTMLDocument('');
    const fresh = detached.createElement('script');
    fresh.type = 'application/json';
    fresh.id = '__webjs-seeds';
    fresh.setAttribute('data-webjs-dev', 'ok');
    fresh.textContent = await stringify({ 'h/getUser/[1]': 'PAGE-B-FRESH' });
    detached.body.appendChild(fresh);
    scanSeeds(detached);

    assert.equal(stale.isConnected, false, 'the outgoing page\'s block is drained, not left to reappear');
    assert.equal(takeSeed('h', 'getUser', '[1]'), 'PAGE-B-FRESH', 'the hit matches the paint');
  });

  test('a MARKERLESS swap (a frame self-load) still reports for the page it lands on', async () => {
    // `<webjs-frame src>` routes its subtree through the same `applySwap` and so
    // through `scanSeeds`, but `ssr.js` returns a frame subtree BEFORE the seed
    // block is appended, so that parse carries no block and no marker. If the
    // swap simply opened no window, the report would be silently dead for the
    // whole page the frame sits on, which is the exact silent failure this
    // feature exists to remove. The drained live block belongs to that page, so
    // the window is attributed to it.
    const warns = await withIdle(async () => {
      seedBlock(await stringify({ 'h/f/[1]': 1 }), 'ok');   // the page, never scanned
      const frame = document.implementation.createHTMLDocument('');
      frame.body.innerHTML = '<webjs-frame id="f"><p>frame body</p></webjs-frame>';
      scanSeeds(frame);                                     // markerless: no block at all
      takeSeed('h', 'f', '[1]');                            // hit, from the drained block
      takeSeed('h', 'f', '[2]');                            // miss, worth reporting
    });
    assert.equal(warns.length, 1, 'the page still gets its report');
    assert.ok(warns[0].indexOf('1 of 2 hydration action call(s) missed') !== -1, warns[0]);
    assert.ok(warns[0].indexOf('1 seed(s) on this page') !== -1, `the page's own seed is counted: ${warns[0]}`);
  });

  test('scanning a LIVE subtree does not strip the rest of the document', async () => {
    // `scanSeeds` is a public export. The drain fires only for a DETACHED root,
    // because a live root or a live subtree is not "a new page arriving"; draining
    // there would strip the very subtree being scanned before it was read.
    const outside = seedBlock(await stringify({ 'h/outside/[1]': 'kept' }), 'ok');
    const region = document.createElement('div');
    const inside = document.createElement('div');
    inside.setAttribute('data-webjs-seed', await stringify({ 'h/inside/[1]': 'read' }));
    region.appendChild(inside);
    document.body.appendChild(region);

    scanSeeds(region);
    assert.equal(outside.isConnected, true, 'the scan itself leaves the rest of the document alone');
    assert.equal(takeSeed('h', 'inside', '[1]'), 'read', 'the subtree carrier is ingested');
    // The lazy initial scan is still owed, so THIS is where the rest of the
    // document is consumed, which is the pre-existing behaviour and correct: that
    // block belongs to the page currently on screen.
    assert.equal(takeSeed('h', 'outside', '[1]'), 'kept', 'the lazy scan still owes the document');
    region.remove();
  });

  test('an UNMARKED block (production) reports nothing at all', async () => {
    const warns = await withIdle(async () => {
      seedBlock(await stringify({ 'h/f/[1]': 1 }));
      scanSeeds(document);
      takeSeed('h', 'f', '[2]');
    });
    assert.deepEqual(warns, [], 'the dev gate is the server marker, and there is none here');
  });

  test('every call hitting stays silent even in dev', async () => {
    const warns = await withIdle(async () => {
      seedBlock(await stringify({ 'h/f/[1]': 1 }), 'ok');
      scanSeeds(document);
      takeSeed('h', 'f', '[1]');
    });
    assert.deepEqual(warns, []);
  });
});
