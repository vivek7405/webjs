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
 * The producer is a hover's intent-prefetch timer OUTLIVING the navigation it
 * precedes:
 *
 *   1. Hover `/docs` on the landing page. The dwell timer starts.
 *   2. Click. The soft nav lands, so the live DOM is now the docs page.
 *   3. The timer fires anyway and prefetches `/docs`, computing `X-Webjs-Have`
 *      from the SWAPPED DOM. The server correctly answers "you already have
 *      everything" with a near-empty fragment, which is cached under `/docs`.
 *   4. Back on the landing page, clicking `/docs` consumes that fragment, the
 *      swap finds no shared boundary, and the router full-loads.
 *
 * Two guards, one test each below, plus the end-to-end sequence.
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
  _buildHaveHeader,
  _resetPrefetch,
} from '../../../src/router-client.js';

import { assert } from '../../../../../test/browser-assert.js';

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
    // Guard 1. Standing on the docs page, the late hover timer targets the docs
    // page itself. Before the fix this issued a fetch whose response was the
    // near-empty "you have everything" fragment, and cached it.
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

  test('an entry cached against a different boundary set is refused on consume', async () => {
    // Guard 2, the belt to guard 1's braces: even if an entry with a stale
    // context reaches the cache by any route, consuming it must not happen.
    // Cache while the live DOM is the DOCS shape...
    setup(DOCS_BODY);
    try {
      const target = location.origin + '/some-other-page';
      _prefetch(target);
      await afterPrefetchAttempt();
      const cached = _prefetchPeek(target);
      assert.ok(cached, 'precondition: fragment cached');
      assert.equal(cached.have, _buildHaveHeader(), 'and it recorded the docs-shaped context');

      // ...then navigate (in DOM terms) back to the HOME shape, which is what
      // happens between the poisoning prefetch and the later click.
      document.body.innerHTML = HOME_BODY;
      assert.notEqual(_buildHaveHeader(), cached.have, 'the live context really did change');

      assert.equal(
        _prefetchTake(target),
        null,
        'the stale-context entry is refused, so the click refetches instead of full-loading'
      );
      assert.equal(_prefetchPeek(target), null, 'and it is evicted rather than left to poison the next click');
    } finally {
      teardown();
    }
  });

  test('the reported hover, swap, click sequence leaves no consumable poison', async () => {
    // The end-to-end shape, in DOM terms. This is the assertion that would have
    // caught the bug: after the full sequence there must be no entry that a
    // click on /docs would consume.
    setup(HOME_BODY);
    try {
      const docsUrl = location.origin + '/docs/intro';

      // 1. Hover on home: a legitimate prefetch, home-shaped context.
      _prefetch(docsUrl);
      await afterPrefetchAttempt();
      assert.equal(calls.length, 1, 'the hover prefetch went out');
      assert.equal(calls[0].have, HOME_HAVE(), 'against the home boundaries');

      // 2. The click consumes it: a hit, because the context still matches.
      const hit = _prefetchTake(docsUrl);
      assert.ok(hit, 'the hover prefetch is consumed as a hit (the feature still works)');

      // 3. The swap lands: the live DOM is now the docs page.
      document.body.innerHTML = DOCS_BODY;

      // 4. The stale hover timer fires while standing on /docs. This is the
      //    poisoning step, and guard 1 must make it inert.
      _prefetch(docsUrl);
      await afterPrefetchAttempt(150);
      assert.equal(
        _prefetchPeek(docsUrl),
        null,
        'the late timer cached nothing, so returning home and clicking /docs cannot full-load'
      );

      // 5. Prove the next click is a clean cache MISS (refetch), not a
      //    poisoned hit. A miss is a round-trip; a poisoned hit was a reload.
      document.body.innerHTML = HOME_BODY;
      assert.equal(_prefetchTake(docsUrl), null, 'no consumable entry remains');
    } finally {
      teardown();
    }
  });

  /** The `have` string the home-shaped body produces, computed live. */
  function HOME_HAVE() {
    const saved = document.body.innerHTML;
    document.body.innerHTML = HOME_BODY;
    const have = _buildHaveHeader();
    document.body.innerHTML = saved;
    return have;
  }
});
