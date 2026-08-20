/**
 * Real-browser test for #1427: a `<webjs-frame>` swap must not move the window
 * scroll, while an ordinary page navigation still scrolls to top.
 *
 * The router's scroll block was gated on `recordHistory` alone, which means "a
 * foreground navigation the reader initiated". A click on a frame-driving link
 * is exactly that (it advances the URL, deliberately), so a frame swap fell
 * into the page-navigation scroll by omission: filtering a tabbed panel on
 * gallery.webjs.dev threw the reader from 400px back to the top of the page,
 * with the panel they had just clicked in now off screen.
 *
 * This MUST run in a real browser. linkedom implements no layout and no
 * scrolling at all, so `window.scrollY` never moves there and every assertion
 * below would pass vacuously against the bug.
 *
 * Three things make the fixture load-bearing, and each is easy to get wrong in
 * a way that leaves the test green either way:
 *
 *   - The page has to be TALL, and stay tall across the swap. The offset is
 *     only preserved if the document can still hold it, so a swap that shortens
 *     the document would clamp `scrollY` to 0 and look exactly like the defect.
 *     The spacer therefore sits OUTSIDE the frame (a frame swap never touches
 *     it) and the page-navigation response carries its own.
 *   - The starting offset has to be non-zero and asserted BEFORE the click. A
 *     fixture that never managed to scroll would report 0 after the click for
 *     the wrong reason.
 *   - Every href keeps the page's OWN query string, which is what identifies
 *     the web-test-runner session. A link that replaces the search string
 *     pushes the page out of its session and takes down the entire run, with
 *     every test still passing, so it reads as an infrastructure blip.
 */
import { enableClientRouter, disableClientRouter } from '../../../src/router-client.js';

import { assert } from '../../../../../test/browser-assert.js';
import { installNavGuard } from '../../../../../test/browser-nav-guard.js';

/** Where the reader is when they click. Comfortably clear of 0. */
const START_Y = 500;
/** Tall enough that neither swap can shorten the document below `START_Y`. */
const SPACER = 3000;

const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
const tick = () => new Promise((r) => setTimeout(r, 0));
/** Past the fetch, the swap, and the layout it produces. */
async function settle() { for (let i = 0; i < 3; i++) { await tick(); } await frame(); }

/**
 * A same-page url carrying one extra param, built from the LIVE url so the
 * session query string survives (see the header note).
 *
 * @param {string} kind
 * @returns {string} pathname + search
 */
function href(kind) {
  const u = new URL(location.href);
  u.searchParams.set('wj1427', kind);
  return u.pathname + u.search;
}

/**
 * The live page: an anchor target, a tall spacer, then a frame carrying its own
 * filter link, an anchored (`#hash`) filter link, a `_top` breakout link, an
 * unresolvable-id link, and a frame-targeted form. The
 * boundary comments are what let the page-navigation case swap INSIDE this
 * container rather than replacing the whole body, so the web-test-runner
 * harness DOM is never touched.
 */
function liveHtml() {
  return '<!--wj:children:/:/frame-scroll-a-->'
    // Above the spacer, so scrolling to it would move the window UP from
    // `START_Y` by an unmistakable margin (the hash case asserts that gap).
    + '<span id="wj-hash-target">anchor</span>'
    + `<div style="height:${SPACER}px">spacer</div>`
    + '<webjs-frame id="wj-scroll-frame">'
      + `<a id="wj-frame-link" href="${href('frame')}">filter</a>`
      + `<a id="wj-hash-link" href="${href('hash')}#wj-hash-target">filter, anchored</a>`
      + `<a id="wj-top-link" href="${href('top')}" data-webjs-frame="_top">breakout</a>`
      + `<a id="wj-ghost-link" href="${href('ghost')}" data-webjs-frame="wj-no-such-frame">ghost</a>`
      + `<form id="wj-frame-form" method="post" action="${href('form')}">`
        + '<button id="wj-frame-submit" type="submit">go</button>'
      + '</form>'
      + '<span id="wj-frame-content">ORIGINAL</span>'
    + '</webjs-frame>'
    + '<!--/wj:children:/-->';
}

/** A frame-scoped response: only the frame subtree changes. */
const FRAME_RESPONSE =
  '<!doctype html><html><head></head><body>'
  + '<webjs-frame id="wj-scroll-frame"><span id="wj-frame-content">UPDATED</span></webjs-frame>'
  + '</body></html>';

/**
 * A page response, with its OWN tall spacer. Without that the swap would
 * shorten the document, the browser would clamp `scrollY` to 0 on its own, and
 * the scroll-to-top assertion would pass even with the router's scroll removed.
 *
 * It repeats the live boundary KEY on purpose. A different key shares no
 * boundary with the live DOM, so the router degrades to a full page load rather
 * than swapping, and the case would then assert scroll behaviour on a
 * navigation that never applied.
 *
 * It also echoes the LIVE head back, as insurance rather than out of need. The
 * path this fixture actually takes removes nothing: a foreground nav that finds
 * a shared boundary (which this response is built to offer) merges the head
 * ADD-ONLY via `addNewHeadElements`, and a nav with no shared boundary hard-
 * navigates instead of swapping. The removing merge (`mergeHead`, through the
 * full-body swap) belongs to the background snapshot paths, which no case here
 * reaches. It stays because the cost is zero and the failure it guards against
 * is invisible: `mergeHead` drops any live head element the response omits, and
 * losing web-test-runner's session scripts would not fail THIS file, which has
 * already loaded, but would destabilize the Firefox session and surface as
 * unrelated later files failing to start a test page. The echo cannot itself do
 * harm, because the merge dedupes on the serialized element, so an element
 * already live is neither removed nor re-appended and no script runs twice.
 */
function pageResponse() {
  return '<!doctype html><html><head>' + document.head.innerHTML + '</head><body>'
    + '<!--wj:children:/:/frame-scroll-a-->'
    + `<div id="wj-swapped-1427" style="height:${SPACER}px">swapped</div>`
    + '<!--/wj:children:/-->'
    + '</body></html>';
}

suite('Client router: a <webjs-frame> swap leaves the window scroll alone (#1427)', () => {
  let navGuard, container, origFetch, origScrollBehavior, origUrl;
  /** Every url the router fetched, tagged with the shape it asked for. */
  let fetched;

  function setup() {
    navGuard = installNavGuard();
    enableClientRouter();
    origUrl = location.href;
    origScrollBehavior = document.documentElement.style.scrollBehavior;
    // The assertions are about position, not animation, and a smooth scroll
    // would not have landed by the time they run (#601).
    document.documentElement.style.scrollBehavior = '';

    container = document.createElement('div');
    container.innerHTML = liveHtml();
    document.body.appendChild(container);

    fetched = [];
    origFetch = window.fetch;
    // Answer the SHAPE the router asked for, read off its own `x-webjs-frame`
    // request header rather than guessed from the url. That matters for the
    // degradation cases: a page request answered with a bare frame body would
    // carry no boundary comments, so the router would swap the whole body and
    // take the web-test-runner harness DOM with it.
    window.fetch = (u, init) => {
      const url = String(typeof u === 'string' ? u : (u && u.url) || u);
      const headers = (init && init.headers) || {};
      const framed = Boolean(headers['x-webjs-frame']);
      fetched.push((framed ? 'frame:' : 'page:') + url);
      return Promise.resolve(new Response(framed ? FRAME_RESPONSE : pageResponse(), {
        headers: { 'content-type': 'text/html', 'x-webjs-build': '' },
      }));
    };

    window.scrollTo({ left: 0, top: START_Y, behavior: 'instant' });
    assert.equal(window.scrollY, START_Y,
      'the fixture is tall enough to scroll: without this the test proves nothing');
  }

  /**
   * Undo everything `setup` installed. Every step is guarded, because `setup`
   * ASSERTS (its precondition) and so can throw partway through, and a teardown
   * that threw on the first missing field would leave the fetch stub and the nav
   * guard installed for the rest of the RUN, not just the rest of this file.
   * That failure is invisible where it happens and surfaces as unrelated later
   * files misbehaving, which is exactly the shape this fixture already produced
   * once through its head handling. So each test calls `setup` INSIDE its try,
   * and this cleans up whatever got as far as being installed.
   */
  function teardown() {
    if (origFetch) { window.fetch = origFetch; origFetch = null; }
    // A page swap replaces the container's contents and nothing puts them back.
    const swapped = document.getElementById('wj-swapped-1427');
    if (swapped) swapped.remove();
    if (container) { container.remove(); container = null; }
    if (origUrl) { history.replaceState(null, '', origUrl); origUrl = null; }
    if (origScrollBehavior != null) {
      document.documentElement.style.scrollBehavior = origScrollBehavior;
      origScrollBehavior = null;
    }
    window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
    if (navGuard) { navGuard.remove(); navGuard = null; }
    // Re-arm cleanly for the next case; every other suite in the run expects
    // the router enabled.
    disableClientRouter();
    enableClientRouter();
  }

  test('a link INSIDE a frame swaps the frame and holds the scroll offset', async () => {
    try {
      setup();
      document.getElementById('wj-frame-link').click();
      await settle();

      assert.equal(document.getElementById('wj-frame-content').textContent, 'UPDATED',
        'the frame actually swapped, so the scroll assertion is about a real frame nav');
      assert.equal(window.scrollY, START_Y,
        'a frame swap left the window scroll where the reader put it');
    } finally { teardown(); }
  });

  test('a #hash on a frame link does not move the window either', async () => {
    try {
      setup();
      // The hash branch is excluded on purpose, and nothing else in this file
      // reaches it. Narrowing the guard back to the obvious
      // `recordHistory && (!frameId || url.hash)` (an anchor reads as explicit
      // intent, so someone will propose it) leaves every other case here, plus
      // frame-targeting, frame-missing, and the e2e case, green while restoring
      // the `scrollIntoView` this one catches.
      const target = document.getElementById('wj-hash-target');
      const targetY = Math.round(window.scrollY + target.getBoundingClientRect().top);
      assert.ok(Math.abs(targetY - START_Y) > 100,
        `the anchor sits at ${targetY}, which must be clear of ${START_Y}: if the two `
        + 'coincided, scrolling to the anchor would be indistinguishable from holding '
        + 'the offset and this case could not fail');

      document.getElementById('wj-hash-link').click();
      await settle();

      assert.equal(document.getElementById('wj-frame-content').textContent, 'UPDATED',
        'the anchored link swapped the frame, so this is a real frame nav');
      assert.equal(window.scrollY, START_Y,
        'a frame swap ignores the hash and leaves the window where the reader put it');
    } finally { teardown(); }
  });

  test('an EXTERNAL data-webjs-frame link holds the scroll offset too', async () => {
    try {
      setup();
      // Same fixture, driven from outside the frame: the resolve path differs
      // (an explicit id rather than the enclosing-frame default) but it reaches
      // the same swap, so both spellings need pinning.
      const external = document.createElement('a');
      external.id = 'wj-external-link';
      external.href = href('external');
      external.setAttribute('data-webjs-frame', 'wj-scroll-frame');
      external.textContent = 'external';
      container.appendChild(external);

      external.click();
      await settle();

      assert.equal(document.getElementById('wj-frame-content').textContent, 'UPDATED',
        'the external link swapped the frame');
      assert.equal(window.scrollY, START_Y,
        'an externally targeted frame swap left the window scroll alone');
    } finally { teardown(); }
  });

  test('a frame-targeted FORM submission holds the scroll offset', async () => {
    try {
      setup();
      // The submit path reaches the scroll block through its own caller
      // (`submitForm`, which hardcodes `recordHistory: true`), so a fix proven
      // only on the click path would leave this one scrolling.
      document.getElementById('wj-frame-submit').click();
      await settle();

      assert.equal(document.getElementById('wj-frame-content').textContent, 'UPDATED',
        'the submission swapped the frame');
      assert.ok(fetched.some((u) => u.startsWith('frame:') && u.includes('wj1427=form')),
        'the router handled the submission as a frame request, not the browser');
      assert.equal(window.scrollY, START_Y,
        'a frame-targeted submission left the window scroll alone');
    } finally { teardown(); }
  });

  test('a data-webjs-frame="_top" breakout is a page nav, so it still scrolls to top', async () => {
    try {
      setup();
      document.getElementById('wj-top-link').click();
      await settle();

      assert.ok(document.getElementById('wj-swapped-1427'),
        'the page swap applied, so this is a genuine page navigation');
      assert.ok(document.documentElement.scrollHeight - window.innerHeight > START_Y,
        'the swapped page is still tall enough to hold the old offset, so a 0 here '
        + 'is the router scrolling and not the browser clamping');
      assert.equal(window.scrollY, 0,
        'breaking out of a frame is a page navigation and still scrolls to top');
    } finally { teardown(); }
  });

  test('an unresolvable frame id degrades to a page nav, and still scrolls to top', async () => {
    try {
      setup();
      const origWarn = console.warn;
      console.warn = () => {};
      try {
        // `resolveTargetFrameId` warns and returns null here, so the click is a
        // page navigation. It is the one shape where the new guard could
        // silently over-apply, since the link does carry a frame attribute.
        document.getElementById('wj-ghost-link').click();
        await settle();
      } finally { console.warn = origWarn; }

      assert.ok(fetched.some((u) => u.startsWith('page:') && u.includes('wj1427=ghost')),
        'the unresolvable id degraded to a page request');
      assert.equal(window.scrollY, 0,
        'an unresolvable frame id is a page navigation and still scrolls to top');
    } finally { teardown(); }
  });
});
