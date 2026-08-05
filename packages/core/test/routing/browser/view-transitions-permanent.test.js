/**
 * Real-browser regression tests for View Transitions on partial swaps and
 * `data-webjs-permanent` element persistence (#250).
 *
 * Two behaviours, both browser-observable:
 *
 *  1. View Transitions wrap ALL THREE swap paths (marker, frame, full
 *     body), not just the full-body fallback, and only when the page opts
 *     in via `<meta name="view-transition" content="same-origin">`. We
 *     stub `document.startViewTransition` to capture that it was called
 *     with the swap callback (then invoke the callback so the swap still
 *     applies). With the meta absent it is NOT called; with the API
 *     unavailable the swap still applies synchronously (fallback).
 *
 *  2. `data-webjs-permanent` persists an element by NODE IDENTITY across a
 *     swap. We stamp a unique JS property on the live node before the nav
 *     and assert the post-swap node is the SAME instance (=== identity),
 *     proving it was regrafted, not recreated. Covered for the full-body
 *     path AND an in-region (marker/frame) path. Counter-case: an incoming
 *     doc without the id leaves/removes it (not force-persisted).
 *
 * MUST run in a real browser: linkedom does not model the swap pipeline or
 * the View-Transitions API. We stub `window.fetch` to return the response
 * and drive a real link click so `applySwap` runs exactly as in prod.
 */
import { enableClientRouter } from '../../../src/router-client.js';

import { assert } from '../../../../../test/browser-assert.js';
import { installNavGuard } from '../../../../../test/browser-nav-guard.js';

/** Shared across the suites below; installed per test in setup(). */
let navGuard;
const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle() { await tick(); await tick(); await tick(); await tick(); }

const htmlResponse = (body) => Promise.resolve(new Response(body, {
  headers: { 'content-type': 'text/html', 'x-webjs-build': '' },
}));

/** Add/remove the opt-in meta in the live head. */
function setViewTransitionMeta(on) {
  let meta = document.querySelector('meta[name="view-transition"]');
  if (on) {
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'view-transition');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', 'same-origin');
  } else if (meta) {
    meta.remove();
  }
}

suite('Client router: View Transitions on partial swaps (#250)', () => {
  let container, origFetch, origSVT, calls;

  function setup() {
    navGuard = installNavGuard();
    enableClientRouter();
    container = document.createElement('div');
    document.body.appendChild(container);
    origFetch = window.fetch;
    origSVT = Object.getOwnPropertyDescriptor(Document.prototype, 'startViewTransition')
      || (document.startViewTransition !== undefined ? { value: document.startViewTransition } : null);
    calls = [];
  }
  function teardown() {
    navGuard.remove();
    window.fetch = origFetch;
    restoreSVT();
    setViewTransitionMeta(false);
    container.remove();
  }

  // Install a capturing stub on the document instance.
  function stubSVT() {
    document.startViewTransition = (cb) => {
      calls.push(cb);
      // Run the callback synchronously so the swap still applies, and
      // return a transition-like object with a resolved `finished`.
      cb();
      return { finished: Promise.resolve(), ready: Promise.resolve(), updateCallbackDone: Promise.resolve() };
    };
  }
  function removeSVT() {
    try { delete document.startViewTransition; } catch { /* ignore */ }
    document.startViewTransition = undefined;
  }
  function restoreSVT() {
    try { delete document.startViewTransition; } catch { /* ignore */ }
    if (origSVT && 'value' in origSVT && origSVT.value) document.startViewTransition = origSVT.value;
  }

  test('marker swap is wrapped in startViewTransition when the meta opts in', async () => {
    setup();
    try {
      setViewTransitionMeta(true);
      stubSVT();
      // A nested-layout marker shared by both pages.
      container.innerHTML =
        '<!--wj:children:/x:/x-->' +
        '<a id="m-link" href="/m-target"></a>' +
        '<span id="m-content">OLD</span>' +
        '<!--/wj:children:/x-->';

      window.fetch = () => htmlResponse(
        '<!doctype html><html><head></head><body>' +
        '<!--wj:children:/x:/x--><span id="m-content">NEW</span><!--/wj:children:/x-->' +
        '</body></html>'
      );

      document.getElementById('m-link').click();
      await settle();

      assert.equal(calls.length, 1, 'startViewTransition called once for the marker swap');
      assert.equal(typeof calls[0], 'function', 'called with the swap callback');
      assert.equal(document.getElementById('m-content').textContent, 'NEW',
        'the marker swap still applied (callback was invoked)');
    } finally { teardown(); }
  });

  test('frame swap is wrapped in startViewTransition when the meta opts in', async () => {
    setup();
    try {
      setViewTransitionMeta(true);
      stubSVT();
      container.innerHTML =
        '<webjs-frame id="f1">' +
          '<span id="f-content">OLD</span>' +
          '<a id="f-link" href="/f-target"></a>' +
        '</webjs-frame>';

      window.fetch = () => htmlResponse(
        '<!doctype html><html><head></head><body>' +
        '<webjs-frame id="f1"><span id="f-content">NEW</span></webjs-frame>' +
        '</body></html>'
      );

      document.getElementById('f-link').click();
      await settle();

      assert.equal(calls.length, 1, 'startViewTransition called once for the frame swap');
      assert.equal(document.getElementById('f-content').textContent, 'NEW',
        'the frame swap still applied');
    } finally { teardown(); }
  });

  test('with the meta ABSENT, startViewTransition is NOT called but the swap still happens', async () => {
    setup();
    try {
      setViewTransitionMeta(false); // explicit: no opt-in
      stubSVT();
      container.innerHTML =
        '<!--wj:children:/y:/y-->' +
        '<a id="n-link" href="/n-target"></a>' +
        '<span id="n-content">OLD</span>' +
        '<!--/wj:children:/y-->';

      window.fetch = () => htmlResponse(
        '<!doctype html><html><head></head><body>' +
        '<!--wj:children:/y:/y--><span id="n-content">NEW</span><!--/wj:children:/y-->' +
        '</body></html>'
      );

      document.getElementById('n-link').click();
      await settle();

      assert.equal(calls.length, 0,
        'startViewTransition NOT called when the page did not opt in');
      assert.equal(document.getElementById('n-content').textContent, 'NEW',
        'the swap still applied synchronously');
    } finally { teardown(); }
  });

  test('with startViewTransition UNAVAILABLE, the swap applies synchronously (fallback, no throw)', async () => {
    setup();
    try {
      setViewTransitionMeta(true); // opted in, but the API is missing
      removeSVT();
      container.innerHTML =
        '<!--wj:children:/z:/z-->' +
        '<a id="u-link" href="/u-target"></a>' +
        '<span id="u-content">OLD</span>' +
        '<!--/wj:children:/z-->';

      window.fetch = () => htmlResponse(
        '<!doctype html><html><head></head><body>' +
        '<!--wj:children:/z:/z--><span id="u-content">NEW</span><!--/wj:children:/z-->' +
        '</body></html>'
      );

      document.getElementById('u-link').click();
      await settle();

      assert.equal(document.getElementById('u-content').textContent, 'NEW',
        'the swap applied with no API and no throw');
    } finally { teardown(); }
  });
});

suite('Client router: data-webjs-permanent persistence (#250)', () => {
  let container, sibling, origFetch;

  function setup() {
    navGuard = installNavGuard();
    enableClientRouter();
    container = document.createElement('div');
    sibling = document.createElement('div');
    sibling.id = 'perm-sibling';
    sibling.textContent = 'OUTSIDE';
    document.body.appendChild(sibling);
    document.body.appendChild(container);
    origFetch = window.fetch;
  }
  function teardown() {
    navGuard.remove();
    window.fetch = origFetch;
    container.remove();
    const s = document.getElementById('perm-sibling');
    if (s) s.remove();
  }

  test('boundary REPLACE (remount): a permanent element keeps NODE IDENTITY across the nav', async () => {
    setup();
    try {
      // A route-key change at the page boundary (#1015): the REPLACE tier,
      // anchored at the PARENT ('/') boundary, remounts everything in the
      // range EXCEPT regrafted permanents. This is where permanence matters
      // most (a fresh remount would restart the player), replacing the
      // deleted full-body foreground path.
      container.innerHTML =
        '<!--wj:children:/:/-->' +
        '<!--wj:children:/page/[x]:/page/a-->' +
        '<div id="player" data-webjs-permanent>PLAYING</div>' +
        '<a id="fb-link" href="/fb-target"></a>' +
        '<!--/wj:children:/page/[x]-->' +
        '<!--/wj:children:/-->';
      const liveNode = document.getElementById('player');
      const probe = {};
      liveNode.__webjsLiveProbe = probe;

      window.fetch = () => htmlResponse(
        '<!doctype html><html><head></head><body>' +
        '<!--wj:children:/:/-->' +
        '<!--wj:children:/page/[x]:/page/b-->' +
        '<div id="player" data-webjs-permanent>PLACEHOLDER</div>' +
        '<h1 id="fb-new">New page</h1>' +
        '<!--/wj:children:/page/[x]-->' +
        '<!--/wj:children:/-->' +
        '</body></html>'
      );

      document.getElementById('fb-link').click();
      await settle();

      const after = document.getElementById('player');
      assert.ok(after, 'the permanent element survives the REPLACE remount');
      assert.equal(after, liveNode, 'it is the SAME node instance (regrafted, not recreated)');
      assert.equal(after.__webjsLiveProbe, probe, 'the live JS state on the node is intact');
      assert.equal(after.textContent, 'PLAYING',
        'the live content is kept, NOT replaced by the incoming placeholder');
      // The rest of the range did remount to the incoming content.
      assert.ok(document.getElementById('fb-new'), 'the non-permanent content swapped in');
      assert.ok(document.getElementById('perm-sibling'),
        'content OUTSIDE the boundary is untouched by the remount');
    } finally { teardown(); }
  });

  test('in-region (frame) swap: a permanent element keeps NODE IDENTITY', async () => {
    setup();
    try {
      container.innerHTML =
        '<webjs-frame id="pf">' +
          '<div id="widget" data-webjs-permanent>LIVE</div>' +
          '<span id="pf-content">OLD</span>' +
          '<a id="pf-link" href="/pf-target"></a>' +
        '</webjs-frame>';
      const liveNode = document.getElementById('widget');
      const probe = {};
      liveNode.__webjsLiveProbe = probe;

      window.fetch = () => htmlResponse(
        '<!doctype html><html><head></head><body>' +
        '<webjs-frame id="pf">' +
          '<div id="widget" data-webjs-permanent>PLACEHOLDER</div>' +
          '<span id="pf-content">NEW</span>' +
        '</webjs-frame>' +
        '</body></html>'
      );

      document.getElementById('pf-link').click();
      await settle();

      const after = document.getElementById('widget');
      assert.ok(after, 'the permanent element survives the frame swap');
      assert.equal(after, liveNode, 'SAME node instance after an in-region swap');
      assert.equal(after.__webjsLiveProbe, probe, 'live JS state intact across the region swap');
      assert.equal(after.textContent, 'LIVE', 'live content kept');
      assert.equal(document.getElementById('pf-content').textContent, 'NEW',
        'the non-permanent sibling still swapped to the incoming content');
    } finally { teardown(); }
  });

  test('in-region (marker) swap: a permanent element keeps NODE IDENTITY', async () => {
    setup();
    try {
      container.innerHTML =
        '<!--wj:children:/r:/r-->' +
          '<div id="m-widget" data-webjs-permanent>LIVE</div>' +
          '<span id="r-content">OLD</span>' +
          '<a id="r-link" href="/r-target"></a>' +
        '<!--/wj:children:/r-->';
      const liveNode = document.getElementById('m-widget');
      const probe = {};
      liveNode.__webjsLiveProbe = probe;

      window.fetch = () => htmlResponse(
        '<!doctype html><html><head></head><body>' +
        '<!--wj:children:/r:/r-->' +
          '<div id="m-widget" data-webjs-permanent>PLACEHOLDER</div>' +
          '<span id="r-content">NEW</span>' +
        '<!--/wj:children:/r-->' +
        '</body></html>'
      );

      document.getElementById('r-link').click();
      await settle();

      const after = document.getElementById('m-widget');
      assert.ok(after, 'the permanent element survives the marker swap');
      assert.equal(after, liveNode, 'SAME node instance after a marker-range swap');
      assert.equal(after.__webjsLiveProbe, probe, 'live JS state intact across the marker swap');
      assert.equal(after.textContent, 'LIVE', 'live content kept');
      assert.equal(document.getElementById('r-content').textContent, 'NEW',
        'the non-permanent sibling swapped');
    } finally { teardown(); }
  });

  test('counter-case: an incoming doc WITHOUT the id does NOT force-persist (element is removed)', async () => {
    setup();
    try {
      container.innerHTML =
        '<!--wj:children:/:/-->' +
        '<div id="gone" data-webjs-permanent>HERE</div>' +
        '<a id="cf-link" href="/cf-target"></a>' +
        '<!--/wj:children:/-->';
      const liveNode = document.getElementById('gone');
      liveNode.__webjsLiveProbe = {};

      // The incoming doc has NO #gone at all.
      window.fetch = () => htmlResponse(
        '<!doctype html><html><head></head><body>' +
        '<!--wj:children:/:/--><h1 id="cf-new">No permanent here</h1><!--/wj:children:/-->' +
        '</body></html>'
      );

      document.getElementById('cf-link').click();
      await settle();

      assert.ok(!document.getElementById('gone'),
        'a permanent element absent from the incoming doc is NOT force-persisted');
      assert.ok(document.getElementById('cf-new'), 'the incoming body applied');
    } finally { teardown(); }
  });
});
