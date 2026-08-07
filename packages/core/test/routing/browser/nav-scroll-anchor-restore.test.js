/**
 * Real-browser test for #1310: a Back/Forward scroll restore must survive the
 * restored page growing after the swap.
 *
 * The router records a snapshot's `scrollY` against the page at its SETTLED
 * height. On restore it replays that number onto a document that has only just
 * been swapped in and is still shorter, because the components in the restored
 * markup have not upgraded and re-rendered yet. When they do, content grows
 * ABOVE the viewport, and the browser's scroll anchoring (`overflow-anchor:
 * auto`, the UA default) holds the VISUAL position by adding that growth to
 * `scrollY`. The recorded offset is counted twice, and the reader lands below
 * where they left (763px on webjs.dev's `/ui/button`).
 *
 * This MUST run in a real browser. linkedom implements neither scroll anchoring
 * nor real scrolling, so only a live engine can prove the offset survives. All
 * three engines in the matrix implement anchoring and honour `overflow-anchor:
 * none` on the root scroller, so there is no engine skip here.
 *
 * The fixture has to GROW AFTER THE SWAP, since the growth is the whole
 * mechanism. A custom element that takes its height one frame after it is
 * connected models the real cause: as raw parsed markup it is 0px tall, and it
 * reaches its real size only once its own render has run.
 */
import { enableClientRouter, disableClientRouter, navigate, _snapshotCache, _setCurrentPageUrl, _bumpNavToken } from '../../../src/router-client.js';

import { assert } from '../../../../../test/browser-assert.js';
import { installNavGuard } from '../../../../../test/browser-nav-guard.js';

/** Height the restored content gains after the swap, matching the live defect. */
const GROWTH = 763;
/** Where the reader was when they navigated away. */
const RESTORED_Y = 800;

/**
 * Grows one frame AFTER connection, never during it. The delay is load-bearing:
 * a synchronous height would land in the same layout as the swap, so the
 * browser would have nothing to anchor against and the defect would not
 * reproduce at all. The real page grows ~25ms after its swap.
 */
class GrowLate extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block';
    this.style.height = '0px';
    requestAnimationFrame(() => { this.style.height = GROWTH + 'px'; });
  }
}
customElements.define('wj-grow-late-1310', GrowLate);

/**
 * The same grower, but slow enough that a revalidation answering instantly
 * settles BEFORE it. On the deployed site the growth lands ~65ms after the swap
 * and the revalidation's own swap ~300ms after that, so the revalidation is
 * comfortably the slower of the two. That ordering is a property of one
 * deployment, not a guarantee: a local server, a 304, or a warm cache can answer
 * in single-digit milliseconds. This models the inverted case.
 */
class GrowVeryLate extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block';
    this.style.height = '0px';
    let n = 0;
    const tick = () => {
      if (++n >= 8) { this.style.height = GROWTH + 'px'; return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}
customElements.define('wj-grow-very-late-1310', GrowVeryLate);

/**
 * Never grows on its own; the test grows it. The clamped cases need the restored
 * page to be SHORT at the moment of the restore and TALL a moment later, and
 * driving that from the test removes every timing race from the precondition:
 * whether a leftover element is reused no longer matters, since this one is 0px
 * either way. The self-growing fixtures above still carry the headline cases,
 * where late growth arriving on its own IS the thing under test.
 */
class GrowOnCommand extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block';
    this.style.height = '0px';
  }
}
customElements.define('wj-grow-on-command-1310', GrowOnCommand);

/**
 * Offset the un-grown fixture cannot reach (its filler is 3000px, so its maximum
 * is under that whatever the viewport) but the grown one can, once the test adds
 * 3000px more.
 */
const CLAMPED_TARGET = 4000;
/** How much the test grows the on-command fixture by. */
const COMMANDED_GROWTH = 3000;

const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
/** Long enough for the grower to connect, lay out, and take its height. */
async function afterGrowth() { for (let i = 0; i < 4; i++) await frame(); }

/**
 * The restored page: a grower that is 0px in markup and 763px once it renders,
 * followed by enough filler to make the recorded offset reachable. The grower
 * sits entirely above the viewport at `RESTORED_Y`, which is where anchoring
 * acts.
 */
function restoredBody(tag, extra) {
  // The wrapper id lets `teardown` remove the fixture: the restore REPLACES the
  // whole body and nothing puts the original back, so each case would otherwise
  // leave its markup in the document.
  return '<!--wj:children:/:/anchor-restore-a-->'
    + '<div id="wj-restored-1310">'
    + (extra || '')
    + `<${tag}></${tag}>`
    + '<div style="height:3000px">restored</div>'
    + '</div>'
    + '<!--/wj:children:/-->';
}

function restoredHtml(tag, head, extra) {
  return `<!doctype html><html><head>${head || ''}</head><body>`
    + restoredBody(tag, extra) + '</body></html>';
}

/**
 * The view-transition opt-in, in the SNAPSHOT's head rather than the live
 * document's. That placement is load-bearing: the full-body restore merges the
 * incoming head BEFORE it decides whether to run a transition, so a meta added
 * only to the live document is gone by the time that check runs and the
 * transition never engages. A real snapshot carries it, since it is serialized
 * from the live document.
 */
const VT_META = '<meta name="view-transition" content="same-origin">';



/**
 * A same-document history entry for this test page, carrying one extra query
 * param. Built from the LIVE url rather than `location.pathname`, because the
 * test page's own query string identifies the web-test-runner session: dropping
 * it here rewrites the page out of its session and takes down the whole run
 * (with every test still passing, so it reads as an infrastructure blip).
 *
 * @param {string} tag
 * @returns {string} pathname + search, which is also the router's cache key
 */
function entryUrl(tag) {
  const u = new URL(location.href);
  u.searchParams.set('wj', tag);
  return u.pathname + u.search;
}

suite('Client router: a Back restore survives late layout growth (#1310)', () => {
  let navGuard, container, origFetch, origScrollBehavior, origUrl, entriesPushed;
  /** Resolves the in-flight revalidation, so a case controls the window's close. */
  let releaseFetch;
  /** Frame self-loads seen, so a case can prove its fixture actually loaded. */
  let frameLoads = 0;
  /** Frame-targeted navigations seen, so a case can prove the click routed. */
  let frameNavs = 0;

  /**
   * @param {{ instantRevalidation?: boolean, restoredY?: number }} [opts] By
   *   default the revalidation is held open so a case can assert inside the
   *   restore window. `instantRevalidation` answers it immediately instead,
   *   which is the ordering a fast server produces. `restoredY` overrides the
   *   recorded offset, so a case can force the clamped path, `manualGrowth`
   *   swaps in a grower the test drives by hand, `viewTransition` puts the
   *   view-transition opt-in in the snapshot's head, and `withFrame` puts an
   *   eager `<webjs-frame src>` in the restored page.
   */
  async function setup(opts) {
    const instant = Boolean(opts && opts.instantRevalidation);
    const restoredY = (opts && opts.restoredY) != null ? opts.restoredY : RESTORED_Y;
    const outgoingHeight = (opts && opts.tallOutgoing) ? 60000 : 3000;
    const html = restoredHtml(
      (opts && opts.manualGrowth) ? 'wj-grow-on-command-1310'
        : instant ? 'wj-grow-very-late-1310' : 'wj-grow-late-1310',
      (opts && opts.viewTransition) ? VT_META : '',
      (opts && opts.withFrame)
        ? '<webjs-frame id="wj-anchor-frame" src="/wj-frame-target-1310"></webjs-frame>'
        : '');
    // Clear any fixture a previous case left in the document BEFORE starting.
    // Teardown removes it, but a revalidation swap can land after teardown has
    // run and put it back, and a leftover grower is already at full height, so
    // the swap reuses it and the next restore is no longer clamped. Removing it
    // here as well is what makes the clamped precondition hold every time; on
    // Firefox it failed roughly one run in three without this.
    const stale = document.getElementById('wj-restored-1310');
    if (stale) stale.remove();
    navGuard = installNavGuard();
    enableClientRouter();
    origScrollBehavior = document.documentElement.style.scrollBehavior;
    // A restore under `scroll-behavior: smooth` is what #601 made instant; keep
    // the default here so the assertions are about position, not animation.
    document.documentElement.style.scrollBehavior = '';

    // The page being navigated AWAY from. Its route-key differs from the
    // restored page's, so the swap replaces rather than morphs and the restored
    // grower is a genuinely new element that upgrades. That is the real shape:
    // Back goes from one page to another, not to itself.
    container = document.createElement('div');
    container.innerHTML =
      '<!--wj:children:/:/anchor-restore-b-->'
      + `<div style="height:${outgoingHeight}px">outgoing</div>`
      + '<!--/wj:children:/-->';
    document.body.appendChild(container);

    // The revalidation is held open by default, so a case can assert inside the
    // restore window. Its response repeats the restored markup, which is what
    // the server would send.
    origFetch = window.fetch;
    const respond = () => new Response(html, {
      headers: { 'content-type': 'text/html', 'x-webjs-build': '' },
    });
    frameLoads = 0;
    frameNavs = 0;
    const count = (u) => {
      if (String(u).includes('wj-frame-target')) frameLoads += 1;
      if (String(u).includes('wj-frame-nav-1310')) frameNavs += 1;
    };
    window.fetch = instant
      ? (u) => { count(u); return Promise.resolve(respond()); }
      : (u) => { count(u); return new Promise((resolve) => { releaseFetch = () => resolve(respond()); }); };

    // Two real same-document history entries, so `history.back()` drives a REAL
    // popstate. Reassigning `location` is impossible in a browser, and a
    // synthetic popstate event would not exercise the browser's own restore.
    origUrl = location.href;
    history.pushState(null, '', entryUrl('anchor-a'));
    history.pushState(null, '', entryUrl('anchor-b'));
    entriesPushed = true;
    _snapshotCache.set(entryUrl('anchor-a'), {
      html, scrollX: 0, scrollY: restoredY,
    });
    _setCurrentPageUrl(location.href);
    // Start where the reader was, so the restore is a real scroll rather than
    // a no-op from 0.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }

  /** Drive a real Back and wait for the router's synchronous restore to land. */
  async function goBack() {
    const popped = new Promise((r) => window.addEventListener('popstate', r, { once: true }));
    history.back();
    await popped;
    // The router's popstate handler runs on the same event, and its cache-hit
    // branch is synchronous through the restore. One task is enough to be past
    // it without letting a frame paint.
    await new Promise((r) => setTimeout(r, 0));
  }

  async function teardown() {
    if (releaseFetch) releaseFetch();
    releaseFetch = null;
    window.fetch = origFetch;
    // Let the released revalidation finish so it cannot swap during a later case.
    for (let i = 0; i < 6; i++) await frame();
    disableClientRouter();
    _snapshotCache.delete(entryUrl('anchor-a'));
    _setCurrentPageUrl(null);
    if (entriesPushed) {
      // Restore the EXACT url the page was served at, session query string
      // included.
      history.replaceState(null, '', origUrl);
      entriesPushed = false;
    }
    container.remove();
    // The swapped-in restored page, which replaced the body wholesale.
    const restored = document.getElementById('wj-restored-1310');
    if (restored) restored.remove();
    // The head merge can bring the opt-in into the live document.
    document.querySelectorAll('meta[name="view-transition"]').forEach((m) => m.remove());
    document.documentElement.style.removeProperty('overflow-anchor');
    document.documentElement.style.scrollBehavior = origScrollBehavior;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    navGuard.remove();
    enableClientRouter();
  }

  test('a CLAMPED restore is left alone, so the reader is not stranded high', async () => {
    // The mirror image of this bug, and the reason suppression is conditional.
    //
    // A document that has not grown yet can be too short to scroll to the
    // recorded offset at all, so the browser clamps to its current maximum. The
    // shortfall is then the growth still to come, and anchoring adding that
    // growth is what carries the reader back down. Suppressing there would
    // freeze the clamp and strand them a full page-growth ABOVE where they
    // left, measured at 763px on the reported page: the same error as the bug,
    // pointing the other way.
    //
    // The recorded offset here is far past anything the un-grown document can
    // reach, so the clamp is certain whatever the runner's viewport height is.
    await setup({ restoredY: 50000 });
    try {
      await goBack();
      assert.ok(window.scrollY < 50000,
        'precondition: the restore was clamped, so this is the case under test');
      assert.equal(document.documentElement.style.getPropertyValue('overflow-anchor'), '',
        'a clamped restore installs no window while the offset is out of '
        + 'reach, leaving the browser to heal the clamp as the page grows');
    } finally { await teardown(); }
  });

  test('a second navigation inside the window closes it', async () => {
    // The window deliberately outlives its own restore (a floor, then a
    // ceiling), so a navigation starting inside that span must end it. Without
    // this, a Back that CLAMPS opens no window of its own and would run its
    // whole growth under the PREVIOUS restore's suppression, freezing its
    // clamp; a forward nav would carry the suppression onto another page.
    await setup();
    try {
      await goBack();
      assert.equal(document.documentElement.style.getPropertyValue('overflow-anchor'), 'none',
        'precondition: a window is open');
      // Well inside the floor, so nothing else could have closed it. NOT
      // awaited: the close is the point and it happens as the navigation
      // STARTS, while this setup holds the fetch open so the navigation itself
      // never settles.
      navigate(location.origin + entryUrl('second-nav')).catch(() => {});
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(document.documentElement.style.getPropertyValue('overflow-anchor'), '',
        'starting another navigation ends the previous restore\'s window');
    } finally { await teardown(); }
  });

  test('under a view transition the decision waits for the swap to commit', async () => {
    // `applySwap` defers its DOM mutation a frame when a transition is running,
    // so writing and measuring the scroll straight through would act on the
    // OUTGOING page. Here that page is far taller than the restored one, so a
    // decision taken against it says "landed" and suppresses anchoring, and the
    // restored page then clamps with anchoring held off. That is the stranding
    // the clamped path exists to avoid, arriving by a different route.
    //
    // The transition is SIMULATED. A hidden document skips a real one, and the
    // runner puts test files in concurrent pages, so the deferred path is not
    // otherwise reachable from this suite on any engine. The stub defers the
    // callback exactly as the spec does.
    const origSVT = (/** @type any */ (document)).startViewTransition;
    let transitions = 0;
    (/** @type any */ (document)).startViewTransition = (cb) => {
      transitions += 1;
      const done = new Promise((resolve) => {
        requestAnimationFrame(() => { cb(); resolve(); });
      });
      return { updateCallbackDone: done, finished: done, ready: done, skipTransition() {} };
    };
    await setup({ restoredY: CLAMPED_TARGET, manualGrowth: true, viewTransition: true, tallOutgoing: true });
    try {
      await goBack();
      assert.ok(transitions > 0,
        'precondition: the swap actually ran through a view transition');
      for (let i = 0; i < 4; i++) await frame();
      assert.equal(document.documentElement.style.getPropertyValue('overflow-anchor'), '',
        'the clamp is judged against the restored page, so a restore that '
        + 'clamps leaves anchoring alone rather than freezing it');
    } finally {
      await teardown();
      (/** @type any */ (document)).startViewTransition = origSVT;
    }
  });

  test('a navigation during a deferred restore cancels it, not the other way round', async () => {
    // The view-transition path is the one place the restore OUTLIVES the call
    // that scheduled it, and every cancel site in this feature runs at the start
    // of the next thing. So a navigation arriving inside the deferred frame
    // would close the window and then have the stale restore reopen it, keyed to
    // the previous history entry, scrolling a page it was never meant for.
    const origSVT = (/** @type any */ (document)).startViewTransition;
    let transitions = 0;
    (/** @type any */ (document)).startViewTransition = (cb) => {
      transitions += 1;
      const done = new Promise((resolve) => {
        requestAnimationFrame(() => { cb(); resolve(); });
      });
      return { updateCallbackDone: done, finished: done, ready: done, skipTransition() {} };
    };
    await setup({ viewTransition: true, tallOutgoing: true });
    try {
      await goBack();
      assert.ok(transitions > 0,
        'precondition: the swap really was deferred. On the synchronous path '
        + 'the restore has already run and the navigation below simply closes '
        + 'its window, which passes while exercising none of the guard');
      // Inside the deferred frame: the swap has not committed, so the restore
      // is still pending. Not awaited, since the point is that it STARTS.
      navigate(location.origin + entryUrl('during-deferred')).catch(() => {});
      for (let i = 0; i < 6; i++) await frame();
      assert.equal(document.documentElement.style.getPropertyValue('overflow-anchor'), '',
        'the superseded restore does not reopen a window on the page that '
        + 'replaced it');
    } finally {
      await teardown();
      (/** @type any */ (document)).startViewTransition = origSVT;
    }
  });

  test('a frame self-load in the restored page does not cancel the restore', async () => {
    // `loadFrame` shares the global navigation token, and an eager
    // `<webjs-frame src>` inside a restored snapshot loads as part of the swap.
    // Keying the deferred restore on that token therefore reads a routine frame
    // load as a supersede and drops the restore entirely, leaving the reader at
    // the outgoing page's offset, which is worse than the defect being fixed.
    // The restore is keyed to its own supersede counter instead.
    const origSVT = (/** @type any */ (document)).startViewTransition;
    let transitions = 0;
    (/** @type any */ (document)).startViewTransition = (cb) => {
      transitions += 1;
      const done = new Promise((resolve) => {
        requestAnimationFrame(() => { cb(); resolve(); });
      });
      return { updateCallbackDone: done, finished: done, ready: done, skipTransition() {} };
    };
    await setup({ viewTransition: true, withFrame: true });
    try {
      await goBack();
      for (let i = 0; i < 6; i++) await frame();
      assert.ok(transitions > 0 && frameLoads > 0,
        'precondition: the swap was deferred AND the frame actually '
        + 'self-loaded, so this is not silently a duplicate of the plain '
        + 'restore case');
      assert.ok(Math.abs(window.scrollY - RESTORED_Y) < 5,
        'the restore still runs with a self-loading frame in the page '
        + `(expected ~${RESTORED_Y}, got ${window.scrollY})`);
    } finally {
      await teardown();
      (/** @type any */ (document)).startViewTransition = origSVT;
    }
  });

  test('a bare nav-token bump does not cancel a deferred restore', async () => {
    // The counterfactual for keying the deferred restore to its own supersede
    // counter rather than to `currentNavigationToken`. Every other case here
    // supersedes with `navigate()`, which moves BOTH, so none of them can tell
    // the two implementations apart. This moves only the nav token, which is
    // what a frame self-load does: under the old keying the restore is dropped
    // and the reader is left at the outgoing offset, under the current one it
    // runs.
    const origSVT = (/** @type any */ (document)).startViewTransition;
    let transitions = 0;
    (/** @type any */ (document)).startViewTransition = (cb) => {
      transitions += 1;
      const done = new Promise((resolve) => {
        requestAnimationFrame(() => { cb(); resolve(); });
      });
      return { updateCallbackDone: done, finished: done, ready: done, skipTransition() {} };
    };
    await setup({ viewTransition: true });
    try {
      await goBack();
      assert.ok(transitions > 0,
        'precondition: the swap really was deferred, or the bump below lands '
        + 'after the restore has already run and proves nothing');
      // Inside the deferred frame, before the swap commits.
      _bumpNavToken();
      for (let i = 0; i < 6; i++) await frame();
      assert.ok(Math.abs(window.scrollY - RESTORED_Y) < 5,
        'a nav-token bump that is not a page navigation must not drop the '
        + `restore (expected ~${RESTORED_Y}, got ${window.scrollY})`);
    } finally {
      await teardown();
      (/** @type any */ (document)).startViewTransition = origSVT;
    }
  });

  test('a FRAME-targeted navigation leaves an open window alone', async () => {
    // A frame nav swaps one region and leaves the page, so it must not end a
    // restore. The exemption has to cover all three of the counter, the
    // suppression window and the catch-up: closing the window here would hand
    // anchoring back mid-restore and bring the whole double-count back, and it
    // needs no user input to happen (a component upgrading in the just-restored
    // page can submit or navigate a frame on its own).
    await setup();
    try {
      await goBack();
      assert.equal(document.documentElement.style.getPropertyValue('overflow-anchor'), 'none',
        'precondition: a window is open');
      const holder = document.createElement('div');
      holder.innerHTML = '<webjs-frame id="wj-target-frame-1310">'
        + '<a id="wj-frame-link" href="/wj-frame-nav-1310">go</a></webjs-frame>';
      document.body.appendChild(holder);
      try {
        holder.querySelector('#wj-frame-link').click();
        await new Promise((r) => setTimeout(r, 0));
        // Positive proof the click actually routed. Without this the assertion
        // below also passes when the router never saw the click at all, which
        // is the only other way the window stays open.
        assert.ok(frameNavs > 0,
          'precondition: the click reached the router as a frame-targeted nav');
        assert.equal(document.documentElement.style.getPropertyValue('overflow-anchor'), 'none',
          'a frame-targeted navigation must leave the restore window open');
      } finally { holder.remove(); }
    } finally { await teardown(); }
  });

  test('a FRAME-targeted submission leaves an open window alone', async () => {
    // The submission half of the frame exemption. `performSubmission` has its
    // own `!frameId` guard, and nothing exercised it: the page-level submission
    // case below uses a bare form, and the frame case above uses a link, so
    // deleting `frameId` from that guard left every suite green.
    await setup();
    try {
      await goBack();
      assert.equal(document.documentElement.style.getPropertyValue('overflow-anchor'), 'none',
        'precondition: a window is open');
      const holder = document.createElement('div');
      holder.innerHTML = '<webjs-frame id="wj-target-frame-sub-1310">'
        + '<form id="wj-frame-form" method="post" action="/wj-frame-nav-1310">'
        + '<button type="submit">go</button></form></webjs-frame>';
      document.body.appendChild(holder);
      try {
        const f = holder.querySelector('#wj-frame-form');
        f.requestSubmit(f.querySelector('button'));
        await new Promise((r) => setTimeout(r, 0));
        assert.ok(frameNavs > 0,
          'precondition: the submission reached the router as frame-targeted');
        assert.equal(document.documentElement.style.getPropertyValue('overflow-anchor'), 'none',
          'a frame-targeted submission must leave the restore window open');
      } finally { holder.remove(); }
    } finally { await teardown(); }
  });

  test('a form SUBMISSION inside the window closes it too', async () => {
    // A submission is a navigation and runs its own pipeline
    // (`performSubmission`), so it needs the same close as `performNavigation`.
    // Covered separately because a test that only drives `navigate()` leaves
    // that second call site free to be deleted with every suite still green.
    await setup();
    // Declared out here so the `finally` can release it whatever the assertion
    // does. Everything else this file creates is released from `teardown()`,
    // and a live form left attached to the body would outlast the whole run.
    let holder = null;
    try {
      await goBack();
      assert.equal(document.documentElement.style.getPropertyValue('overflow-anchor'), 'none',
        'precondition: a window is open');
      // Appended to the LIVE body, not to `container`: the restore swaps the
      // body wholesale, so `container` is detached by now and a form inside it
      // would never reach the router's document-level submit listener.
      holder = document.createElement('div');
      holder.innerHTML = '<form id="wj-anchor-form" method="post" '
        + `action="${entryUrl('submit-target')}"><button type="submit">go</button></form>`;
      document.body.appendChild(holder);
      const form = holder.querySelector('#wj-anchor-form');
      // Well inside the floor. The router intercepts this and the nav guard
      // cancels the browser's own submission, so nothing leaves the page.
      form.requestSubmit(form.querySelector('button'));
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(document.documentElement.style.getPropertyValue('overflow-anchor'), '',
        'a submission ends the previous restore\'s window, same as a link nav');
    } finally {
      if (holder) holder.remove();
      await teardown();
    }
  });

  test('a clamped restore is CHASED to the exact recorded offset', async () => {
    // Leaving anchoring on is not enough on its own. It adds the FULL growth
    // whatever the shortfall was, so it only lands a reader who left at the very
    // bottom, where those two numbers coincide; anyone above that is carried too
    // far (1902 came back as 2002 on /ui/button). The catch-up re-asserts the
    // recorded offset the moment the page is tall enough to hold it.
    //
    // The target sits inside the band only the grown page can reach, and the
    // fixture grows by 3000px so that band does not depend on the runner's
    // viewport height.
    await setup({ restoredY: CLAMPED_TARGET, manualGrowth: true });
    try {
      await goBack();
      assert.ok(window.scrollY < CLAMPED_TARGET - 1,
        `precondition: the restore was clamped (got ${window.scrollY} for ${CLAMPED_TARGET})`);
      // Now make the offset reachable, which is what the catch-up waits for.
      document.querySelector('wj-grow-on-command-1310').style.height = COMMANDED_GROWTH + 'px';
      for (let i = 0; i < 12; i++) await frame();
      assert.ok(Math.abs(window.scrollY - CLAMPED_TARGET) < 5,
        'the catch-up lands on the recorded offset once it is reachable '
        + `(expected ~${CLAMPED_TARGET}, got ${window.scrollY})`);
    } finally { await teardown(); }
  });

  test('landing on the offset opens a window, which closes on the chase deadline', async () => {
    // The landed suppression had no assertion on it at all: every clamped case
    // reads `scrollY` only, and the one that reads `overflow-anchor` uses an
    // offset that never becomes reachable, so it never lands. Deleting the
    // suppression left every suite green apart from the staged-growth case.
    await setup({ restoredY: CLAMPED_TARGET, manualGrowth: true });
    try {
      await goBack();
      assert.equal(document.documentElement.style.getPropertyValue('overflow-anchor'), '',
        'precondition: a clamped restore opens no window while the offset is '
        + 'still out of reach');
      document.querySelector('wj-grow-on-command-1310').style.height = COMMANDED_GROWTH + 'px';
      for (let i = 0; i < 6; i++) await frame();
      assert.ok(Math.abs(window.scrollY - CLAMPED_TARGET) < 5,
        'precondition: the chase landed');
      assert.equal(document.documentElement.style.getPropertyValue('overflow-anchor'), 'none',
        'landing on the recorded offset protects it, since the growth that '
        + 'made it reachable is rarely all of it');
      // The window rides the chase's own deadline, measured from the restore.
      await new Promise((r) => setTimeout(r, 900));
      assert.equal(document.documentElement.style.getPropertyValue('overflow-anchor'), '',
        'and it closes on that deadline, leaving no residue');
    } finally { await teardown(); }
  });

  test('a clamped restore survives growth that arrives in STAGES', async () => {
    // The real cause of the growth is components upgrading and rendering one at
    // a time, so it arrives in pieces. Every other clamped case grows in a
    // single assignment, which is the easy shape: the catch-up writes the offset
    // once and the page never moves again. With staged growth the page keeps
    // growing after that write, and anchoring is deliberately left ON here, so
    // each later stage is added on top of the offset and carries the reader
    // below it.
    await setup({ restoredY: CLAMPED_TARGET, manualGrowth: true });
    try {
      await goBack();
      assert.ok(window.scrollY < CLAMPED_TARGET - 1, 'precondition: clamped');
      const grower = document.querySelector('wj-grow-on-command-1310');
      // Stage one makes the offset EXACTLY reachable, computed from the live
      // viewport so it lands on the threshold rather than near it: the fixture
      // filler is 3000px, so a grower of `target + innerHeight - 3000` puts the
      // document's maximum scroll precisely at the target. That is the frame
      // the catch-up writes and stops on. Stage two then adds more above the
      // viewport, which is the growth that must not be counted on top.
      const stageOne = CLAMPED_TARGET + window.innerHeight - 3000;
      grower.style.height = stageOne + 'px';
      for (let i = 0; i < 6; i++) await frame();
      assert.ok(Math.abs(window.scrollY - CLAMPED_TARGET) < 5,
        `precondition: stage one let the catch-up land (got ${window.scrollY})`);
      grower.style.height = (stageOne + 1000) + 'px';
      for (let i = 0; i < 12; i++) await frame();
      assert.ok(Math.abs(window.scrollY - CLAMPED_TARGET) < 5,
        'staged growth must still land on the recorded offset '
        + `(expected ~${CLAMPED_TARGET}, got ${window.scrollY})`);
    } finally { await teardown(); }
  });

  test('the catch-up gives up after its window, and does not move a settled reader', async () => {
    // The bound is a live behaviour constant: past it a clamped restore stops
    // chasing. The other two catch-up cases grow the fixture immediately, so
    // they pass at any bound and none of them would notice it being widened
    // back to the ceiling. This is the case that pins it, and it is the reason
    // the bound exists: a reader who landed and started READING generates no
    // input to cancel the chase, so late-arriving growth must not scroll them.
    await setup({ restoredY: CLAMPED_TARGET, manualGrowth: true });
    try {
      await goBack();
      const clamped = window.scrollY;
      assert.ok(clamped < CLAMPED_TARGET - 1, 'precondition: the restore was clamped');
      // Past the window, with no input at any point.
      await new Promise((r) => setTimeout(r, 900));
      document.querySelector('wj-grow-on-command-1310').style.height = COMMANDED_GROWTH + 'px';
      for (let i = 0; i < 12; i++) await frame();
      assert.ok(Math.abs(window.scrollY - CLAMPED_TARGET) >= 5,
        'growth arriving after the window must not scroll a reader who never '
        + `asked (landed on ${CLAMPED_TARGET}, so the chase was still live)`);
    } finally { await teardown(); }
  });

  test('a reader taking over cancels the catch-up', async () => {
    // The catch-up WRITES scroll, unlike suppression, so it is the one part of
    // this that could yank someone. It stops on the same inputs a suppression
    // window closes on, before the offset becomes reachable.
    await setup({ restoredY: CLAMPED_TARGET, manualGrowth: true });
    try {
      await goBack();
      assert.ok(window.scrollY < CLAMPED_TARGET - 1,
        'precondition: the restore was clamped');
      // The reader takes over BEFORE the offset becomes reachable.
      window.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
      document.querySelector('wj-grow-on-command-1310').style.height = COMMANDED_GROWTH + 'px';
      for (let i = 0; i < 12; i++) await frame();
      // Asserted as "the catch-up never wrote", not as "nothing moved". The
      // clamped path deliberately leaves anchoring ON, so the browser still
      // carries the position as the page grows, exactly as it does on main.
      // What must not happen is this code adding a write of its own on top.
      assert.ok(Math.abs(window.scrollY - CLAMPED_TARGET) >= 5,
        'a reader who has taken over is never scrolled onto the recorded '
        + `offset (landed exactly on ${CLAMPED_TARGET}, so the catch-up wrote)`);
    } finally { await teardown(); }
  });

  test('anchoring WORKS again once the window has closed', async () => {
    // The inverse of the headline, and the regression that would matter most if
    // this fix were wrong: suppression is temporary, so once the restore is over
    // the browser must be holding the reader's position again exactly as it does
    // on any other page. Asserting only that the inline property is gone would
    // not catch a release that cleared the property while leaving anchoring
    // broken some other way, so this asserts the BEHAVIOUR: growth above the
    // viewport moves `scrollY` again.
    await setup({ instantRevalidation: true });
    try {
      await goBack();
      await new Promise((r) => setTimeout(r, 900));   // past the floor
      assert.equal(document.documentElement.style.getPropertyValue('overflow-anchor'), '',
        'precondition: the window is closed');

      const before = window.scrollY;
      const grower = document.createElement('div');
      grower.style.height = GROWTH + 'px';
      const region = document.querySelector('wj-grow-very-late-1310');
      region.parentNode.insertBefore(grower, region);
      // Anchoring acts at layout, so give it a frame to compensate.
      await frame();
      await frame();
      assert.ok(Math.abs((window.scrollY - before) - GROWTH) < 5,
        'with the window closed the browser holds the visual position again, '
        + `so ${GROWTH}px inserted above the viewport moves scrollY by that much `
        + `(moved ${window.scrollY - before})`);
      grower.remove();
    } finally { await teardown(); }
  });

  test('a forward navigation opens no window', async () => {
    // The fix is scoped to the popstate cache-hit branch. Every other scroll
    // path lands at offset 0 or targets an element, so anchoring is either inert
    // or correct there, and touching it would be a regression rather than a fix.
    // The instant stub, since a forward nav AWAITS its fetch (the popstate path
    // does not, which is why the other cases can hold it open).
    await setup({ instantRevalidation: true });
    try {
      await navigate(location.origin + entryUrl('forward-target'));
      assert.equal(document.documentElement.style.getPropertyValue('overflow-anchor'), '',
        'a forward nav never suppresses anchoring');
    } finally { await teardown(); }
  });

  test('a revalidation that never settles still releases on the ceiling', async () => {
    // The ceiling exists so a hung fetch cannot leave anchoring off for the life
    // of the page. Nothing else would ever release this window: the floor has
    // passed and the fetch never answers.
    await setup();
    try {
      await goBack();
      assert.equal(document.documentElement.style.getPropertyValue('overflow-anchor'), 'none');
      await new Promise((r) => setTimeout(r, 2400));   // past the 2s ceiling
      assert.equal(document.documentElement.style.getPropertyValue('overflow-anchor'), '',
        'the ceiling releases a window whose revalidation never came back');
    } finally { await teardown(); }
  });

  test('the restore opens a scroll-anchoring window', async () => {
    await setup();
    try {
      await goBack();
      assert.equal(document.documentElement.style.getPropertyValue('overflow-anchor'), 'none',
        'the restore suppresses anchoring, so the browser cannot add the ' +
        'restored page\'s late growth to the offset it just replayed');
    } finally { await teardown(); }
  });

  test('late growth above the viewport does not push the reader down', async () => {
    await setup();
    try {
      await goBack();
      const restored = window.scrollY;
      assert.ok(Math.abs(restored - RESTORED_Y) < 5,
        `the restore lands on the recorded offset (got ${restored})`);
      await afterGrowth();
      const grown = document.querySelector('wj-grow-late-1310');
      assert.ok(grown && grown.getBoundingClientRect().height > GROWTH - 5,
        'the fixture actually grew after the swap, so the case is live');
      assert.ok(Math.abs(window.scrollY - RESTORED_Y) < 5,
        `${GROWTH}px of growth above the viewport must not move the reader `
        + `(expected ~${RESTORED_Y}, got ${window.scrollY})`);
    } finally { await teardown(); }
  });

  test('a revalidation that answers before the growth still holds the reader', async () => {
    // The window's close is scheduled off the revalidation, so its length is
    // network latency plus two frames. That is only long enough because the
    // revalidation is normally the slower of the two, which is a property of a
    // deployment rather than a guarantee. Here the server answers instantly and
    // the content grows several frames later, which is the ordering a local
    // server, a 304, or a warm cache produces. The restore has to survive it.
    await setup({ instantRevalidation: true });
    try {
      await goBack();
      assert.ok(Math.abs(window.scrollY - RESTORED_Y) < 5,
        `the restore lands on the recorded offset (got ${window.scrollY})`);
      for (let i = 0; i < 14; i++) await frame();
      const grown = document.querySelector('wj-grow-very-late-1310');
      assert.ok(grown && grown.getBoundingClientRect().height > GROWTH - 5,
        'the fixture actually grew, so the case is live');
      assert.ok(Math.abs(window.scrollY - RESTORED_Y) < 5,
        `growth landing after a fast revalidation must not move the reader `
        + `(expected ~${RESTORED_Y}, got ${window.scrollY})`);
    } finally { await teardown(); }
  });

  test('the window closes once the restore is over, leaving no residue', async () => {
    await setup();
    try {
      await goBack();
      assert.equal(document.documentElement.style.getPropertyValue('overflow-anchor'), 'none');
      releaseFetch();
      releaseFetch = null;
      // The close is the LATER of the revalidation settling and the floor, plus
      // two frames for the re-applied DOM to lay out. Answering the fetch alone
      // is deliberately not enough: that coupling is what let a fast server
      // close the window before the growth landed.
      //
      // Wall clock, not a frame count. This is the one assertion here that
      // needs a wait SHORTER than the floor, and the runner puts test files in
      // concurrent pages where a non-visible page has rAF throttled, so a fixed
      // number of frames could outlast the floor and fail while nothing is
      // broken. Every other wait in this file only wants "enough time", so
      // slower frames make those assertions stronger rather than flakier.
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(document.documentElement.style.getPropertyValue('overflow-anchor'), 'none',
        'a revalidation answering early does not close the window on its own');
      await new Promise((r) => setTimeout(r, 700));
      assert.equal(document.documentElement.style.getPropertyValue('overflow-anchor'), '',
        'the router leaves nothing of its own on <html> after the restore');
    } finally { await teardown(); }
  });

  test('a reader taking over closes the window immediately', async () => {
    await setup();
    try {
      await goBack();
      assert.equal(document.documentElement.style.getPropertyValue('overflow-anchor'), 'none');
      window.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
      assert.equal(document.documentElement.style.getPropertyValue('overflow-anchor'), '',
        'the first real input hands the viewport back to the browser, so a '
        + 'reader who has started scrolling keeps normal anchoring');
    } finally { await teardown(); }
  });
});
