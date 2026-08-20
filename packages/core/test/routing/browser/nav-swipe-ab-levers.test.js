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
import { disableClientRouter, enableClientRouter, navigate } from '../../../src/router-client.js';

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

  test('?scrolllast: the scroll-to-top lands after a frame, not in the swap\'s task', async () => {
    setup({ scrolllast: true });
    const scrolls = [];
    const origScrollTo = window.scrollTo;
    try {
      // Recorded rather than suppressed: the lever is about WHEN the write
      // happens, so the write still has to happen.
      window.scrollTo = function (...args) { scrolls.push(seq.slice()); return origScrollTo.apply(this, args); };
      await navigate(location.origin + '/swipe-ab-scrolllast');
      const beforeFrame = scrolls.length;
      await settleFrames();

      assert.equal(beforeFrame, 0,
        `the deferred scroll must not have run yet when the navigation resolved (ran ${beforeFrame} times)`);
      assert.equal(scrolls.length, 1, 'the scroll still runs, one frame later');
      assert.ok(scrolls[0].includes('frame'),
        `the scroll landed after a frame boundary (trace at the write: ${JSON.stringify(scrolls[0])})`);
    } finally { window.scrollTo = origScrollTo; teardown(); }
  });

  test('?scrolllast: a superseded navigation does not scroll the page that replaced it', async () => {
    setup({ scrolllast: true });
    const scrolls = [];
    const origScrollTo = window.scrollTo;
    try {
      window.scrollTo = function (...args) { scrolls.push('scroll'); return origScrollTo.apply(this, args); };
      await navigate(location.origin + '/swipe-ab-superseded');

      // Start a second navigation inside the deferred scroll's frame gap. It
      // bumps the nav token and then does nothing else, which isolates the
      // guard from anything the newer navigation would itself have done to
      // scroll.
      //
      // Aborted rather than left pending. A fetch that never settles leaves a
      // navigation in flight for the rest of the page's life, holding the
      // router's token and its own frame state, and a test that never cleans
      // that up is a leak looking for somewhere to surface. An AbortError is
      // the shape the router already treats as a superseded navigation, so it
      // settles down the path it would take in production.
      let abortPending;
      window.fetch = () => new Promise((_, reject) => { abortPending = reject; });
      const superseder = navigate(location.origin + '/swipe-ab-superseder');
      await settleFrames();
      if (abortPending) abortPending(new DOMException('aborted', 'AbortError'));
      await superseder.catch(() => {});

      // Without the token guard the first navigation's scroll fires here, into
      // a document a newer navigation already owns.
      assert.equal(scrolls.length, 0,
        'the superseded navigation abandoned its deferred scroll');
    } finally { window.scrollTo = origScrollTo; teardown(); }
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

/**
 * The `?scrollauto` lever (#1428).
 *
 * Separate suite because it is the one lever that acts at ROUTER ENABLE rather
 * than mid-navigation, so the flag has to be in place before the router
 * installs itself, which is the opposite ordering from the paint-timing levers
 * above.
 *
 * Why this lever exists at all: an on-device prior-art run put
 * `history.scrollRestoration` at the centre of the bug. WebJs sets 'manual' and
 * blanks the preview, Turbo Drive sets 'manual' and blanks it too, and Next's
 * App Router leaves 'auto' and is clean. Push ordering, the thing #1410
 * changed, runs the other way across those three, so it cannot be the cause.
 *
 * What a browser can assert is the property itself, in both directions. The
 * gesture preview remains iOS-only.
 */
suite('Client router: scrollauto lever (#1428)', () => {
  let saved, savedDiag;

  setup(() => {
    saved = history.scrollRestoration;
    savedDiag = window.__webjsDiag;
    disableClientRouter();
    // A fresh document load starts at 'auto'. Establish that baseline
    // explicitly: the lever SKIPS the assignment rather than writing 'auto',
    // so a leftover 'manual' from another suite would mask a working lever.
    history.scrollRestoration = 'auto';
  });

  teardown(() => {
    disableClientRouter();
    if (savedDiag === undefined) delete window.__webjsDiag;
    else window.__webjsDiag = savedDiag;
    history.scrollRestoration = saved;
  });

  test('default: the router takes manual control, exactly as it does today', () => {
    delete window.__webjsDiag;
    enableClientRouter();
    assert.equal(
      history.scrollRestoration, 'manual',
      'with no lever the production path must be unchanged',
    );
  });

  test('?scrollauto: the browser keeps ownership of per-entry scroll', () => {
    window.__webjsDiag = { scrollauto: true };
    enableClientRouter();
    assert.equal(
      history.scrollRestoration, 'auto',
      'the lever must leave scroll restoration with the browser',
    );
  });

  test('a paint-timing lever does NOT change scroll restoration', () => {
    // The levers have to stay independent or a device run cannot attribute its
    // verdict to one of them.
    window.__webjsDiag = { raf: true, raf2: true, scrolllast: true };
    enableClientRouter();
    assert.equal(
      history.scrollRestoration, 'manual',
      'only ?scrollauto may move this property',
    );
  });
});
