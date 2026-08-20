/**
 * Real-browser test for #1436: `data-preserve-scroll` on a link or form keeps
 * the reader's scroll offset across a forward navigation, while an unmarked one
 * still scrolls to top.
 *
 * A forward navigation always scrolled to the top and an author had no way to
 * say otherwise. That default is right, but it is wrong for a filter, sort, or
 * tab link whose control sits below the fold, and for a form that re-renders in
 * place with validation errors: the reader is thrown away from the thing they
 * were just looking at.
 *
 * This MUST run in a real browser. linkedom implements no layout and no
 * scrolling at all, so `window.scrollY` never moves there and every position
 * assertion below would pass vacuously. The unit file covers attribute
 * RESOLUTION only, and says so.
 *
 * Fixture rules, carried over from `frame-swap-scroll.test.js` (#1427). Each is
 * load-bearing and each is easy to get wrong in a way that leaves the test green
 * either way:
 *
 *   - The page has to be TALL and stay tall across the swap, so the response
 *     carries its own spacer. A swap that shortens the document clamps
 *     `scrollY` to 0 on its own and looks exactly like the defect.
 *   - The starting offset has to be non-zero and asserted BEFORE the click. A
 *     fixture that never managed to scroll would report 0 afterwards for the
 *     wrong reason.
 *   - Every href keeps the page's OWN query string, which identifies the
 *     web-test-runner session. A link that replaces the search string pushes the
 *     page out of its session and takes down the entire run, with every test
 *     still passing, so it reads as an infrastructure blip.
 *   - The response repeats the live boundary KEY. A different key shares no
 *     boundary with the live DOM, so the router degrades to a full page load
 *     rather than swapping, and the case would assert scroll behaviour on a
 *     navigation that never applied.
 *   - `scroll-behavior` is forced off: the assertions are about position, and a
 *     smooth scroll would not have landed by the time they run (#601).
 *
 * COUNTERFACTUALS, each RUN and proven to red the cases it names, at commit
 * `9ed0b456`. A counterfactual claim is true of a commit rather than of a
 * branch, so re-run the toggle and restate this list if a later commit touches
 * the scroll block or the resolver:
 *
 *   - delete the `!preserveScroll` guard in `fetch-apply.js`: cases 2, 3, 6, 7
 *   - gate the WHOLE `if (recordHistory && !frameId)` block on `!preserveScroll`
 *     instead: case 5 (the hash carve-out is what that breaks)
 *   - drop the `closest()` walk to a bare `hasAttribute`: cases 3 AND 6. The
 *     form half is not incidental: the mark sits on the `<form>` while the
 *     trigger is its submit BUTTON, so case 6 is what proves the walk is why a
 *     marked form covers its own buttons with no second lookup.
 *   - drop the `!== 'false'` test so presence alone preserves: case 4
 *   - read the option as `!opts?.scroll` rather than `opts?.scroll === false`:
 *     case 7's optionless half, plus 3 assertions in the unit file
 */
import { enableClientRouter, disableClientRouter, navigate } from '../../../src/router-client.js';

import { assert } from '../../../../../test/browser-assert.js';
import { installNavGuard } from '../../../../../test/browser-nav-guard.js';

/** Where the reader is when they click. Comfortably clear of 0. */
const START_Y = 500;
/** Tall enough that no swap can shorten the document below `START_Y`. */
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
  u.searchParams.set('wj1436', kind);
  return u.pathname + u.search;
}

/**
 * The live page: an anchor target and a tall spacer, then every trigger shape
 * the attribute has to answer for. The boundary comments let the swap happen
 * INSIDE this container rather than replacing the whole body, so the
 * web-test-runner harness DOM is never touched.
 */
function liveHtml() {
  return '<!--wj:children:/:/preserve-scroll-a-->'
    // Above the spacer, so scrolling to it moves the window UP from `START_Y`
    // by an unmistakable margin (the hash case asserts that gap).
    + '<span id="wj-hash-target">anchor</span>'
    + `<div style="height:${SPACER}px">spacer</div>`
    + `<a id="wj-plain" href="${href('plain')}">plain</a>`
    + `<a id="wj-marked" href="${href('marked')}" data-preserve-scroll>marked</a>`
    + `<a id="wj-hash" href="${href('hash')}#wj-hash-target" data-preserve-scroll>anchored</a>`
    + '<nav id="wj-wrapper" data-preserve-scroll>'
      + `<a id="wj-inherits" href="${href('inherits')}">inherits from the wrapper</a>`
      + `<a id="wj-opted-out" href="${href('opted-out')}" data-preserve-scroll="false">opts back out</a>`
    + '</nav>'
    + `<form id="wj-marked-form" method="post" action="${href('marked-form')}" data-preserve-scroll>`
      + '<button id="wj-marked-submit" type="submit">go</button>'
    + '</form>'
    + `<form id="wj-plain-form" method="post" action="${href('plain-form')}">`
      + '<button id="wj-plain-submit" type="submit">go</button>'
    + '</form>'
    + '<webjs-frame id="wj-scroll-frame">'
      + `<a id="wj-frame-link" href="${href('frame')}" data-preserve-scroll>filter</a>`
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
 * A page response, with its OWN tall spacer and its own copy of the anchor
 * target. Without the spacer the swap would shorten the document, the browser
 * would clamp `scrollY` to 0 by itself, and the scroll-to-top cases would pass
 * even with the router's scroll write removed. The anchor target has to survive
 * too, because the hash case resolves it against the document the swap
 * produced, not the one it left.
 *
 * The live head is echoed back as insurance rather than out of need, for the
 * reason `frame-swap-scroll.test.js` documents at length: losing
 * web-test-runner's session scripts would not fail THIS file, which has already
 * loaded, but would destabilize the session and surface as unrelated later files
 * failing to start.
 */
function pageResponse() {
  return '<!doctype html><html><head>' + document.head.innerHTML + '</head><body>'
    + '<!--wj:children:/:/preserve-scroll-a-->'
    + '<span id="wj-hash-target">anchor</span>'
    + `<div id="wj-swapped-1436" style="height:${SPACER}px">swapped</div>`
    + '<!--/wj:children:/-->'
    + '</body></html>';
}

suite('Client router: data-preserve-scroll keeps the reader in place (#1436)', () => {
  let navGuard, container, origFetch, origScrollBehavior, origUrl;
  /** Every url the router fetched, tagged with the shape it asked for. */
  let fetched;

  function setup() {
    navGuard = installNavGuard();
    enableClientRouter();
    origUrl = location.href;
    origScrollBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = '';

    container = document.createElement('div');
    container.innerHTML = liveHtml();
    document.body.appendChild(container);

    fetched = [];
    origFetch = window.fetch;
    // Answer the SHAPE the router asked for, read off its own `x-webjs-frame`
    // request header rather than guessed from the url: a page request answered
    // with a bare frame body would carry no boundary comments, so the router
    // would swap the whole body and take the harness DOM with it.
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
   * ASSERTS its precondition and so can throw partway through, and a teardown
   * that threw on the first missing field would leave the fetch stub and the nav
   * guard installed for the rest of the RUN.
   */
  function teardown() {
    if (origFetch) { window.fetch = origFetch; origFetch = null; }
    // A page swap replaces the container's contents and nothing puts them back.
    const swapped = document.getElementById('wj-swapped-1436');
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

  /**
   * The swap applied AND the document it produced is still tall enough to hold
   * `START_Y`. Both halves matter: without the first the case would be asserting
   * scroll behaviour on a navigation that never happened, and without the second
   * a `scrollY` of 0 could be the browser clamping rather than the router
   * scrolling.
   */
  function assertPageSwapped() {
    assert.ok(document.getElementById('wj-swapped-1436'),
      'the page swap applied, so this is a genuine forward navigation');
    assert.ok(document.documentElement.scrollHeight - window.innerHeight > START_Y,
      'the swapped page still holds the old offset, so a 0 here is the router '
      + 'scrolling and not the browser clamping');
  }

  test('1. an UNMARKED link still scrolls to top (the default is unchanged)', async () => {
    try {
      setup();
      document.getElementById('wj-plain').click();
      await settle();

      assertPageSwapped();
      assert.equal(window.scrollY, 0,
        'a link with no attribute scrolls to top exactly as before');
    } finally { teardown(); }
  });

  test('2. a link carrying data-preserve-scroll holds the offset', async () => {
    try {
      setup();
      document.getElementById('wj-marked').click();
      await settle();

      assertPageSwapped();
      assert.equal(window.scrollY, START_Y,
        'the marked link left the reader where they were');
    } finally { teardown(); }
  });

  test('3. the attribute on an ANCESTOR covers a link inside it', async () => {
    try {
      setup();
      // Resolved through closest(), following `data-webjs-frame` rather than
      // `data-no-router`: one mark on a filter bar covers every link in it.
      document.getElementById('wj-inherits').click();
      await settle();

      assertPageSwapped();
      assert.equal(window.scrollY, START_Y,
        'a link inside a marked wrapper inherits the preference');
    } finally { teardown(); }
  });

  test('4. ="false" inside a marked wrapper scrolls to top (nearest carrier wins)', async () => {
    try {
      setup();
      document.getElementById('wj-opted-out').click();
      await settle();

      assertPageSwapped();
      assert.equal(window.scrollY, 0,
        'the nearest carrier decides, so one link can opt back into the default');
    } finally { teardown(); }
  });

  test('5. a marked HASH link still scrolls to its anchor', async () => {
    try {
      setup();
      // The reader named a target, and a named target beats a blanket
      // preference. This is the case that catches a guard placed on the whole
      // scroll block rather than on the scroll-to-top arms.
      const target = document.getElementById('wj-hash-target');
      const targetY = Math.round(window.scrollY + target.getBoundingClientRect().top);
      assert.ok(Math.abs(targetY - START_Y) > 100,
        `the anchor sits at ${targetY}, which must be clear of ${START_Y}: if the two `
        + 'coincided, scrolling to the anchor would be indistinguishable from holding '
        + 'the offset and this case could not fail');

      document.getElementById('wj-hash').click();
      await settle();

      assertPageSwapped();
      const landed = window.scrollY;
      assert.ok(Math.abs(landed - START_Y) > 100,
        `the window moved off ${START_Y} (landed at ${landed}), so the hash won over `
        + 'the attribute');
      const after = document.getElementById('wj-hash-target');
      const offset = Math.round(landed + after.getBoundingClientRect().top);
      assert.ok(Math.abs(landed - offset) < 5,
        `the window landed ON the anchor (${landed} vs the target's ${offset}), rather `
        + 'than merely leaving the old offset');
    } finally { teardown(); }
  });

  test('6. a marked FORM holds the offset, and an unmarked one scrolls to top', async () => {
    try {
      setup();
      // The submit path reaches the scroll block through its own caller, so a
      // fix proven only on the click path would leave this one scrolling. This
      // is also the case the feature most exists for: a long form failing
      // validation re-renders in place at 422, and scrolling to top moves the
      // reader away from the field that failed.
      document.getElementById('wj-marked-submit').click();
      await settle();

      assertPageSwapped();
      assert.ok(fetched.some((u) => u.startsWith('page:') && u.includes('wj1436=marked-form')),
        'the router handled the submission, not the browser');
      assert.equal(window.scrollY, START_Y,
        'a marked submission left the reader where they were');
    } finally { teardown(); }

    try {
      setup();
      document.getElementById('wj-plain-submit').click();
      await settle();

      assertPageSwapped();
      assert.equal(window.scrollY, 0,
        'an unmarked submission still scrolls to top');
    } finally { teardown(); }
  });

  test('7. navigate(url, { scroll: false }) holds the offset, navigate(url) does not', async () => {
    try {
      setup();
      await navigate(href('programmatic'), { scroll: false });
      await settle();

      assertPageSwapped();
      assert.equal(window.scrollY, START_Y,
        'the programmatic option is the twin of the attribute');
    } finally { teardown(); }

    try {
      setup();
      // Read as `opts?.scroll === false`, so an optionless call keeps today's
      // behaviour. A `!opts?.scroll` regression would silently preserve here.
      await navigate(href('programmatic-default'));
      await settle();

      assertPageSwapped();
      assert.equal(window.scrollY, 0,
        'an optionless navigate still scrolls to top');
    } finally { teardown(); }
  });

  test('8. on a FRAME-targeted link the attribute is inert (the #1427 rule holds)', async () => {
    try {
      setup();
      // A frame swap already writes no scroll, so the attribute asks for
      // something already true and no branch was added for it. Marking a <nav>
      // above a mixed set of links makes an inert hit ordinary rather than
      // suspicious, which is why there is no warning either.
      document.getElementById('wj-frame-link').click();
      await settle();

      assert.equal(document.getElementById('wj-frame-content').textContent, 'UPDATED',
        'the frame actually swapped, so this is a real frame nav');
      assert.equal(window.scrollY, START_Y,
        'the frame swap left the window alone, attribute or not');
    } finally { teardown(); }
  });
});
