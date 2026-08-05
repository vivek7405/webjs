/**
 * Real-browser regression tests for two view-transition soft-nav defects
 * (#1046, #1048). Both need a real browser: linkedom models neither the
 * streamed-shell swap pipeline nor the async View Transitions API timing that
 * causes the bugs.
 *
 *  #1046: a page-scoped `<meta>` (the `view-transition` opt-in, a per-page
 *  `robots` / og:*) the previous page declared must be REMOVED on a soft nav to
 *  a page that does not declare it, not leaked onto every later page. The
 *  add-only head merge never removed it; `reconcileHeadMetas` now does.
 *
 *  #1048: with view transitions ON, `startViewTransition` defers the swap a
 *  frame, so a Suspense resolve that ran right after the swap call targeted the
 *  pre-swap DOM (no placeholder) and the skeleton stuck. The resolve is now
 *  gated on the swap COMMIT. We stub an ASYNC `startViewTransition` (deferring
 *  the callback to a microtask, exactly like the real API) so the race is real,
 *  and assert the streamed boundary resolves to content, not a stuck skeleton.
 *
 * We stub `window.fetch` to return the navigation response and drive a real
 * link click so `applySwap` runs exactly as in prod.
 */
import { enableClientRouter } from '../../../src/router-client.js';
import { assert } from '../../../../../test/browser-assert.js';
import { installNavGuard } from '../../../../../test/browser-nav-guard.js';

/** Shared across the suites below; installed per test in setup(). */
let navGuard;

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle() { for (let i = 0; i < 6; i++) await tick(); }

const htmlResponse = (body) => Promise.resolve(new Response(body, {
  headers: { 'content-type': 'text/html', 'x-webjs-build': '' },
}));

function setViewTransitionMeta(on) {
  let meta = document.querySelector('meta[name="view-transition"]');
  if (on) {
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'view-transition');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', 'same-origin');
  } else if (meta) {
    meta.remove();
  }
}

suite('Client router: page-scoped <meta> reconciliation on soft nav (#1046)', () => {
  let container, origFetch, origSVT;
  function setup() {
    navGuard = installNavGuard();
    enableClientRouter();
    container = document.createElement('div');
    document.body.appendChild(container);
    origFetch = window.fetch;
    origSVT = document.startViewTransition;
  }
  function teardown() {
    navGuard.remove();
    window.fetch = origFetch;
    document.startViewTransition = origSVT;
    setViewTransitionMeta(false);
    // Clean any test-added app-wide metas.
    for (const m of [...document.head.querySelectorAll('meta[name="robots"]')]) m.remove();
    container.remove();
  }

  test('a stale view-transition meta is removed when the incoming page does not declare it', async () => {
    setup();
    try {
      // The current page opted into view transitions.
      setViewTransitionMeta(true);
      container.innerHTML =
        '<!--wj:children:/a:/a-->' +
        '<a id="a-link" href="/a-target"></a>' +
        '<span id="a-content">OLD</span>' +
        '<!--/wj:children:/a-->';

      // The incoming page carries the app-wide metas but NOT view-transition.
      window.fetch = () => htmlResponse(
        '<!doctype html><html><head>' +
        '<meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width">' +
        '</head><body>' +
        '<!--wj:children:/a:/a--><span id="a-content">NEW</span><!--/wj:children:/a-->' +
        '</body></html>'
      );

      document.getElementById('a-link').click();
      await settle();

      assert.equal(document.querySelectorAll('meta[name="view-transition"]').length, 0,
        'the stale page-scoped view-transition meta is removed on the soft nav');
      assert.equal(document.getElementById('a-content').textContent, 'NEW',
        'the swap still applied');
    } finally { teardown(); }
  });

  test('a frame nav (headless fragment) does NOT strip live page-scoped metas (#1046 regression)', async () => {
    setup();
    try {
      // Live head carries app-wide metas.
      const vp = document.createElement('meta');
      vp.setAttribute('name', 'viewport'); vp.setAttribute('content', 'width=device-width');
      document.head.appendChild(vp);

      container.innerHTML =
        '<webjs-frame id="hf">' +
        '<span id="hf-content">OLD</span>' +
        '<a id="hf-link" href="/hf-target"></a>' +
        '</webjs-frame>';

      // A frame nav response is a BARE subtree fragment: no <head>.
      window.fetch = () => htmlResponse(
        '<webjs-frame id="hf"><span id="hf-content">NEW</span></webjs-frame>'
      );

      document.getElementById('hf-link').click();
      await settle();

      assert.equal(document.getElementById('hf-content').textContent, 'NEW', 'the frame swapped');
      assert.ok(document.querySelector('meta[name="viewport"]'),
        'the viewport meta survives a headless frame swap (not stripped by the reconcile)');
    } finally {
      const m = document.querySelector('meta[name="viewport"]'); if (m) m.remove();
      teardown();
    }
  });

  test('an app-wide meta present in the incoming head is preserved (not churned)', async () => {
    setup();
    try {
      // A live app-wide robots meta that the incoming page also declares.
      const robots = document.createElement('meta');
      robots.setAttribute('name', 'robots');
      robots.setAttribute('content', 'index,follow');
      document.head.appendChild(robots);

      container.innerHTML =
        '<!--wj:children:/b:/b-->' +
        '<a id="b-link" href="/b-target"></a>' +
        '<span id="b-content">OLD</span>' +
        '<!--/wj:children:/b-->';

      window.fetch = () => htmlResponse(
        '<!doctype html><html><head>' +
        '<meta name="robots" content="index,follow">' +
        '</head><body>' +
        '<!--wj:children:/b:/b--><span id="b-content">NEW</span><!--/wj:children:/b-->' +
        '</body></html>'
      );

      document.getElementById('b-link').click();
      await settle();

      const live = document.querySelectorAll('meta[name="robots"]');
      assert.equal(live.length, 1, 'exactly one robots meta (kept, not duplicated)');
      assert.equal(live[0].getAttribute('content'), 'index,follow', 'content unchanged');
    } finally { teardown(); }
  });
});

suite('Client router: Suspense streaming resolves under view transitions (#1048)', () => {
  let container, origFetch, origSVT;

  // A streamed navigation response. The shell (up to the shell sentinel) brings
  // the #s1 skeleton placeholder in via a REPLACE-tier swap (the child boundary
  // route-key changes /s/a -> /s/b), so the placeholder exists ONLY after the
  // swap commits, never in the pre-nav DOM. The resolved boundary template
  // follows the sentinel. This is what makes the swap-vs-resolve timing matter:
  // if the resolve runs before the deferred view-transition swap commits, it
  // finds no #s1 and the skeleton sticks.
  const streamedBody =
    // The target page ALSO opts into view transitions, so the meta survives the
    // head reconcile and the swap genuinely runs under an async transition (the
    // #1048 scenario). Without this the #1046 reconcile would drop the meta and
    // turn transitions off before the swap, masking the race.
    '<!doctype html><html><head><meta name="view-transition" content="same-origin"></head><body>' +
    '<!--wj:children:/:/-->' +
    '<!--wj:children:/s/[x]:/s/b-->' +
    '<div id="s1">SKELETON</div>' +
    '<!--/wj:children:/s/[x]-->' +
    '<!--/wj:children:/-->' +
    '<!--wj-stream-shell-->' +
    '<template data-webjs-resolve="s1"><div id="resolved">RESOLVED</div></template>' +
    '</body></html>';

  // Same streamed shell but WITHOUT the view-transition opt-in, for the
  // synchronous-swap (no-regression) case.
  const streamedBodyNoVT = streamedBody.replace(
    '<meta name="view-transition" content="same-origin">', '');

  const liveShell = (linkId) =>
    '<!--wj:children:/:/-->' +
    '<!--wj:children:/s/[x]:/s/a-->' +
    `<a id="${linkId}" href="/s-target"></a>` +
    '<!--/wj:children:/s/[x]-->' +
    '<!--/wj:children:/-->';

  function setup() {
    navGuard = installNavGuard();
    enableClientRouter();
    container = document.createElement('div');
    document.body.appendChild(container);
    origFetch = window.fetch;
    origSVT = document.startViewTransition;
  }
  function teardown() {
    navGuard.remove();
    window.fetch = origFetch;
    document.startViewTransition = origSVT;
    setViewTransitionMeta(false);
    container.remove();
  }

  // Stub an ASYNC startViewTransition: defer the DOM-mutation callback to a
  // microtask and expose updateCallbackDone, exactly the timing that stuck the
  // skeleton before the fix.
  function stubAsyncSVT() {
    document.startViewTransition = (cb) => {
      const updateCallbackDone = Promise.resolve().then(() => cb());
      return { updateCallbackDone, finished: updateCallbackDone, ready: updateCallbackDone };
    };
  }

  test('a streamed Suspense boundary resolves (skeleton not stuck) with an async view transition', async () => {
    setup();
    try {
      setViewTransitionMeta(true);
      stubAsyncSVT();
      container.innerHTML = liveShell('s-link');
      assert.ok(!document.getElementById('s1'), 'no placeholder before the nav (arrives via the swap)');

      window.fetch = () => htmlResponse(streamedBody);

      document.getElementById('s-link').click();
      await settle();

      assert.ok(document.getElementById('resolved'),
        'the streamed boundary resolved to its content');
      assert.equal(document.getElementById('resolved').textContent, 'RESOLVED',
        'content is the resolved boundary, not the skeleton');
      assert.ok(!document.getElementById('s1'),
        'the #s1 skeleton placeholder was replaced (not stuck)');
    } finally { teardown(); }
  });

  test('the same streamed nav resolves with view transitions OFF (no regression)', async () => {
    setup();
    try {
      setViewTransitionMeta(false); // sync swap path, and the target does not opt in either
      container.innerHTML = liveShell('s2-link');

      window.fetch = () => htmlResponse(streamedBodyNoVT);

      document.getElementById('s2-link').click();
      await settle();

      assert.ok(document.getElementById('resolved'), 'boundary resolves on the synchronous path too');
      assert.ok(!document.getElementById('s1'), 'skeleton replaced');
    } finally { teardown(); }
  });
});
