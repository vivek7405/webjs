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
import { enableClientRouter, disableClientRouter, _snapshotCache, _setCurrentPageUrl } from '../../../src/router-client.js';

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

const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
/** Long enough for the grower to connect, lay out, and take its height. */
async function afterGrowth() { for (let i = 0; i < 4; i++) await frame(); }

/**
 * The restored page: a grower that is 0px in markup and 763px once it renders,
 * followed by enough filler to make the recorded offset reachable. The grower
 * sits entirely above the viewport at `RESTORED_Y`, which is where anchoring
 * acts.
 */
const RESTORED_BODY =
  '<!--wj:children:/:/anchor-restore-a-->'
  + '<wj-grow-late-1310></wj-grow-late-1310>'
  + '<div style="height:3000px">restored</div>'
  + '<!--/wj:children:/-->';

const RESTORED_HTML =
  '<!doctype html><html><head></head><body>' + RESTORED_BODY + '</body></html>';

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

  async function setup() {
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
    window.fetch = () => new Promise((resolve) => {
      releaseFetch = () => resolve(new Response(RESTORED_HTML, {
        headers: { 'content-type': 'text/html', 'x-webjs-build': '' },
      }));
    });

    // Two real same-document history entries, so `history.back()` drives a REAL
    // popstate. Reassigning `location` is impossible in a browser, and a
    // synthetic popstate event would not exercise the browser's own restore.
    origUrl = location.href;
    history.pushState(null, '', entryUrl('anchor-a'));
    history.pushState(null, '', entryUrl('anchor-b'));
    entriesPushed = true;
    _snapshotCache.set(entryUrl('anchor-a'), {
      html: RESTORED_HTML, scrollX: 0, scrollY: RESTORED_Y,
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

  test('the window closes once the revalidation settles, leaving no residue', async () => {
    await setup();
    try {
      await goBack();
      assert.equal(document.documentElement.style.getPropertyValue('overflow-anchor'), 'none');
      releaseFetch();
      releaseFetch = null;
      // The close is the revalidation settling plus two frames for the
      // re-applied DOM to lay out.
      for (let i = 0; i < 6; i++) await frame();
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
