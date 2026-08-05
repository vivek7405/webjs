/**
 * Both router fetches must revalidate rather than trust the HTTP cache (#1131).
 *
 * The deploy check reads `x-webjs-build` / `x-webjs-src` off these responses.
 * On a page served with a browser `max-age`, a default-cache fetch can be
 * satisfied wholly from the HTTP cache, replaying pre-deploy ids; the check
 * then compares two equally stale values and skips the snapshot eviction, so
 * a deploy stays invisible for the freshness window plus one
 * stale-while-revalidate serving per URL. `cache: 'no-cache'` forces a
 * conditional request (with stable page ETags, a cheap 304), which keeps the
 * ids live.
 *
 * Runs in a real browser because the assertion is on the exact RequestInit the
 * router hands to fetch, captured through the real click and prefetch paths.
 */
import { enableClientRouter, disableClientRouter } from '../../../src/router-client.js';

import { assert } from '../../../../../test/browser-assert.js';
import { installNavGuard } from '../../../../../test/browser-nav-guard.js';

/** Shared across the suites below; installed per test in setup(). */
let navGuard;
const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle() { for (let i = 0; i < 4; i++) await tick(); }

suite('Client router: fetches revalidate instead of trusting the HTTP cache (#1131)', () => {
  let container, origFetch, calls;

  function setup() {
    navGuard = installNavGuard();
    enableClientRouter();
    container = document.createElement('div');
    container.innerHTML =
      '<header id="outer-chrome">CHROME</header>' +
      '<!--wj:children:/:/-->' +
        '<a id="nav-link" href="/somewhere">go</a>' +
        '<span id="slot-content">ORIGINAL</span>' +
      '<!--/wj:children:/-->';
    document.body.appendChild(container);
    origFetch = window.fetch;
    calls = [];
    window.fetch = (url, init) => {
      calls.push({ url: String(url), init: init || {} });
      // A JSON body drives the router into its in-place error recovery, so the
      // test page never full-navigates away under the stub.
      return Promise.resolve(new Response(JSON.stringify({ nope: true }), {
        status: 500,
        headers: { 'content-type': 'application/json', 'x-webjs-build': '' },
      }));
    };
  }
  function teardown() {
    navGuard.remove();
    window.fetch = origFetch;
    container.remove();
    disableClientRouter();
  }

  test('a navigation fetch is sent with cache: no-cache', async () => {
    setup();
    try {
      document.getElementById('nav-link').click();
      await settle();
      const nav = calls.find((c) => c.url.includes('/somewhere'));
      assert.ok(nav, 'the click produced a router fetch');
      assert.equal(nav.init.cache, 'no-cache',
        'the navigation fetch must revalidate so the deploy check sees live build ids');
    } finally {
      teardown();
    }
  });

  test('a prefetch fetch is sent with cache: no-cache', async () => {
    const origIO = window.IntersectionObserver;
    const ioInstances = [];
    window.IntersectionObserver = class {
      constructor(cb) { this.cb = cb; ioInstances.push(this); }
      observe() {}
      unobserve() {}
      disconnect() {}
      emit(el) { this.cb([{ target: el, isIntersecting: true }], this); }
    };
    disableClientRouter();
    enableClientRouter();
    setup();
    try {
      const link = document.createElement('a');
      link.href = '/prefetched-page';
      link.setAttribute('data-prefetch', 'viewport');
      container.appendChild(link);
      // Surface the link to the router's (stubbed) viewport observer and sit
      // out the dwell gate.
      document.dispatchEvent(new Event('DOMContentLoaded'));
      await settle();
      for (const io of ioInstances) io.emit(link);
      await new Promise((r) => setTimeout(r, 400));
      await settle();
      const pf = calls.find((c) => c.url.includes('/prefetched-page'));
      assert.ok(pf, 'the viewport dwell produced a prefetch fetch');
      assert.equal(pf.init.cache, 'no-cache',
        'the prefetch fetch must revalidate so the deploy check sees live build ids');
    } finally {
      window.IntersectionObserver = origIO;
      teardown();
    }
  });
});
