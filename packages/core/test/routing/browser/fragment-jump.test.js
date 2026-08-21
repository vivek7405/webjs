/**
 * Real-browser test for #1437: a same-document fragment jump belongs to the
 * browser, so the router must not fetch, must not swap, and must leave live
 * DOM identity alone.
 *
 * The defect had two halves. `onPopState` treated EVERY popstate as
 * back/forward and re-navigated unconditionally, and the spec's "navigate to a
 * fragment" ends by firing popstate, so an ordinary `<a href="#section">` click
 * entered the full navigation pipeline: it re-fetched the current URL, re-swapped
 * the page, and took the reader's in-progress component state with it. And the
 * click path's own bow-out tested `url.hash` for truthiness, which an empty
 * fragment fails, so `href="#"` was intercepted rather than left alone.
 *
 * This MUST run in a real browser. linkedom implements no layout, no scrolling
 * and no history traversal, so `window.scrollY` never moves there and
 * `history.back()` drives nothing, which makes every assertion below pass
 * vacuously against the bug. The bow-out DECISION is pure and IS unit-tested,
 * beside the other popstate cases in `../router-client.test.js`; what cannot go
 * there is the observable behaviour, which is the whole point of the fix.
 *
 * Fixture discipline, each item load-bearing:
 *
 *   - **DOM survival is asserted with an INJECTED node, not only an expando.**
 *     Measured against the bug: an expando on a node the incoming response ALSO
 *     contains survives the destructive re-swap, because the morph reconciles
 *     that node in place and keeps its identity. Only a node the response does
 *     not contain is removed. So an expando alone is a test that passes with the
 *     bug present. The injected node is the real assertion and the expando is
 *     the secondary signal.
 *   - Every href keeps the page's OWN query string, built from the LIVE
 *     `location.href`. A link that replaces the search string pushes the page
 *     out of its web-test-runner session and takes down the whole run while
 *     every test still reports passing, so it reads as an infrastructure blip.
 *   - The target sits between two tall spacers, so the document can hold a
 *     non-zero offset both before and after the jump and the viewport moves by
 *     an unmistakable margin.
 *   - Clicks go through `el.click()` from page context, NEVER a harness click
 *     API. Those scroll the target into view before dispatching, and an in-page
 *     anchor is usually off screen exactly when this bug matters. That artifact
 *     produced a confidently wrong diagnosis during #1429.
 *   - `currentPageUrl` is seeded explicitly. `enableClientRouter()` seeds it
 *     from `location.href` on a real page load, and setup reproduces that rather
 *     than depending on when the ambient router was last enabled.
 */
import { disableClientRouter, enableClientRouter, _setCurrentPageUrl } from '../../../src/router-client.js';

import { assert } from '../../../../../test/browser-assert.js';
import { installNavGuard } from '../../../../../test/browser-nav-guard.js';

/** Tall enough that the target can reach the viewport top from either side. */
const SPACER = 3000;
/** Where the reader is before a bare-`#` click. Comfortably clear of 0. */
const START_Y = 900;

const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
const tick = () => new Promise((r) => setTimeout(r, 0));
/** Past a fetch, a swap, and the layout either produces. */
async function settle() { for (let i = 0; i < 4; i++) await tick(); await frame(); }

/**
 * This page's url carrying `frag` as its fragment. Built from the LIVE url so
 * the session query string survives (see the header note), which also makes
 * pathname and search match by construction, the precondition the bow-out reads.
 *
 * @param {string} frag Fragment WITHOUT the `#`. Empty gives the bare `#`.
 * @returns {string}
 */
function fragHref(frag) {
  const u = new URL(location.href);
  u.hash = frag;
  // `URL` drops a `#` it considers empty, and the bare-`#` case is precisely
  // the one under test, so append it rather than trusting the serializer.
  return frag === '' ? u.href.replace(/#$/, '') + '#' : u.href;
}

/** A DIFFERENT page, for the cross-document control. */
function otherHref() {
  const u = new URL(location.href);
  u.searchParams.set('wj1437', 'other');
  return u.pathname + u.search;
}

/**
 * The live page: the links, then a tall spacer, the fragment target, and a
 * second spacer. The boundary comments are what keep a swap (which only the
 * control cases should ever produce) inside this container rather than
 * replacing the whole body and taking the harness DOM with it.
 */
function liveHtml() {
  return '<!--wj:children:/:/frag-a-->'
    + '<div id="wj-frag-links">'
      + `<a id="wj-named" href="${fragHref('wj-frag-target')}">named</a>`
      + `<a id="wj-bare" href="#">back to top</a>`
      + `<a id="wj-empty" href="">empty</a>`
      + `<a id="wj-other" href="${otherHref()}">other page</a>`
      + `<a id="wj-noroute" href="${fragHref('wj-frag-target')}" data-no-router>named, data-no-router</a>`
      + '<webjs-frame id="wj-frag-frame">'
        + `<a id="wj-in-frame" href="${fragHref('wj-frag-target')}">named, inside a frame</a>`
        + '<span id="wj-frame-content">ORIGINAL</span>'
      + '</webjs-frame>'
    + '</div>'
    + `<div style="height:${SPACER}px">spacer above</div>`
    + '<span id="wj-frag-target">target</span>'
    + `<div style="height:${SPACER}px">spacer below</div>`
    + '<!--/wj:children:/-->';
}

/**
 * A page response carrying its own spacers, so a swap that DOES happen cannot
 * shorten the document and clamp `scrollY` to 0 for the wrong reason. It
 * repeats the live boundary key, so the router morphs rather than degrading to
 * a full page load, and echoes the live head so the merge cannot drop
 * web-test-runner's session scripts.
 *
 * It deliberately CONTAINS `#wj-frag-stamp`, which is what makes the expando
 * a weak signal and the injected node the real one (see the header note).
 */
function pageResponse() {
  return '<!doctype html><html><head>' + document.head.innerHTML + '</head><body>'
    + '<!--wj:children:/:/frag-a-->'
    + '<span id="wj-frag-stamp">stamp</span>'
    + `<div style="height:${SPACER}px">swapped spacer</div>`
    + '<span id="wj-frag-target">target</span>'
    + `<div style="height:${SPACER}px">swapped spacer below</div>`
    + '<!--/wj:children:/-->'
    + '</body></html>';
}

suite('Client router: a same-document fragment jump is the browser\'s (#1437)', () => {
  let navGuard, container, origFetch, origScrollBehavior, origUrl;
  /** Every fetch the router issued, tagged with whether it asked for a frame. */
  let fetched;
  /** `webjs:navigation-fallback` events seen. A fragment jump must produce none. */
  let fallbacks;
  /** A node the incoming response does NOT contain. The real survival probe. */
  let injected;
  /** A node the response DOES contain, carrying an expando. The weak probe. */
  let stamped;

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

    // The survival probes, both added AFTER the fixture, the way a hydrated
    // component or an app script would add live state the server never sent.
    injected = document.createElement('span');
    injected.id = 'wj-frag-injected';
    injected.textContent = 'client-only';
    container.querySelector('#wj-frag-links').appendChild(injected);
    injected.wjLive = 'injected-expando';

    stamped = document.createElement('span');
    stamped.id = 'wj-frag-stamp';
    stamped.textContent = 'stamp';
    container.querySelector('#wj-frag-links').appendChild(stamped);
    stamped.wjLive = 'stamp-expando';

    fetched = [];
    origFetch = window.fetch;
    window.fetch = (u, init) => {
      const url = String(typeof u === 'string' ? u : (u && u.url) || u);
      const headers = (init && init.headers) || {};
      fetched.push((headers['x-webjs-frame'] ? 'frame:' : 'page:') + url);
      return Promise.resolve(new Response(pageResponse(), {
        headers: { 'content-type': 'text/html', 'x-webjs-build': '' },
      }));
    };

    fallbacks = [];
    document.addEventListener('webjs:navigation-fallback', onFallback);

    // What `enableClientRouter()` does on a real load. Stated here so the case
    // does not inherit whatever url the ambient router was last enabled at.
    _setCurrentPageUrl(location.href);
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }

  function onFallback(e) { fallbacks.push(e.detail && e.detail.cause); }

  async function teardown() {
    document.removeEventListener('webjs:navigation-fallback', onFallback);
    if (origFetch) window.fetch = origFetch;
    // Let anything in flight finish so it cannot swap during a later case.
    for (let i = 0; i < 4; i++) await frame();
    disableClientRouter();
    _setCurrentPageUrl(null);
    // Restore the EXACT url the page was served at, session query string and
    // all. A fragment click pushes a real entry, so this is never a no-op.
    if (origUrl && location.href !== origUrl) history.replaceState(null, '', origUrl);
    if (container) container.remove();
    document.documentElement.style.scrollBehavior = origScrollBehavior;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    navGuard.remove();
    enableClientRouter();
  }

  /** Click from PAGE context. Never a harness click, which scrolls first. */
  function clickIt(id) { document.getElementById(id).click(); }

  /** How far the target is from the top of the viewport. */
  function targetTop() {
    return document.getElementById('wj-frag-target').getBoundingClientRect().top;
  }

  /** Drive a real traversal and wait for the router's handler to have run. */
  async function traverse(go) {
    const popped = new Promise((r) => window.addEventListener('popstate', r, { once: true }));
    go();
    await popped;
    await settle();
  }

  test('a named-fragment click issues no fetch and leaves the live DOM alone', async () => {
    setup();
    try {
      // Assert the precondition, so a fixture that never scrolled cannot pass
      // for the wrong reason.
      assert.ok(targetTop() > 100, 'the target starts well below the viewport top');

      clickIt('wj-named');
      await settle();

      assert.deepEqual(fetched, [], 'a fragment jump needs no server response');
      assert.ok(injected.isConnected, 'the injected node must survive: this is the defect');
      assert.equal(injected.wjLive, 'injected-expando', 'and keep its live state');
      assert.equal(document.getElementById('wj-frag-injected'), injected,
        'the SAME node object, not a re-rendered copy');
      assert.equal(stamped.wjLive, 'stamp-expando');
      assert.ok(Math.abs(targetTop()) <= 2, 'the browser jumped the viewport to the target');
      assert.equal(new URL(location.href).hash, '#wj-frag-target');
      assert.deepEqual(fallbacks, [], 'a same-document jump is not a degradation');
    } finally { await teardown(); }
  });

  test('a bare href="#" scrolls to top natively and issues no fetch', async () => {
    setup();
    try {
      window.scrollTo({ top: START_Y, left: 0, behavior: 'instant' });
      assert.equal(window.scrollY, START_Y, 'the fixture is tall enough to scroll');

      clickIt('wj-bare');
      await settle();

      assert.deepEqual(fetched, [], 'the back-to-top idiom is not a navigation');
      assert.equal(window.scrollY, 0, 'the browser scrolled to the document element');
      assert.ok(location.href.endsWith('#'), 'the empty fragment is in the url');
      assert.ok(injected.isConnected, 'nothing was swapped, so the injected node stands');
      assert.deepEqual(fallbacks, []);
    } finally { await teardown(); }
  });

  test('clicking the SAME fragment link twice still fetches nothing', async () => {
    setup();
    try {
      // The second click is the one that matters. Navigating to the url the
      // page is already on REPLACES rather than pushes, and it still fires
      // popstate, so it reaches the handler with `location.href` unchanged.
      // A guard that required the two hrefs to differ read that as "not a
      // fragment traversal" and fell through to a full navigation, which put
      // the whole defect back on the second click of a back-to-top link.
      clickIt('wj-named');
      await settle();
      assert.deepEqual(fetched, [], 'precondition: the first click is already handled');
      const entriesAfterFirst = history.length;

      clickIt('wj-named');
      await settle();

      assert.deepEqual(fetched, [], 'the repeat click must not navigate either');
      assert.ok(injected.isConnected, 'and must not re-swap the live DOM');
      assert.equal(injected.wjLive, 'injected-expando');
      assert.equal(document.getElementById('wj-frag-injected'), injected,
        'the SAME node object, so nothing was re-rendered');
      assert.equal(history.length, entriesAfterFirst,
        'a repeat fragment click replaces rather than pushing');
      assert.deepEqual(fallbacks, []);
    } finally { await teardown(); }
  });

  test('clicking a bare href="#" twice still fetches nothing', async () => {
    setup();
    try {
      // The same shape on the idiom a reader actually clicks repeatedly.
      window.scrollTo({ top: START_Y, left: 0, behavior: 'instant' });
      clickIt('wj-bare');
      await settle();
      assert.deepEqual(fetched, [], 'precondition');

      window.scrollTo({ top: START_Y, left: 0, behavior: 'instant' });
      clickIt('wj-bare');
      await settle();

      assert.deepEqual(fetched, [], 'back to top, twice, is still not a navigation');
      assert.equal(window.scrollY, 0, 'and it still scrolls to the top');
      assert.ok(injected.isConnected);
      assert.deepEqual(fallbacks, []);
    } finally { await teardown(); }
  });

  test('href="" is NOT a fragment jump and still navigates', async () => {
    setup();
    try {
      // This is what keeps the empty-fragment decision narrow. `href=""`
      // resolves to the current url with the fragment REMOVED, which the spec
      // reloads rather than jumps, so the router must still handle it.
      clickIt('wj-empty');
      await settle();

      assert.equal(fetched.length, 1, 'an empty href carries no fragment, so it navigates');
      assert.ok(fetched[0].startsWith('page:'), 'and it is a page navigation');
    } finally { await teardown(); }
  });

  test('Back after a fragment click is a real traversal and still re-renders', async () => {
    setup();
    try {
      // Deliberately NOT absorbed, and this documents why. A Back between two
      // fragment states looks identical to the Back out of a 422 re-render,
      // which must re-render: `getSubmitAction` prefers the raw `action`
      // ATTRIBUTE, which carries no fragment, so a bound-submitter form
      // declaring `action="/p"` pushes its 422 entry at `/p` while the reader
      // sits at `/p#sec`, and the two differ only by fragment. Separating them
      // needs to know whether the DOM was replaced between the two ENTRIES,
      // which is per-entry state the router does not keep.
      //
      // So the CLICK is fixed and the traversal is left exactly as it behaves
      // without this fix. Absorbing it here would swallow that validation-error
      // Back, which is strictly worse than re-rendering one fragment step.
      clickIt('wj-named');
      await settle();
      assert.deepEqual(fetched, [], 'precondition: the click itself was absorbed');

      await traverse(() => history.back());

      assert.equal(fetched.length, 1, 'a traversal with no click behind it still re-renders');
      assert.ok(fetched[0].startsWith('page:'));
    } finally { await teardown(); }
  });

  test('a data-no-router in-page anchor is left to the browser, every click', async () => {
    setup();
    try {
      // `data-no-router` opts out of ROUTING, and the fragment bow-out routes
      // nothing either way, but the browser still performs the native jump and
      // still fires the popstate. Since the mark is now the ONLY thing that
      // absorbs one, checking that attribute before the bow-out would leave
      // every click of such an anchor unmarked, first and repeat alike, and
      // each would be re-navigated destructively. This is the coverage for that
      // ordering in `events.js`.
      assert.ok(targetTop() > 100, 'the target starts below the viewport top');

      clickIt('wj-noroute');
      await settle();
      assert.deepEqual(fetched, [], 'first click: absorbed on the mark');
      assert.ok(Math.abs(targetTop()) <= 2, 'and the browser jumped natively');

      clickIt('wj-noroute');
      await settle();
      assert.deepEqual(fetched, [], 'repeat click: absorbed on the mark too');

      assert.ok(injected.isConnected, 'the live DOM is untouched throughout');
      assert.equal(document.getElementById('wj-frag-injected'), injected);
      assert.deepEqual(fallbacks, []);
    } finally { await teardown(); }
  });

  test('a genuine cross-document popstate still re-navigates', async () => {
    setup();
    try {
      // The narrowness proof, and the case that reds if the guard is ever
      // widened to compare pathname alone.
      clickIt('wj-other');
      await settle();
      assert.equal(fetched.length, 1, 'precondition: the click navigated');

      await traverse(() => history.back());

      assert.equal(fetched.length, 2, 'a changed search is a real traversal');
      assert.ok(fetched[1].startsWith('page:'));
    } finally { await teardown(); }
  });

  test('a fragment click inside a <webjs-frame> does not drive a frame nav', async () => {
    setup();
    try {
      // The documented trap, inverted. The click bow-out runs BEFORE frame
      // resolution, so the anchor never reaches `resolveTargetFrameId` and the
      // browser performs its own jump, frame or no frame.
      assert.ok(targetTop() > 100, 'the target starts below the viewport top');

      clickIt('wj-in-frame');
      await settle();

      assert.deepEqual(fetched, [], 'no page fetch and no frame fetch');
      assert.ok(Math.abs(targetTop()) <= 2, 'the window moved, natively');
      assert.equal(document.getElementById('wj-frame-content').textContent, 'ORIGINAL',
        'the frame was never swapped');
      assert.ok(injected.isConnected);
      assert.deepEqual(fallbacks, []);
    } finally { await teardown(); }
  });
});
