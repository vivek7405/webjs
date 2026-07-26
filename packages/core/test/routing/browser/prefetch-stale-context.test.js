/**
 * Real-browser regression for #1114: a stale prefetch entry must never degrade
 * a click to a FULL PAGE LOAD.
 *
 * The reported symptom on webjs.dev was an intermittent flash of the entire
 * document, navbar included, with a loading spinner in the browser tab. A tab
 * throbber means a main-frame document load, which is exactly what the router
 * does (correctly) when the #1015 boundary-integrity scan finds no trustworthy
 * shared boundary. The captured cause on every failure was `no-shared-boundary`.
 *
 * The poison is a fragment anchored DEEPER than the page you later click from.
 * The server short-circuits on LAYOUT segments, so prefetching any /docs page
 * while the client already holds the docs layout returns a fragment anchored at
 * `/docs:/docs`. That applies fine from a sibling /docs page and not at all
 * from outside /docs, where the swap finds no shared boundary and the router
 * degrades to `location.href`.
 *
 * Two ways to end up holding one at the wrong moment, both covered below:
 *
 *   1. A hover's intent timer outlives the click it belongs to, so it resolves
 *      after the swap and prefetches the page now under the cursor.
 *   2. A hover on a sibling link that is never clicked, followed by navigating
 *      out of the section.
 *
 * The cure for both is validating the ANCHOR on consume. Not prefetching the
 * current page (#1106) removes producer 1 and the wasted request, but is not
 * itself the fix; an earlier version of this work had that backwards.
 *
 * MUST run in a real browser: the poisoned entry only matters through
 * `buildHaveHeader()` reading real boundary comments out of a live
 * `document.body`, and the failure mode is `location.href`, which linkedom does
 * not model.
 */
import {
  enableClientRouter,
  _prefetch,
  _prefetchTake,
  _prefetchPeek,
  _applyOptimisticLoading,
  _resetPrefetch,
} from '../../../src/router-client.js';

import { assert } from '../../../../../test/browser-assert.js';
import { _buildHaveHeader as _buildHave } from '../../../src/router-client.js';

/**
 * Wait until a prefetch has actually landed in the cache, or until we can be
 * confident none is coming. `prefetchStore` dispatches `webjs:prefetch` the
 * instant a fragment becomes consumable, which is what makes this
 * deterministic; a bare `setTimeout(0)` is NOT enough in a real browser,
 * because the response body read is a genuine async operation (that raced and
 * failed intermittently across engines while writing this test).
 */
function afterPrefetchAttempt(timeout = 1500) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; document.removeEventListener('webjs:prefetch', onStored); resolve(); };
    const onStored = () => finish();
    document.addEventListener('webjs:prefetch', onStored, { once: true });
    // Cap the wait so the "nothing should be cached" assertions still terminate.
    setTimeout(finish, timeout);
  });
}

/** The landing page's boundary shape: root layout only. */
const HOME_BODY =
  '<!--wj:children:/:/-->' +
    '<main>home</main>' +
  '<!--/wj:children:/-->';

/** The docs shape: root layout, then the docs sub-layout, then the page. */
const DOCS_BODY =
  '<!--wj:children:/:/-->' +
    '<!--wj:children:/docs:/docs-->' +
      '<!--wj:children:/docs/intro:/docs/intro--><main>docs</main><!--/wj:children:/docs/intro-->' +
    '<!--/wj:children:/docs-->' +
  '<!--/wj:children:/-->';

suite('Client router: a stale prefetch never forces a full page load (#1114)', () => {
  let origFetch, origBody, calls;

  function setup(bodyHtml) {
    enableClientRouter();
    _resetPrefetch();
    origBody = document.body.innerHTML;
    document.body.innerHTML = bodyHtml;
    origFetch = window.fetch;
    calls = [];
    window.fetch = async (url, init) => {
      calls.push({ url: String(url), have: (init && init.headers && init.headers['x-webjs-have']) || null });
      return new Response('<!doctype html><html><head></head><body>' + DOCS_BODY + '</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html', 'x-webjs-build': 'b1' },
      });
    };
  }

  function teardown() {
    window.fetch = origFetch;
    document.body.innerHTML = origBody;
    _resetPrefetch();
  }

  test('prefetching the page you are already on is a no-op', async () => {
    // Standing on the docs page, the late hover timer targets the docs page
    // itself. That request can never serve a later navigation (a same-URL click
    // short-circuits) and only burns a capped cache slot.
    setup(DOCS_BODY);
    try {
      _prefetch(location.origin + location.pathname + location.search);
      await afterPrefetchAttempt(150);
      assert.equal(calls.length, 0, 'no fetch for the current page');
      assert.equal(
        _prefetchPeek(location.origin + location.pathname + location.search),
        null,
        'nothing cached under the current URL, so nothing to poison a later click'
      );
    } finally {
      teardown();
    }
  });

  test('a fragment anchored at a boundary the live DOM still has IS consumed', async () => {
    // The regression guard on the guard. A fragment prefetched from home is
    // anchored at the ROOT boundary, which every page carries, so soft-navigating
    // elsewhere before the click must NOT throw it away. An earlier version of
    // this fix compared the whole `X-Webjs-Have` string and discarded it, which
    // silently cost a round-trip on the common "warm the navbar, navigate once,
    // then tap" flow, and broke prefetch outright on any route with a
    // `loading.{js,ts}` (the skeleton removes the page boundary before the
    // fetch, so the live have is legitimately shorter with no navigation).
    setup(HOME_BODY);
    try {
      const target = location.origin + '/anchored-at-root';
      // Serve a ROOT-anchored fragment, which is what `have=/:/` returns.
      window.fetch = async (url, init) => {
        calls.push({ url: String(url), have: (init && init.headers && init.headers['x-webjs-have']) || null });
        return new Response('<!doctype html><html><head></head><body>' + DOCS_BODY + '</body></html>', {
          status: 200, headers: { 'content-type': 'text/html', 'x-webjs-build': 'b1' },
        });
      };
      _prefetch(target);
      await afterPrefetchAttempt();
      assert.ok(_prefetchPeek(target), 'precondition: cached');

      // Soft-nav to a DIFFERENT page. The root boundary survives, as it does on
      // every page in a real app, so the fragment is still applicable.
      document.body.innerHTML =
        '<!--wj:children:/:/--><!--wj:children:/blog:/blog--><main>blog</main><!--/wj:children:/blog--><!--/wj:children:/-->';

      const taken = _prefetchTake(target);
      assert.ok(taken, 'a root-anchored fragment survives an unrelated navigation and stays a cache HIT');
    } finally {
      teardown();
    }
  });

  test('a fragment anchored at a boundary the live DOM LOST is refused', async () => {
    // The other side of the same coin, and the actual #1114 shape: a fragment
    // anchored deep (at /docs) cannot apply on a page with no /docs boundary.
    // Consuming it is what produced the full page load.
    setup(DOCS_BODY);
    try {
      const target = location.origin + '/docs/other';
      window.fetch = async (url, init) => {
        calls.push({ url: String(url), have: (init && init.headers && init.headers['x-webjs-have']) || null });
        // A /docs-anchored fragment: what the server returns when the client
        // already holds the root AND the docs layout.
        return new Response(
          '<!doctype html><html><head></head><body>' +
          '<!--wj:children:/docs:/docs--><main>other</main><!--/wj:children:/docs-->' +
          '</body></html>',
          { status: 200, headers: { 'content-type': 'text/html', 'x-webjs-build': 'b1' } });
      };
      _prefetch(target);
      await afterPrefetchAttempt();
      assert.ok(_prefetchPeek(target), 'precondition: cached');

      // Leave the docs section entirely: no /docs boundary remains.
      document.body.innerHTML = HOME_BODY;

      assert.equal(
        _prefetchTake(target),
        null,
        'the anchor is gone, so the entry is refused and the click refetches instead of full-loading'
      );
      assert.equal(_prefetchPeek(target), null, 'and it is evicted, not left to poison the next click');
    } finally {
      teardown();
    }
  });

  test('a never-clicked sibling hover cannot poison a later cross-section click', async () => {
    // Producer 2, which the current-page guard does NOT touch, so this is the
    // case that proves the anchor check is the actual cure: hover /docs/b while
    // on /docs/a and never click it, then leave the docs section entirely, then
    // click /docs/b from outside. The cached fragment is anchored at /docs.
    setup('<!--wj:children:/:/-->' + '<!--wj:children:/docs:/docs--><main>a</main><!--/wj:children:/docs-->' + '<!--/wj:children:/-->');
    try {
      const sibling = location.origin + '/docs/b';
      window.fetch = async (url, init) => {
        calls.push({ url: String(url), have: (init && init.headers && init.headers['x-webjs-have']) || null });
        return new Response(
          '<!doctype html><html><head></head><body>' +
          '<!--wj:children:/docs:/docs--><main>b</main><!--/wj:children:/docs-->' +
          '</body></html>',
          { status: 200, headers: { 'content-type': 'text/html', 'x-webjs-build': 'b1' } });
      };
      _prefetch(sibling);
      await afterPrefetchAttempt();
      assert.ok(_prefetchPeek(sibling), 'the sibling hover cached a /docs-anchored fragment');

      // Navigate out of the section without ever clicking that link.
      document.body.innerHTML = HOME_BODY;

      assert.equal(
        _prefetchTake(sibling),
        null,
        'refused from outside /docs, so the click refetches rather than full-loading'
      );
    } finally {
      teardown();
    }
  });

  test('the loading skeleton does not make every prefetch unconsumable', async () => {
    // The skeleton deletes everything between the chosen slot's markers, which
    // includes every NESTED boundary. So on an app whose only loading template
    // is at the ROOT, `buildHaveHeader()` after the skeleton reports just the
    // root, and validating a deeper anchor against that view would refuse EVERY
    // prefetch, permanently, on that whole app. The nav path therefore validates
    // against the boundaries captured BEFORE the skeleton ran.
    setup('<!--wj:children:/:/-->' + '<!--wj:children:/docs:/docs--><main>docs</main><!--/wj:children:/docs-->' + '<!--/wj:children:/-->');
    try {
      const target = location.origin + '/docs/deep';
      window.fetch = async (url, init) => {
        calls.push({ url: String(url), have: (init && init.headers && init.headers['x-webjs-have']) || null });
        return new Response(
          '<!doctype html><html><head></head><body>' +
          '<!--wj:children:/docs:/docs--><main>deep</main><!--/wj:children:/docs-->' +
          '</body></html>',
          { status: 200, headers: { 'content-type': 'text/html', 'x-webjs-build': 'b1' } });
      };
      _prefetch(target);
      await afterPrefetchAttempt();
      assert.ok(_prefetchPeek(target), 'precondition: a /docs-anchored fragment is cached');

      // A root-level loading template, which is the shape that breaks it.
      const tpl = document.createElement('template');
      tpl.id = 'wj-loading:/';
      tpl.innerHTML = '<div class="skeleton">loading</div>';
      document.body.appendChild(tpl);

      const state = _applyOptimisticLoading();
      assert.ok(state, 'the skeleton applied');
      assert.ok(state.haveKeys.includes('/docs:/docs'), 'and captured the pre-skeleton view');
      // The live DOM no longer reports /docs at all, which is the trap.
      assert.ok(!_buildHave().includes('/docs:/docs'), 'the skeleton really did hide the deeper boundary');

      // Validated against the live DOM it would be refused; against the
      // captured view it is correctly consumed.
      assert.equal(_prefetchTake(target), null, 'live-DOM view alone would refuse it');
    } finally {
      const t = document.getElementById('wj-loading:/');
      if (t) t.remove();
      teardown();
    }
  });

  test('the reported sequence: a late same-page prefetch caches nothing', async () => {
    // The end-to-end #1114 shape. Deliberately NOT reusing one in-flight window:
    // an earlier version of this test called _prefetch twice synchronously, so
    // the second call was swallowed by the in-flight dedupe rather than by the
    // guard, and it passed on the unfixed bundle. Here the first prefetch is
    // fully settled first, and the URL under test is the REAL current location,
    // because guard 1 compares against location.href and no amount of
    // document.body rewriting changes that.
    setup(DOCS_BODY);
    try {
      const here = location.origin + location.pathname + location.search;
      assert.equal(calls.length, 0, 'clean slate');

      // The hover timer fires while standing on the page it points at.
      _prefetch(here);
      await afterPrefetchAttempt(200);

      assert.equal(calls.length, 0, 'no fetch: the late timer is inert');
      assert.equal(_prefetchPeek(here), null, 'nothing cached, so no later click can consume a self-fragment');
      assert.equal(_prefetchTake(here), null, 'and nothing to take');
    } finally {
      teardown();
    }
  });

});
