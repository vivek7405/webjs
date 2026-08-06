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
import { enableClientRouter, disableClientRouter, navigate, _snapshotCache, _setCurrentPageUrl } from '../../../src/router-client.js';

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

const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
/** Long enough for the grower to connect, lay out, and take its height. */
async function afterGrowth() { for (let i = 0; i < 4; i++) await frame(); }

/**
 * The restored page: a grower that is 0px in markup and 763px once it renders,
 * followed by enough filler to make the recorded offset reachable. The grower
 * sits entirely above the viewport at `RESTORED_Y`, which is where anchoring
 * acts.
 */
function restoredBody(tag) {
  return '<!--wj:children:/:/anchor-restore-a-->'
    + `<${tag}></${tag}>`
    + '<div style="height:3000px">restored</div>'
    + '<!--/wj:children:/-->';
}

function restoredHtml(tag) {
  return '<!doctype html><html><head></head><body>' + restoredBody(tag) + '</body></html>';
}

const RESTORED_HTML = restoredHtml('wj-grow-late-1310');
const RESTORED_HTML_SLOW = restoredHtml('wj-grow-very-late-1310');

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

  /**
   * @param {{ instantRevalidation?: boolean, restoredY?: number }} [opts] By
   *   default the revalidation is held open so a case can assert inside the
   *   restore window. `instantRevalidation` answers it immediately instead,
   *   which is the ordering a fast server produces. `restoredY` overrides the
   *   recorded offset, so a case can force the clamped path.
   */
  async function setup(opts) {
    const instant = Boolean(opts && opts.instantRevalidation);
    const restoredY = (opts && opts.restoredY) != null ? opts.restoredY : RESTORED_Y;
    const html = instant ? RESTORED_HTML_SLOW : RESTORED_HTML;
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
      + '<div style="height:3000px">outgoing</div>'
      + '<!--/wj:children:/-->';
    document.body.appendChild(container);

    // The revalidation is held open by default, so a case can assert inside the
    // restore window. Its response repeats the restored markup, which is what
    // the server would send.
    origFetch = window.fetch;
    const respond = () => new Response(html, {
      headers: { 'content-type': 'text/html', 'x-webjs-build': '' },
    });
    window.fetch = instant
      ? () => Promise.resolve(respond())
      : () => new Promise((resolve) => { releaseFetch = () => resolve(respond()); });

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
        'a clamped restore installs no window, leaving the browser to heal the '
        + 'clamp as the page grows');
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

  test('a form SUBMISSION inside the window closes it too', async () => {
    // A submission is a navigation and runs its own pipeline
    // (`performSubmission`), so it needs the same close as `performNavigation`.
    // Covered separately because a test that only drives `navigate()` leaves
    // that second call site free to be deleted with every suite still green.
    await setup();
    try {
      await goBack();
      assert.equal(document.documentElement.style.getPropertyValue('overflow-anchor'), 'none',
        'precondition: a window is open');
      // Appended to the LIVE body, not to `container`: the restore swaps the
      // body wholesale, so `container` is detached by now and a form inside it
      // would never reach the router's document-level submit listener.
      //
      // The action must also not be this page's own url. The runner serves test
      // files at a `.js` path, and the router skips a submission whose action
      // carries a non-HTML extension, so that form would never reach
      // `performSubmission` at all.
      const holder = document.createElement('div');
      holder.innerHTML = '<form id="wj-anchor-form" method="post" '
        + 'action="/wj-submit-target-1310"><button type="submit">go</button></form>';
      document.body.appendChild(holder);
      const form = holder.querySelector('#wj-anchor-form');
      // Well inside the floor. The router intercepts this and the nav guard
      // cancels the browser's own submission, so nothing leaves the page.
      form.requestSubmit(form.querySelector('button'));
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(document.documentElement.style.getPropertyValue('overflow-anchor'), '',
        'a submission ends the previous restore\'s window, same as a link nav');
      holder.remove();
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
