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

  test('a FRAME swap leaves the surrounding page\'s state completely alone', async () => {
    // `<webjs-frame>` routes its subtree through the same `applySwap`, but it is
    // not a page navigation: the page around the frame is still on screen. The
    // router flags it, because the parse cannot be recognised on its own (a frame
    // response carries no seed block at all, which looks exactly like a page that
    // seeded nothing). Guessing failed both ways in turn: treating it as a page
    // killed the report for the whole surrounding page, and attributing the
    // window to the live page made it print a cause that is provably false.
    const warns = await withIdle(async () => {
      seedBlock(await stringify({ 'h/f/[1]': 1 }), 'ok');   // the page, not yet scanned
      const frame = document.implementation.createHTMLDocument('');
      frame.body.innerHTML = '<webjs-frame id="f"><p>frame body</p></webjs-frame>';
      scanSeeds(frame, { frame: true });
      // The page's own block is untouched, so the lazy scan still owes it and
      // opens the page's own window on the first call below.
      takeSeed('h', 'f', '[1]');                            // hit
      takeSeed('h', 'f', '[2]');                            // miss, worth reporting
    });
    assert.equal(warns.length, 1, 'the surrounding page still gets its own report');
    assert.ok(warns[0].indexOf('1 of 2 hydration action call(s) missed') !== -1, warns[0]);
    assert.ok(
      warns[0].indexOf('1 seed(s) on this page') !== -1,
      `and its own seed is counted, not a cause read off the frame: ${warns[0]}`,
    );
  });

  test('an outgoing page\'s unconsumed seeds are DISCARDED, not accumulated', async () => {
    // The block a departed page leaves behind belongs to components that elided,
    // so nothing will ever call `takeSeed` for those keys and nothing but a hit
    // deletes one. Ingesting them would grow the store by a whole page payload
    // per navigation, in production, and inflate the "still unconsumed" figure in
    // the dev line with keys from pages the developer has already left.
    seedBlock(await stringify({ 'h/gone/[1]': 1, 'h/gone/[2]': 2, 'h/gone/[3]': 3 }), 'ok');
    const detached = document.implementation.createHTMLDocument('');
    const fresh = detached.createElement('script');
    fresh.type = 'application/json';
    fresh.id = '__webjs-seeds';
    fresh.setAttribute('data-webjs-dev', 'ok');
    fresh.textContent = await stringify({ 'h/here/[1]': 'incoming' });
    detached.body.appendChild(fresh);
    scanSeeds(detached);

    assert.equal(seedStats().pending, 1, 'only the incoming page\'s seed is held');
    assert.equal(takeSeed('h', 'gone', '[1]'), SEED_MISS, 'a departed page\'s value is never served');
    assert.equal(takeSeed('h', 'here', '[1]'), 'incoming');
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

  test('an already-INGESTED unconsumed seed does not survive a navigation', async () => {
    // The second route into the same "a hit disagrees with the paint" hole, and
    // the one stripping DOM carriers does not close. Page A carries an elided
    // component AND a shipping one, so the shipping one's first `takeSeed` fires
    // the lazy scan and the WHOLE block is ingested: the elided component's key
    // is now in the store with no carrier left to strip and nothing that will
    // ever consume it. Page B emits no seed for that key (a streamed page emits
    // no block at all), so without eviction a component on B calling the same
    // action with the same arguments gets page A's value.
    seedBlock(await stringify({ 'h/getUser/[1]': 'PAGE-A-STALE', 'h/used/[1]': 1 }), 'ok');
    takeSeed('h', 'used', '[1]');   // fires the lazy scan; the block leaves the DOM
    assert.equal(seedStats().pending, 1, 'page A left one seed ingested and unconsumed');

    const detached = document.implementation.createHTMLDocument('');
    const fresh = detached.createElement('script');
    fresh.type = 'application/json';
    fresh.id = '__webjs-seeds';
    fresh.setAttribute('data-webjs-dev', 'ok');
    fresh.textContent = await stringify({ 'h/other/[1]': 'B' });
    detached.body.appendChild(fresh);
    scanSeeds(detached);

    assert.equal(takeSeed('h', 'getUser', '[1]'), SEED_MISS, 'a departed page\'s value is never served');
    assert.equal(takeSeed('h', 'other', '[1]'), 'B', 'the incoming page\'s own seed still works');
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
