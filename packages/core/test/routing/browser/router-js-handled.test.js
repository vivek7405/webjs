/**
 * Real-browser tests for the client router's event-phase handling of
 * JS-handled links and forms (#150 submit, #153 click).
 *
 * The router's click + submit listeners are registered in the BUBBLE phase, so
 * a component's per-element `@click` / `@submit` (which runs at-target, before a
 * document-level bubble listener) can `preventDefault` and the router's
 * `if (e.defaultPrevented) return` guard leaves the element alone. A capture
 * listener would fire first, before the component, and wrongly hijack the link
 * (navigate it) or form (submit it).
 *
 * This MUST run in a real browser: linkedom does not model capture-vs-bubble
 * ordering of a document-level vs element-level listener, so the unit env can
 * neither reproduce the bug nor prove the fix. We detect a router interception
 * by stubbing fetch (the router's navigation/submission calls it).
 */
import { html } from '../../../src/html.js';
import { render } from '../../../src/render-client.js';
import { enableClientRouter } from '../../../src/router-client.js';

import { assert } from '../../../../../test/browser-assert.js';
const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Resolve once the router has SETTLED the navigation a click asked for, rather
 * than after an arbitrary macrotask. Two outcomes end a navigation and the
 * router announces both on `document`: `webjs:navigate` when a soft swap
 * committed, `webjs:navigation-fallback` when it degraded to a full load. The
 * promise is created BEFORE the click, because a degradation can be dispatched
 * synchronously from inside the click handler and a listener attached after the
 * click would miss it.
 *
 * The bounded timeout covers the third outcome, a click the router never
 * intercepted at all, which announces nothing. That case must still return so
 * the test fails on its own assertion instead of hanging to the runner's 10s
 * per-test limit (`web-test-runner.config.js`).
 *
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
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
      // Hand back a macrotask later so the router's own post-dispatch work
      // unwinds before the caller asserts and dismantles the fixture.
      setTimeout(resolve, 0);
    };
    timer = setTimeout(settle, timeoutMs);
    document.addEventListener('webjs:navigate', settle);
    document.addEventListener('webjs:navigation-fallback', settle);
  });
}

suite('Client router: JS-handled links/forms are not hijacked (#150, #153)', () => {
  let container, origFetch, fetched, bOpen, bClose, fallbacks, navigated, onFallback, onNavigate;

  function setup() {
    enableClientRouter(); // idempotent; ensures the document listeners are attached
    container = document.createElement('div');
    // Bracket the container with a live keyed boundary pair (#1015) and return
    // a boundary-carrying body, so an intercepted nav swaps softly instead of
    // degrading to a full load (which would navigate the test page away).
    bOpen = document.createComment('wj:children:/:/');
    bClose = document.createComment('/wj:children:/');
    document.body.appendChild(bOpen);
    document.body.appendChild(container);
    document.body.appendChild(bClose);
    // Record both router diagnostics (#1114) for the life of the test. A
    // degradation carries a stable `cause` slug, which is the entire diagnosis
    // when one of these tests reds, so it has to reach the assertion message.
    fallbacks = [];
    navigated = [];
    onFallback = (e) => fallbacks.push(e.detail);
    onNavigate = (e) => navigated.push(e.detail && e.detail.url);
    document.addEventListener('webjs:navigation-fallback', onFallback);
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
    document.removeEventListener('webjs:navigation-fallback', onFallback);
    document.removeEventListener('webjs:navigate', onNavigate);
    window.fetch = origFetch;
    container.remove();
    bOpen.remove();
    bClose.remove();
  }

  /** Render the first fallback's cause for an assertion message. */
  const causeOf = (list) => (list.length ? String(list[0].cause) : 'none');

  test('a @click=preventDefault link is NOT navigated by the router', async () => {
    setup();
    try {
      let ran = false;
      render(html`<a href="/js-handled-link" @click=${(e) => { e.preventDefault(); ran = true; }}>go</a>`, container);
      container.querySelector('a').click();
      await tick();
      // In the healthy case the router did not act, so there is nothing to
      // settle and this costs nothing. On the REGRESSION this test exists to
      // catch, the router hijacked the link and a swap is in flight; tearing
      // the boundary pair out from under it in `finally` is the
      // `live-boundaries-malformed` degradation, which reloads and aborts the
      // whole session instead of failing this test readably.
      if (fetched.length) await awaitNavigation();
      assert.ok(ran, 'the component @click handler ran');
      assert.equal(fetched.filter((u) => u.includes('/js-handled-link')).length, 0,
        'router must NOT navigate a preventDefaulted link');
      assert.equal(fallbacks.length, 0,
        `router must not have degraded a navigation here (cause: ${causeOf(fallbacks)})`);
    } finally { teardown(); }
  });

  test('a @submit=preventDefault form is NOT submitted by the router', async () => {
    setup();
    try {
      let ran = false;
      render(html`<form @submit=${(e) => { e.preventDefault(); ran = true; }}><button type="submit">go</button></form>`, container);
      container.querySelector('button').click();
      await tick();
      // Same reasoning as the link case: only a regression puts a swap in
      // flight, and only then must teardown wait for it.
      if (fetched.length) await awaitNavigation();
      assert.ok(ran, 'the component @submit handler ran');
      assert.equal(fetched.length, 0, 'router must NOT submit a preventDefaulted form');
      assert.equal(fallbacks.length, 0,
        `router must not have degraded a navigation here (cause: ${causeOf(fallbacks)})`);
    } finally { teardown(); }
  });

  test('positive control: a plain <a href> link IS still SPA-navigated by the router', async () => {
    setup();
    try {
      render(html`<a href="/plain-link-target">go</a>`, container);
      // Arm the settle listener BEFORE the click: a degradation can fire
      // synchronously from inside the router's click handler.
      const settled = awaitNavigation();
      container.querySelector('a').click();
      await settled;
      // Assert the degradation channel FIRST: `fetched` alone cannot tell a
      // committed soft swap from a degradation that fetched and then reloaded,
      // so without this the degraded outcome PASSES.
      //
      // This message only reaches the log for a degradation whose `willReload`
      // is false. A reloading one assigns `location.href` in the same task as
      // the dispatch, nothing can cancel a programmatic assignment, and
      // web-test-runner discards the page's buffered console output once the
      // navigation interrupts the session, so neither this assertion nor a
      // synchronous `console.error` from the listener survives (both were
      // measured). Preventing the reload is the only real answer, which is why
      // teardown below waits for a settle instead of a bare macrotask.
      assert.equal(fallbacks.length, 0,
        `router must SOFT-navigate a plain link, but it degraded (cause: ${causeOf(fallbacks)})`);
      assert.ok(fetched.some((u) => u.includes('/plain-link-target')),
        'router must SPA-navigate a plain link (the fix must not break progressive enhancement)');
      // `webjs:navigate` proves the router ran a navigation to completion
      // rather than bailing out part-way (a discarded revalidation, an early
      // error return). It does NOT prove the navigation was soft: the
      // degradation branch in `applySwap` returns `undefined`, which is not
      // the `'discard'` disposition, so `fetchAndApply` falls through and
      // dispatches this event on the reload path too. The `fallbacks`
      // assertion above is the only thing that separates those two.
      assert.ok(navigated.some((u) => u && String(u).includes('/plain-link-target')),
        'the router must run the navigation to completion (webjs:navigate)');
    } finally { teardown(); }
  });
});
