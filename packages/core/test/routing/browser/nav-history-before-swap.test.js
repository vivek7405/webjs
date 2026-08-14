/**
 * Real-browser test for #1406: the client router must record a forward
 * navigation's history entry BEFORE it swaps the DOM.
 *
 * WebKit binds a same-document (`pushState`) entry's back-forward gesture
 * snapshot to the page state at the moment the entry is recorded. The router
 * used to push AFTER `applySwap`, so the entry for the OUTGOING url was
 * finalized against the INCOMING document, at a scroll offset the browser had
 * already clamped to that document's height. On iOS the edge back-swipe then
 * previews a page that never existed and renders blank (measured on
 * `gallery.webjs.dev`: an offset of 1600 clamped to 252 at the push).
 *
 * The pixels are iOS-only and cannot be asserted here. What CAN be asserted
 * anywhere is the state the browser captures FROM, which is exactly the thing
 * that was wrong: at the `pushState` call, the document must still hold the
 * outgoing page and `window.scrollY` must still hold the outgoing offset.
 *
 * This has to be a real browser: the assertion is about a scroll offset the
 * engine clamps against real layout, and linkedom has neither.
 */
import { enableClientRouter, navigate } from '../../../src/router-client.js';

import { assert } from '../../../../../test/browser-assert.js';
import { installNavGuard } from '../../../../../test/browser-nav-guard.js';

const OUTGOING_SENTINEL = 'outgoing-page-1406';
const INCOMING_SENTINEL = 'incoming-page-1406';
const SCROLL_TO = 800;

suite('Client router: history is recorded before the swap (#1406)', () => {
  let origFetch, origPushState, navGuard, pushes;

  function setup() {
    enableClientRouter(); // idempotent; ensures the document listeners are attached
    // The swap can still degrade to a hard navigation, and an escaped
    // `location.href` assignment aborts the whole web-test-runner session
    // rather than failing one test.
    navGuard = installNavGuard();

    // A genuinely TALL outgoing document, so the window really scrolls and the
    // incoming (short) one really clamps it. Both sides carry the same boundary
    // segment so the swap takes the keyed-boundary tier rather than degrading.
    document.body.innerHTML =
      `<!--wj:children:/:/-->${OUTGOING_SENTINEL}<div style="height:3000px"></div><!--/wj:children:/-->`;

    // NOT stubbed: unlike `nav-scroll-instant.test.js`, the point here is the
    // real, engine-clamped offset, so the scroll has to actually happen.
    window.scrollTo({ left: 0, top: SCROLL_TO, behavior: 'instant' });

    pushes = [];
    origPushState = history.pushState;
    history.pushState = function (...args) {
      pushes.push({
        text: document.body.textContent || '',
        scrollY: window.scrollY,
      });
      return origPushState.apply(this, args);
    };

    origFetch = window.fetch;
    // A SHORT destination: same boundary segment, different sentinel, no tall
    // block. `x-webjs-build: ''` matches the sibling files, so the importmap
    // guard sees an unknown build id and does not hard-reload.
    window.fetch = () => Promise.resolve(new Response(
      '<!doctype html><html><head></head><body>' +
      `<!--wj:children:/:/-->${INCOMING_SENTINEL}<!--/wj:children:/--></body></html>`,
      { headers: { 'content-type': 'text/html', 'x-webjs-build': '' } },
    ));
  }

  function teardown() {
    window.fetch = origFetch;
    history.pushState = origPushState;
    if (navGuard) navGuard.remove();
    document.body.innerHTML = '';
    window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
  }

  test('at the pushState call the outgoing page is still live at its own scroll offset', async () => {
    setup();
    try {
      await navigate(location.origin + '/history-before-swap-target');

      assert.equal(navGuard.hardNavigations.length, 0,
        `the swap must not degrade here (fallbacks: ${JSON.stringify(navGuard.fallbacks)})`);
      assert.equal(pushes.length, 1, 'the navigation recorded exactly one history entry');

      const at = pushes[0];
      // Half one: the DOM the browser would snapshot is still the outgoing page.
      assert.ok(at.text.includes(OUTGOING_SENTINEL),
        'the outgoing page is still in the DOM at the pushState call');
      assert.ok(!at.text.includes(INCOMING_SENTINEL),
        'the incoming page has NOT been swapped in yet at the pushState call');
      // Half two: and it is still at the offset that entry belongs to. Without
      // the fix the engine has already clamped this to the short document's
      // maximum, which is what makes the restored snapshot meaningless.
      assert.ok(at.scrollY >= SCROLL_TO - 5,
        `the outgoing scroll offset is still live at the pushState call (expected about ${SCROLL_TO}, got ${at.scrollY})`);
    } finally { teardown(); }
  });

  test('the entry is recorded exactly once per navigation', async () => {
    // The push now rides into `applySwap` as a commit-time callback AND is
    // called again on the caller's fall-through, so the thunk's one-shot guard
    // is the only thing standing between this and a duplicated history entry.
    // That guard is what this asserts.
    setup();
    try {
      await navigate(location.origin + '/history-before-swap-once');
      assert.equal(pushes.length, 1, 'exactly one pushState per navigation');
    } finally { teardown(); }
  });
});
