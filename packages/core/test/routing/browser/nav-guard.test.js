/**
 * The shared browser-test navigation guard (#1135) does its job WITHOUT
 * suppressing the router.
 *
 * This file exists because the guard's phase is a silent correctness trap. A
 * capture-phase guard blocks navigation just as well, so the blocking tests
 * below pass either way; what it also does is set `defaultPrevented` before the
 * router's document-level bubble listener runs, and the router returns
 * immediately on that flag. Every guarded router test would then pass while
 * testing nothing at all. The "router still runs" tests are the regression test
 * for exactly that, and are the reason this is a test rather than a comment.
 *
 * The two halves need DIFFERENT fixtures, which is the non-obvious part:
 *
 * - Blocking is proved with `data-no-router`, which the router deliberately
 *   ignores (`packages/core/src/router-client.js`). The guard is then the ONLY
 *   thing standing between the click and a real document load, so an unchanged
 *   `location` is attributable to the guard alone.
 * - It CANNOT be proved on a plain link, because a successful soft navigation
 *   calls `history.pushState` and legitimately changes `location.pathname`. An
 *   "unchanged pathname" assertion there fails against a perfectly healthy
 *   router, which is exactly what it did when first written that way.
 */
import { html } from '../../../src/html.js';
import { render } from '../../../src/render-client.js';
import { enableClientRouter, _setCurrentPageUrl } from '../../../src/router-client.js';

import { assert } from '../../../../../test/browser-assert.js';
import { installNavGuard } from '../../../../../test/browser-nav-guard.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

suite('Browser-test nav guard (#1135)', () => {
  let container, origFetch, fetched, bOpen, bClose, guard, navigated, onNavigate, origHref;

  function setup() {
    enableClientRouter(); // idempotent; ensures the document listeners are attached
    guard = installNavGuard();
    origHref = location.href;
    // Seed the router's current-page tracker, the way `enableClientRouter()`
    // does on a real load. Teardown puts the URL back but cannot put this back,
    // so without it a case inherits whatever url the PREVIOUS case navigated
    // to, and anything reading the tracker (the fragment bow-out, #1437) then
    // compares against a page this one never visited.
    _setCurrentPageUrl(location.href);
    container = document.createElement('div');
    // A live keyed boundary pair (#1015) so an intercepted nav swaps softly
    // rather than degrading, which the guard could not block.
    bOpen = document.createComment('wj:children:/:/');
    bClose = document.createComment('/wj:children:/');
    document.body.appendChild(bOpen);
    document.body.appendChild(container);
    document.body.appendChild(bClose);
    navigated = [];
    onNavigate = (e) => navigated.push(e.detail && e.detail.url);
    document.addEventListener('webjs:navigate', onNavigate);
    fetched = [];
    origFetch = window.fetch;
    window.fetch = (url) => {
      fetched.push(String(url));
      return Promise.resolve(new Response('<!--wj:children:/:/--><p>x</p><!--/wj:children:/-->', {
        headers: { 'content-type': 'text/html', 'x-webjs-build': '' },
      }));
    };
  }
  function teardown() {
    document.removeEventListener('webjs:navigate', onNavigate);
    window.fetch = origFetch;
    container.remove();
    bOpen.remove();
    bClose.remove();
    guard.remove();
    // A committed soft nav pushState'd a fake URL. Put the runner's own URL
    // back so it does not leak into the next test or file, and clear the
    // tracker with it so the pair cannot drift apart.
    history.replaceState(null, '', origHref);
    _setCurrentPageUrl(null);
  }

  /** Resolve when the router settles, so teardown never runs mid-swap. */
  function awaitNavigation(timeoutMs = 2000) {
    return new Promise((resolve) => {
      let settled = false;
      let timer;
      const settle = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        document.removeEventListener('webjs:navigate', settle);
        document.removeEventListener('webjs:navigation-fallback', settle);
        setTimeout(resolve, 0);
      };
      timer = setTimeout(settle, timeoutMs);
      document.addEventListener('webjs:navigate', settle);
      document.addEventListener('webjs:navigation-fallback', settle);
    });
  }

  test('blocks the default activation of a link the router ignores', async () => {
    setup();
    const before = location.pathname;
    try {
      render(html`<a href="/nav-guard-unrouted" data-no-router>go</a>`, container);
      container.querySelector('a').click();
      await tick();
      // The router returned early on `data-no-router`, so nothing but the guard
      // stopped this click. Reaching this line at all is already half the
      // proof: without the guard the runner page navigates and the whole
      // session is torn down before any assertion runs.
      assert.equal(fetched.length, 0, 'the router must ignore a data-no-router link');
      assert.equal(location.pathname, before,
        'the guard must block the default anchor activation');
    } finally { teardown(); }
  });

  test('blocks the default submission of a form the router ignores', async () => {
    setup();
    const before = location.pathname;
    try {
      render(html`<form method="post" action="/nav-guard-unrouted-form" data-no-router><button type="submit">go</button></form>`, container);
      container.querySelector('button').click();
      await tick();
      assert.equal(fetched.length, 0, 'the router must ignore a data-no-router form');
      assert.equal(location.pathname, before,
        'the guard must block the default form submission');
    } finally { teardown(); }
  });

  test('blocks a link inside a shadow root, which retargets away from the anchor', async () => {
    setup();
    const before = location.pathname;
    try {
      // A `static shadow = true` component rendering a link. The listener is on
      // `window`, so `e.target` here is the HOST, not the anchor, and a
      // `target.closest('a[href]')` lookup finds nothing and fails open. The
      // guard walks the composed path instead, like the router does.
      const host = document.createElement('div');
      container.appendChild(host);
      host.attachShadow({ mode: 'open' }).innerHTML =
        '<a href="/nav-guard-shadow" data-no-router>go</a>';
      host.shadowRoot.querySelector('a').click();
      await tick();
      assert.equal(location.pathname, before,
        'the guard must block an anchor inside a shadow root');
    } finally { teardown(); }
  });

  test('a real degradation is recorded, not performed (#1286)', async () => {
    setup();
    try {
      // Force the router to degrade: strip the live boundary pair so the swap
      // cannot find a shared boundary. That path reports a fallback and then
      // hands the navigation to the browser, which before the seam existed
      // aborted the whole web-test-runner session rather than failing here.
      bOpen.remove();
      bClose.remove();
      render(html`<a href="/nav-guard-degrade">go</a>`, container);
      const settled = awaitNavigation();
      container.querySelector('a').click();
      await settled;

      assert.ok(guard.hardNavigations.some((u) => u.includes('/nav-guard-degrade')),
        'the hard navigation must be RECORDED by the seam');
      // There is deliberately NO in-test assertion that the navigation was not
      // PERFORMED, because none can be honest. `location` cannot serve: the
      // degradation path falls through to `history.pushState`, so the pathname
      // changes either way. Nor can a surviving window sentinel: a
      // `location.href` assignment starts a navigation that commits on a later
      // task rather than tearing the realm down synchronously, so the sentinel
      // reads the same on both sides and would be a vacuous assertion, which is
      // the exact defect class this seam exists to remove.
      //
      // What proves non-performance is the counterfactual: disable the override
      // in `installNavGuard` and this file does not fail, it aborts the whole
      // web-test-runner session on every engine.
      // The cause slug is the diagnosis, and it only survives because the
      // navigation no longer happens.
      assert.ok(guard.fallbacks.length > 0, 'the degradation reported a cause');
      assert.match(String(guard.fallbacks[0].cause), /boundar|shared/,
        `expected a boundary-related cause, got ${guard.fallbacks[0].cause}`);
    } finally {
      // teardown() removes bOpen/bClose; they are already detached here.
      teardown();
    }
  });

  test('does NOT suppress the router on a plain link (capture-phase regression)', async () => {
    setup();
    try {
      render(html`<a href="/nav-guard-target">go</a>`, container);
      const settled = awaitNavigation();
      container.querySelector('a').click();
      await settled;
      // A capture-phase guard would trip the router's `defaultPrevented` early
      // return, leaving `fetched` empty and committing no swap, while the
      // blocking tests above still passed.
      assert.ok(fetched.some((u) => u.includes('/nav-guard-target')),
        'the guard must NOT suppress the router (it still fetches the target)');
      assert.ok(navigated.some((u) => u && String(u).includes('/nav-guard-target')),
        'the guard must NOT suppress the router (the soft swap still commits)');
      assert.equal(guard.fallbacks.length, 0,
        `the nav must be soft, not degraded (cause: ${guard.fallbacks.length ? guard.fallbacks[0].cause : 'none'})`);
    } finally { teardown(); }
  });

  test('does NOT cancel a same-document fragment link, so the browser jumps (#1437)', async () => {
    setup();
    try {
      // The guard cancels an anchor's default so a lost interception race
      // cannot navigate the session away. A same-document fragment link has no
      // such risk (the page never unloads), and cancelling it suppresses the
      // browser's own jump, which is the behaviour the router's fragment
      // bow-out exists to preserve. So the guard has to let this one through.
      const frag = new URL(location.href);
      frag.hash = 'nav-guard-frag-target';
      render(html`
        <div style="height:2000px">spacer</div>
        <span id="nav-guard-frag-target">target</span>
        <div style="height:2000px">spacer</div>
        <a href=${frag.href}>jump</a>
      `, container);
      const target = container.querySelector('#nav-guard-frag-target');
      assert.ok(target.getBoundingClientRect().top > 100, 'the target starts below the fold');

      container.querySelector('a').click();
      await tick();

      assert.ok(Math.abs(target.getBoundingClientRect().top) <= 2,
        'the guard must leave a same-document fragment jump to the browser');
      assert.deepEqual(fetched, [], 'and the router must not have navigated it either');
    } finally {
      history.replaceState(null, '', location.href.split('#')[0]);
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      teardown();
    }
  });

  test('does NOT suppress the router on a plain form submission', async () => {
    setup();
    try {
      render(html`<form method="post" action="/nav-guard-form"><button type="submit">go</button></form>`, container);
      // Wait for a real settle, not a fixed number of macrotasks. A bare
      // `tick()` let teardown remove the live boundary pair while the
      // submission's swap was still running, which is the
      // `no-shared-boundary` degradation, and a degradation assigns
      // `location.href`, which no guard can cancel. Firefox lost that race
      // every run; Chromium and WebKit happened to win it.
      const settled = awaitNavigation();
      container.querySelector('button').click();
      await settled;
      assert.ok(fetched.some((u) => u.includes('/nav-guard-form')),
        'the guard must NOT suppress the router (it still posts the form)');
      assert.equal(guard.fallbacks.length, 0,
        `the submission must be soft, not degraded (cause: ${guard.fallbacks.length ? guard.fallbacks[0].cause : 'none'})`);
    } finally { teardown(); }
  });
});
