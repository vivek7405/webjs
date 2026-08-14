/**
 * Real-browser tests for #1407: a link that drives a `<webjs-frame>` is
 * prefetched in that frame's dimension, so the click swaps with no round trip.
 *
 * Before this, `fetchAndApply` refused to consume a prefetch whenever a frame
 * id was set, so a hovered frame link cost a DUPLICATE request and bought
 * nothing: the hover fetched the page-level fragment, the click threw it away
 * and fetched the subtree from cold. The refusal was correct as written, since
 * the two are different responses for one url. What was missing is the
 * frame-aware prefetch it was guarding against.
 *
 * These MUST run in a real browser. The headline assertion is a real `<a>`
 * click driving the router's fetch path, the frame-entry validity check reads
 * the live DOM for a `<webjs-frame id>`, and the counterfactual is a COUNT of
 * network requests, which linkedom does not model end to end.
 *
 * Every assertion counts requests rather than racing on timing. This surface
 * has a history of flaky timing-based coverage (#180 was a flaky prefetch e2e,
 * #811 a racy frame self-load e2e), and a count is decidable.
 */
import {
  enableClientRouter,
  _prefetch,
  _prefetchPeek,
  _prefetchTake,
  _resetPrefetch,
} from '../../../src/router-client.js';

import { assert } from '../../../../../test/browser-assert.js';
import { installNavGuard } from '../../../../../test/browser-nav-guard.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle() { await tick(); await tick(); await tick(); }

/**
 * Wait until a prefetch has actually landed in the cache, or until we can be
 * confident none is coming. `prefetchStore` dispatches `webjs:prefetch` the
 * instant a fragment becomes consumable, which is what makes this
 * deterministic: the response body read is a genuine async operation, so a bare
 * `setTimeout(0)` races across engines.
 */
function afterPrefetchAttempt(timeout = 1500) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      document.removeEventListener('webjs:prefetch', onStored);
      resolve();
    };
    const onStored = () => finish();
    document.addEventListener('webjs:prefetch', onStored, { once: true });
    setTimeout(finish, timeout);
  });
}

suite('Client router: frame-dimensioned link prefetch (#1407)', () => {
  let container, origFetch, calls, navGuard;

  /**
   * The server's answer, mirroring `ssr/render.js`: a request carrying
   * `x-webjs-frame` for an id that IS in the render gets the sliced subtree,
   * marked with `x-webjs-frame` on the way out; anything else gets the whole
   * page and no marker.
   */
  function serve(url, init) {
    const asked = (init && init.headers && init.headers['x-webjs-frame']) || null;
    calls.push({ url: String(url), frame: asked });
    if (asked === 'tasks') {
      return new Response(
        '<webjs-frame id="tasks"><span id="frame-body">UPDATED</span></webjs-frame>',
        { status: 200, headers: { 'content-type': 'text/html', 'x-webjs-build': '', 'x-webjs-frame': 'tasks' } },
      );
    }
    return new Response(
      '<!doctype html><html><head></head><body>' +
        '<!--wj:children:/:/-->' +
          '<webjs-frame id="tasks"><span id="frame-body">UPDATED</span></webjs-frame>' +
        '<!--/wj:children:/-->' +
      '</body></html>',
      { status: 200, headers: { 'content-type': 'text/html', 'x-webjs-build': '' } },
    );
  }

  /**
   * Each test gets its OWN url. A frame nav still pushes history, so a click in
   * one test moves `location.href` onto that url, and #1106 (never prefetch the
   * page you are already on) would then suppress the next test's prefetch and
   * make its precondition fail for a reason unrelated to what it is proving.
   *
   * @param {string} href
   */
  function setup(href) {
    navGuard = installNavGuard();
    enableClientRouter(); // idempotent
    _resetPrefetch();
    calls = [];
    container = document.createElement('div');
    container.innerHTML =
      '<span id="outside-sentinel">OUTSIDE</span>' +
      '<webjs-frame id="tasks">' +
        `<a id="tab-done" href="${href}">Done</a>` +
        '<span id="frame-body">ORIGINAL</span>' +
      '</webjs-frame>';
    document.body.appendChild(container);
    origFetch = window.fetch;
    window.fetch = async (url, init) => serve(url, init);
  }

  function teardown() {
    window.fetch = origFetch;
    navGuard.remove();
    container.remove();
    _resetPrefetch();
  }

  test('a hovered frame link prefetches WITH x-webjs-frame, and the click issues no second request', async () => {
    // The headline. This is the counterfactual: on the pre-#1407 code the click
    // cannot consume a prefetch while a frame id is set, so `calls.length` here
    // is 2 and the reader waits a full round trip for the swap.
    setup('/tasks?status=hover');
    try {
      const link = document.getElementById('tab-done');
      link.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      await afterPrefetchAttempt();

      assert.equal(calls.length, 1, 'the hover issued exactly one speculative request');
      assert.equal(calls[0].frame, 'tasks', 'and it asked for the subtree the click will ask for');

      link.click();
      await settle();

      assert.equal(calls.length, 1, 'the click issued NO further request: it consumed the prefetch');
      assert.equal(document.getElementById('frame-body').textContent, 'UPDATED',
        'and the frame really swapped');
      assert.equal(document.getElementById('outside-sentinel').textContent, 'OUTSIDE',
        'the rest of the page is untouched, so it was a frame swap and not a full-body one');
    } finally { teardown(); }
  });

  test('a PAGE prefetch is never consumed by a frame click on the same url', async () => {
    setup('/tasks?status=page-dim');
    try {
      const target = location.origin + '/tasks?status=page-dim';
      // Warm the page dimension only, the way a link outside the frame would.
      _prefetch(target);
      await afterPrefetchAttempt();
      assert.equal(calls.length, 1, 'precondition: the page fragment was fetched');
      assert.ok(_prefetchPeek(target), 'precondition: cached under the page key');

      document.getElementById('tab-done').click();
      await settle();

      assert.equal(calls.length, 2, 'the frame click went to the network rather than applying a page fragment');
      assert.equal(calls[1].frame, 'tasks', 'and it asked for the subtree');
      assert.equal(document.getElementById('frame-body').textContent, 'UPDATED', 'the frame swapped correctly');
    } finally { teardown(); }
  });

  test('a FRAME prefetch is never consumed by a full-page navigation to the same url', async () => {
    setup('/tasks?status=frame-dim');
    try {
      const target = location.origin + '/tasks?status=frame-dim';
      _prefetch(target, 'tasks');
      await afterPrefetchAttempt();
      assert.ok(_prefetchPeek(target, 'tasks'), 'precondition: cached in the frame dimension');
      assert.equal(_prefetchPeek(target), null, 'and nothing under the page key');

      // A link OUTSIDE the frame to the same url is a full-page navigation.
      const outside = document.createElement('a');
      outside.href = '/tasks?status=frame-dim';
      outside.id = 'outside-link';
      container.parentNode.insertBefore(outside, container);
      try {
        const before = calls.length;
        outside.click();
        await settle();
        assert.equal(calls.length, before + 1,
          'the page nav went to the network rather than applying a frame subtree');
        assert.equal(calls[calls.length - 1].frame, null, 'and it asked for the whole page');
      } finally { outside.remove(); }
    } finally { teardown(); }
  });

  test('a frame entry whose <webjs-frame> is gone is discarded, and the click refetches', async () => {
    // The #1114 anchor validation cannot answer this: a frame subtree carries no
    // `wj:children` boundary, so `prefetchAnchor` returns null, which the page
    // path reads as "no constraint" and would consume the entry anywhere. The
    // frame path asks whether the region it was fetched for is still in the
    // document instead, which only a live DOM can answer.
    setup('/tasks?status=gone');
    try {
      const target = location.origin + '/tasks?status=gone';
      _prefetch(target, 'tasks');
      await afterPrefetchAttempt();
      assert.ok(_prefetchPeek(target, 'tasks'), 'precondition: cached');

      // An outer navigation removes the frame between the prefetch and the click.
      const frame = document.getElementById('tasks');
      const link = document.getElementById('tab-done');
      container.appendChild(link);   // keep the trigger, drop the frame
      link.setAttribute('data-webjs-frame', 'tasks');
      frame.remove();

      // The validity check itself, against the real DOM. Asserted directly
      // because a CLICK can no longer reach it: `resolveTargetFrameId` also
      // reads the live DOM, so with the frame gone it resolves null and the
      // click is a full-page nav. That makes this check defence in depth for
      // the window where the frame is resolvable at click time and gone by the
      // time the entry is consumed, and it is the only layer that can catch it.
      assert.equal(_prefetchTake(target, undefined, 'tasks'), null,
        'a frame entry whose frame is gone is refused');
      assert.equal(_prefetchPeek(target, 'tasks'), null, 'and evicted, not left to poison');

      // And the click, which is now an ordinary navigation, still goes to the
      // network rather than picking the orphaned entry up under the page key.
      const before = calls.length;
      link.click();
      await settle();
      assert.equal(calls.length, before + 1,
        'the click went to the network');
      assert.equal(calls[calls.length - 1].frame, null,
        'as a full-page nav, since the frame it targeted no longer exists');
    } finally { teardown(); }
  });

  test('a full-document answer to a framed prefetch is not stored, but the refusal is memoed', async () => {
    // The server's frame branch has two fall-throughs (a streamed render, an
    // absent frame id) that answer with a whole document and no marker. Storing
    // one under a frame key risks a DEAD click: the swap looks for
    // `webjs-frame#<id>` in the body and may not find it (an absent id was never
    // rendered, and a streamed page's content sits in a template the swap does
    // not descend into), leaving the region unchanged instead of fetching.
    setup('/tasks?status=streamed');
    try {
      window.fetch = async (url, init) => {
        calls.push({ url: String(url), frame: (init && init.headers && init.headers['x-webjs-frame']) || null });
        // Marked-free: the server streamed, so this is the whole page.
        return new Response(
          '<!doctype html><html><head></head><body>' +
            '<webjs-frame id="tasks"><span id="frame-body">FULL</span></webjs-frame>' +
          '</body></html>',
          { status: 200, headers: { 'content-type': 'text/html', 'x-webjs-build': '' } },
        );
      };
      const target = location.origin + '/tasks?status=streamed';
      _prefetch(target, 'tasks');
      await afterPrefetchAttempt(400);

      assert.equal(calls.length, 1, 'the speculative request went out');
      assert.equal(_prefetchTake(target, undefined, 'tasks'), null, 'but nothing consumable came of it');
      assert.equal(_prefetchPeek(target), null, 'and nothing under the page key, which it varies from');

      // Discarding the body is not forgetting the refusal. A streaming route
      // answers EVERY framed request unmarked, so forgetting would re-request on
      // every hover for as long as the page lives. The memo lives outside the
      // fragment cache, so it consumes no slot a real fragment could use.
      _prefetch(target, 'tasks');
      await afterPrefetchAttempt(400);
      assert.equal(calls.length, 1, 'a second attempt within the TTL did not re-request');
    } finally { teardown(); }
  });
});
