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
    const outgoingHeight = (opts && opts.tallOutgoing) ? 60000 : restoredY + 2000;
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
    {
      // Let the BROWSER record a real offset for this entry, by actually
      // scrolling before pushing the next one. Every other case injects the
      // offset into the snapshot cache while the page sits at 0, so the UA has
      // only ever recorded 0 for `anchor-a`, which is fine when the router owns
      // the restore but makes it impossible to observe what the UA would do on
      // its own. A single-writer assertion needs the UA's own recording to be
      // the real thing (#1428).
      window.scrollTo({ top: restoredY, left: 0, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 60));
    }
    history.pushState(null, '', entryUrl('anchor-b'));
    entriesPushed = true;
    // `scrollHeight` is what the restore RESERVES across the swap (#1428), so
    // a fixture without it leaves the reservation inert and every assertion
    // below passes for the wrong reason. A real snapshot's offset is always
    // reachable within its own recorded height (you cannot scroll past the
    // document), so the fixture models that: enough height to hold the offset
    // plus a viewport, unless a case overrides it to test the reservation
    // itself.
    _snapshotCache.set(entryUrl('anchor-a'), {
      html, scrollX: 0, scrollY: restoredY,
      scrollHeight: (opts && opts.scrollHeight !== undefined)
        ? opts.scrollHeight
        : restoredY + window.innerHeight,
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

  test('a FRAME-targeted navigation does not scroll the restored page (#1428)', async () => {
    // The write-back added for #1428 lives in the restore window, and a frame
    // nav is the one navigation that deliberately leaves that window OPEN. So
    // the two features meet here and nothing covered it: the test above asserts
    // only that the window survives, not where the reader ends up.
    //
    // When this was written, a click-driven frame nav reached `fetchAndApply`
    // with `recordHistory: true` and the scroll block had no `frameId` guard,
    // so it ran the forward-nav scroll-to-top even though it swaps one region
    // rather than the page, and inside an open restore that dropped the reader
    // to the top of a page they had just come back to. #1429 has since fixed
    // that at the source: the scroll block now excludes frame-scoped responses
    // outright, so the stray scroll no longer happens at all.
    //
    // The case is kept because it asserts the OUTCOME rather than the
    // mechanism, and the outcome is what must hold however the internals move:
    // a frame swap must never disturb a restore in progress. It is now
    // defended twice over, by #1429's guard and by the restore window.
    await setup();
    try {
      await goBack();
      await frame();
      assert.ok(Math.abs(window.scrollY - RESTORED_Y) < 5,
        `precondition: the restore landed (got ${window.scrollY})`);
      const holder = document.createElement('div');
      holder.innerHTML = '<webjs-frame id="wj-target-frame-1310b">'
        + '<a id="wj-frame-link-1310b" href="/wj-frame-nav-1310">go</a></webjs-frame>';
      document.body.appendChild(holder);
      try {
        holder.querySelector('#wj-frame-link-1310b').click();
        await new Promise((r) => setTimeout(r, 0));
        assert.ok(frameNavs > 0,
          'precondition: the click reached the router as a frame-targeted nav');
        await frame();
        assert.ok(Math.abs(window.scrollY - RESTORED_Y) < 5,
          `a frame swap must not move the reader off a restore in progress `
          + `(expected ~${RESTORED_Y}, got ${window.scrollY})`);
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

  test('a restore the BROWSER recorded lands on the offset through a short swap (#1428)', async () => {
    // The single-writer case, and the DEFAULT fixture shape: `setup` scrolls to
    // the recorded offset before pushing the next entry, so the browser has a
    // real per-entry offset to replay rather than the 0 an injected fixture
    // leaves it with.
    //
    // The snapshot is still SHORT at swap time, which is the shape that used to
    // clamp. With the height reserved the offset is reachable, so the UA's
    // replay lands on it and the router writes nothing. This is the assertion
    // that had to hold for the router to stop writing scroll at all.
    await setup();
    try {
      await goBack();
      await frame();
      assert.ok(Math.abs(window.scrollY - RESTORED_Y) < 5,
        `the reader lands on the recorded offset (got ${window.scrollY})`);
      await afterGrowth();
      assert.ok(Math.abs(window.scrollY - RESTORED_Y) < 5,
        `and stays there once the page fills in (got ${window.scrollY})`);
    } finally { await teardown(); }
  });

  test('the reservation makes the recorded offset reachable on the FIRST frame (#1428)', async () => {
    // The architecture change. The snapshot markup is far shorter than the page
    // it was serialized from until its components render, so the recorded
    // offset used to be unreachable and the browser clamped to whatever the
    // short document allowed. That clamp is what the old catch-up chase existed
    // to heal, after the fact.
    //
    // Reserving the recorded height across the swap removes the shortness
    // instead of compensating for it, so the offset is reachable immediately
    // and the restore lands exactly, once. `manualGrowth` keeps the fixture
    // short until this test grows it, so nothing but the reservation can be
    // making the offset reachable here.
    await setup({ restoredY: CLAMPED_TARGET, manualGrowth: true });
    try {
      await goBack();
      // Frame granularity, the user-visible contract. The UA performs a restore
      // of its own a beat after the handler, and in THIS harness it writes 0:
      // the fixture pushes its entries from a page at offset 0 and injects the
      // recorded offset straight into the snapshot cache, so the browser never
      // saw a real offset for that entry. The restore window's write-back
      // corrects it on the next frame, which is what a reader sees.
      await frame();
      assert.ok(Math.abs(window.scrollY - CLAMPED_TARGET) < 5,
        `the offset is reachable with no clamp and no chase (got ${window.scrollY})`);
      // And it holds once the real content arrives and the reservation is no
      // longer what is carrying the height.
      document.querySelector('wj-grow-on-command-1310').style.height = COMMANDED_GROWTH + 'px';
      for (let i = 0; i < 6; i++) await frame();
      assert.ok(Math.abs(window.scrollY - CLAMPED_TARGET) < 5,
        `and the reader stays there as the page fills in (got ${window.scrollY})`);
    } finally { await teardown(); }
  });

  test('the reservation leaves no residue once the restore is over (#1428)', async () => {
    // It is an inline style on the ROOT, so it must be put back exactly like
    // the anchoring window's `overflow-anchor`, or every restored page would
    // keep a stale min-height for the life of the document.
    await setup();
    try {
      await goBack();
      assert.ok(document.documentElement.style.getPropertyValue('min-height') !== '',
        'precondition: the reservation is held across the restore');
      releaseFetch();
      releaseFetch = null;
      await new Promise((r) => setTimeout(r, 800));
      assert.equal(document.documentElement.style.getPropertyValue('min-height'), '',
        'the router leaves no height of its own on the root after the restore');
    } finally { await teardown(); }
  });

  test('a second navigation releases the reservation (#1428)', async () => {
    // Same supersede rule the anchoring window follows: the reservation
    // outlives its own restore, so a navigation starting inside that span must
    // end it rather than hold another page tall.
    await setup();
    try {
      await goBack();
      assert.ok(document.documentElement.style.getPropertyValue('min-height') !== '',
        'precondition: the reservation is held');
      navigate(location.origin + entryUrl('second-nav-1428')).catch(() => {});
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(document.documentElement.style.getPropertyValue('min-height'), '',
        'starting another navigation releases the previous restore\'s reservation');
    } finally { await teardown(); }
  });

  test('under a view transition the restore still lands on the recorded offset (#1428)', async () => {
    // `applySwap` defers its DOM mutation a frame under a transition, so the
    // scroll write must wait for the commit or it acts on the OUTGOING page.
    // The outgoing page here is far taller than the restored one, which is the
    // shape that used to produce a wrong decision. The reservation is taken
    // before the swap either way, so the offset is reachable when the write
    // finally lands.
    //
    // The transition is SIMULATED: a hidden document skips a real one, and the
    // runner puts test files in concurrent pages, so the deferred path is not
    // otherwise reachable here. The stub defers the callback as the spec does.
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
      assert.ok(Math.abs(window.scrollY - CLAMPED_TARGET) < 5,
        `the deferred restore lands on the recorded offset (got ${window.scrollY})`);
    } finally {
      await teardown();
      (/** @type any */ (document)).startViewTransition = origSVT;
    }
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
      // Read at FRAME granularity, not task granularity. The contract is what
      // the reader sees: the recorded offset by the next paint, held there.
      // Under `scrollRestoration: 'auto'` Firefox lands a stale UA write (0)
      // inside the same task as the traverse and the restore window's
      // write-back corrects it on the following scroll event, so a
      // task-granularity read can catch the sub-frame transient between the
      // two writes without either being user-visible (#1428).
      await frame();
      const restored = window.scrollY;
      assert.ok(Math.abs(restored - RESTORED_Y) < 5,
        `the restore lands on the recorded offset by the next frame (got ${restored})`);
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
      // Frame granularity, for the same reason as the sibling case above: the
      // contract is the offset the reader sees by the next paint, and under
      // `scrollRestoration: 'auto'` Firefox lands a stale UA write inside the
      // traverse's own task that the restore window corrects on the next
      // scroll event (#1428).
      await frame();
      assert.ok(Math.abs(window.scrollY - RESTORED_Y) < 5,
        `the restore lands on the recorded offset by the next frame (got ${window.scrollY})`);
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

  test('the window writes back a programmatic displacement, so a stale UA restore cannot win (#1428)', async () => {
    // The router forces `history.scrollRestoration` to 'auto' so the browser
    // records per-entry offsets and REPLAYS them, which is both the restore
    // itself and what WebKit's back-swipe gesture preview is composed from.
    // The cost is that the replay is the browser's, so it can land off-target
    // for engine reasons the router does not control. The open restore window
    // absorbs a displacement like that for a short arming span.
    await setup();
    try {
      await goBack();
      await frame();
      assert.ok(Math.abs(window.scrollY - RESTORED_Y) < 5,
        `precondition: the restore landed (got ${window.scrollY})`);
      // Exactly the shape of a stale UA restore: a programmatic write to a
      // stale offset, inside the window, from no user gesture.
      window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
      await frame();
      assert.ok(Math.abs(window.scrollY - RESTORED_Y) < 5,
        `an off-target programmatic write inside the window is corrected `
        + `(expected ~${RESTORED_Y}, got ${window.scrollY})`);
    } finally { await teardown(); }
  });

  test('the write-back never fights a reader, because input closes the window first (#1428)', async () => {
    // The safety property behind the write-back: every release event is a
    // CAPTURE-phase input listener, and an input event precedes the scroll it
    // causes. So a user-driven scroll always arrives with the window already
    // closed, and the only writes the window can ever overrule are
    // programmatic ones inside the restore's own span.
    await setup();
    try {
      await goBack();
      // WAIT FOR THE RESTORE TO LAND before interrupting it. The browser is the
      // restore's writer now, and its replay arrives a frame or so after the
      // popstate handler rather than synchronously, so a reader modelled as
      // "input on the very next frame" can outrun the restore itself. That
      // races a different question than this case is asking. What the property
      // is actually about, and what a real reader can actually do, is take over
      // AFTER the page has come back.
      //
      // Polled rather than fixed at N frames, so the case does not encode one
      // engine's replay latency. This assertion caught a genuine ordering
      // difference: written against the old synchronous router write, it
      // reproduced only on CI's Chromium and never locally.
      for (let i = 0; i < 20 && Math.abs(window.scrollY - RESTORED_Y) > 5; i++) await frame();
      assert.ok(Math.abs(window.scrollY - RESTORED_Y) < 5,
        `precondition: the restore landed before the reader takes over (got ${window.scrollY})`);

      window.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
      assert.equal(document.documentElement.style.getPropertyValue('overflow-anchor'), '',
        'precondition: the input event closed the window');
      window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
      await frame();
      assert.ok(window.scrollY < 5,
        `a scroll after the reader took over is left alone (got ${window.scrollY})`);
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
