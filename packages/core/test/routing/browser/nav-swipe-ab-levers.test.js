/**
 * Real-browser test for #1428: the guarded paint-timing levers that let a real
 * iPhone decide what actually fixes the back-swipe blank.
 *
 * #1410 moved the `pushState` ahead of the DOM mutation and the blank survived
 * on-device, which leaves one assumption behind that fix untested: that WebKit
 * binds the back-forward gesture snapshot synchronously, at the `pushState`
 * call. If it instead captures the compositing surface when the
 * `didSameDocumentNavigation` IPC lands in the UI process, that happens after
 * the whole push-swap-scroll task has run, and reordering inside that task
 * changes nothing a device can see.
 *
 * The gesture preview is iOS-only and cannot be asserted anywhere but a real
 * iPhone. What CAN be asserted in any browser is the thing the levers change:
 * whether a FRAME BOUNDARY falls between the push and the mutation. That is the
 * whole mechanism under test, so it is what these pin, in both directions.
 *
 * The default direction matters as much as the lever direction. These sit on
 * the live navigation path, so an app that opts into nothing must run exactly
 * the timing it ran before, and only a test that fails when the lever leaks can
 * say so.
 */
import { enableClientRouter, navigate } from '../../../src/router-client.js';

import { assert } from '../../../../../test/browser-assert.js';
import { installNavGuard } from '../../../../../test/browser-nav-guard.js';

const OUTGOING_SENTINEL = 'outgoing-page-1428';
const INCOMING_SENTINEL = 'incoming-page-1428';
const SCROLL_TO = 800;

suite('Client router: back-swipe A/B levers (#1428)', () => {
  let origFetch, origPushState, navGuard, origHref, observer, seq, pushes;

  /** @param {Record<string, boolean> | null} levers */
  function setup(levers) {
    origHref = location.href;
    enableClientRouter();
    navGuard = installNavGuard();

    if (levers) window.__webjsDiag = levers;
    else delete window.__webjsDiag;

    // A genuinely TALL outgoing document against a SHORT destination, the shape
    // the defect was measured on: the engine really clamps the offset, so the
    // #1410 guarantee is being re-checked against real layout rather than a
    // stub.
    document.body.innerHTML =
      `<!--wj:children:/:/-->${OUTGOING_SENTINEL}<div style="height:3000px"></div><!--/wj:children:/-->`;
    window.scrollTo({ left: 0, top: SCROLL_TO, behavior: 'instant' });

    // One ordered trace of the three events the levers reorder. `frame` is
    // requested from INSIDE the push wrapper, so it is queued ahead of any
    // frame the router itself requests afterwards and therefore fires first
    // within that frame. That ordering is what makes `frame` before `mutate`
    // mean "the router waited for a frame" rather than "some frame elapsed".
    seq = [];
    pushes = [];
    origPushState = history.pushState;
    history.pushState = function (...args) {
      seq.push('push');
      pushes.push({ text: document.body.textContent || '', scrollY: window.scrollY });
      requestAnimationFrame(() => seq.push('frame'));
      return origPushState.apply(this, args);
    };

    // A MutationObserver callback is a microtask, so a synchronous swap records
    // `mutate` before the next frame can run, which is exactly the distinction
    // being drawn.
    observer = new MutationObserver(() => {
      if (!seq.includes('mutate')) seq.push('mutate');
    });
    observer.observe(document.body, { childList: true, subtree: true });

    origFetch = window.fetch;
    window.fetch = () => Promise.resolve(new Response(
      '<!doctype html><html><head></head><body>'
      + `<!--wj:children:/:/-->${INCOMING_SENTINEL}<!--/wj:children:/--></body></html>`,
      { headers: { 'content-type': 'text/html', 'x-webjs-build': '' } },
    ));
  }

  function teardown() {
    if (observer) observer.disconnect();
    window.fetch = origFetch;
    history.pushState = origPushState;
    delete window.__webjsDiag;
    if (navGuard) navGuard.remove();
    document.body.innerHTML = '';
    window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
    history.replaceState(null, '', origHref);
  }

  /** Let any pending frame callback land, so the trace is complete. */
  function settleFrames() {
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined))));
  }

  test('default: no lever set, so the swap still happens in the push\'s own task', async () => {
    setup(null);
    try {
      await navigate(location.origin + '/swipe-ab-default');
      await settleFrames();

      assert.equal(navGuard.hardNavigations.length, 0,
        `the swap must not degrade here (fallbacks: ${JSON.stringify(navGuard.fallbacks)})`);
      assert.deepEqual(seq, ['push', 'mutate', 'frame'],
        `with no lever the mutation lands before any frame boundary (got ${JSON.stringify(seq)})`);
    } finally { teardown(); }
  });

  test('?raf: a frame boundary falls between the push and the mutation', async () => {
    setup({ raf: true });
    try {
      await navigate(location.origin + '/swipe-ab-raf');
      await settleFrames();

      assert.equal(navGuard.hardNavigations.length, 0,
        `the swap must not degrade here (fallbacks: ${JSON.stringify(navGuard.fallbacks)})`);
      assert.deepEqual(seq, ['push', 'frame', 'mutate'],
        `the lever must paint a frame between the push and the swap (got ${JSON.stringify(seq)})`);
    } finally { teardown(); }
  });

  test('?raf2: same ordering, and the entry is still recorded exactly once', async () => {
    setup({ raf2: true });
    try {
      await navigate(location.origin + '/swipe-ab-raf2');
      await settleFrames();

      assert.deepEqual(seq, ['push', 'frame', 'mutate'],
        `the double-frame lever must also swap after a frame (got ${JSON.stringify(seq)})`);
      // The lever calls the one-shot thunk itself and `applySwap` calls it
      // again at its commit point, so the guard is the only thing between this
      // and a duplicated history entry.
      assert.equal(pushes.length, 1, 'exactly one pushState per navigation under the lever');
    } finally { teardown(); }
  });

  test('?raf: the #1410 guarantee survives, the outgoing page is still live at the push', async () => {
    setup({ raf: true });
    try {
      await navigate(location.origin + '/swipe-ab-raf-state');
      await settleFrames();

      assert.equal(pushes.length, 1, 'the navigation recorded exactly one history entry');
      const at = pushes[0];
      // The lever moves the push EARLIER (ahead of the yield), so what #1410
      // pinned has to still hold: a lever that fixed the frame timing by
      // sacrificing the recorded state would be a regression wearing a fix.
      assert.ok(at.text.includes(OUTGOING_SENTINEL),
        'the outgoing page is still in the DOM at the pushState call');
      assert.ok(!at.text.includes(INCOMING_SENTINEL),
        'the incoming page has NOT been swapped in yet at the pushState call');
      assert.ok(at.scrollY >= SCROLL_TO - 5,
        `the outgoing scroll offset is still live at the pushState call (expected about ${SCROLL_TO}, got ${at.scrollY})`);
    } finally { teardown(); }
  });
});
