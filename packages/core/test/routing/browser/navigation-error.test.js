/**
 * Real-browser regression tests for the client router's in-place
 * navigation-error recovery (#249).
 *
 * Before the fix, a non-HTML error response (a 500 with a JSON body) or a
 * transport/parse failure during a client navigation ABANDONED the SPA
 * with a full `location.href = href` reload, discarding the partial-swap
 * shell, scroll, and in-flight state, and eating a second round-trip that
 * may itself fail to the browser's default error page.
 *
 * The fix dispatches a cancelable, bubbling `webjs:navigation-error` event
 * (detail `{ url, status, error }`) on `document`. If the app calls
 * `preventDefault()` it owns recovery and the page is left untouched.
 * Otherwise the router renders a MINIMAL in-place `role="alert"` surface
 * into the deepest layout children slot (the SPA shell survives), and only
 * hard-navigates as a last resort when no in-place target exists.
 *
 * This MUST run in a real browser. The headline behaviour (a CustomEvent
 * fired, NO full reload, an in-place alert spliced into the children slot,
 * an AbortError NOT firing the event) is browser-observable through the
 * real click + fetch + applySwap path. We stub `window.fetch` to return
 * the failing response, then drive a real link click so `performNavigation`
 * and `fetchAndApply` run exactly as in production. The link lives inside a
 * `wj:children` slot so the default render has a swap target and never
 * touches `location.href`, making "no full reload" observable as "the
 * alert appeared and the outer shell survived".
 */
import { enableClientRouter } from '../../../src/router-client.js';

import { assert } from '../../../../../test/browser-assert.js';
import { installNavGuard } from '../../../../../test/browser-nav-guard.js';

/** Shared across the suites below; installed per test in setup(). */
let navGuard;
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Wait for the router's async navigation pipeline to settle. */
async function settle() { await tick(); await tick(); await tick(); }

const jsonResponse = (obj, status) => Promise.resolve(new Response(JSON.stringify(obj), {
  status,
  headers: { 'content-type': 'application/json', 'x-webjs-build': '' },
}));

suite('Client router: in-place navigation-error recovery (#249)', () => {
  let container, origFetch;

  function setup() {
    navGuard = installNavGuard();
    enableClientRouter(); // idempotent; ensures the document listeners are attached
    container = document.createElement('div');
    // Outer chrome that lives OUTSIDE the children slot. Its survival is
    // the proof that no full-body reload/swap destroyed the SPA shell.
    container.innerHTML =
      '<header id="outer-chrome">CHROME</header>' +
      '<!--wj:children:/:/-->' +
        '<a id="nav-link" href="/boom">go</a>' +
        '<span id="slot-content">ORIGINAL</span>' +
      '<!--/wj:children:/-->';
    document.body.appendChild(container);

    origFetch = window.fetch;
  }
  function teardown() {
    navGuard.remove();
    window.fetch = origFetch;
    container.remove();
  }

  test('a JSON 500 fires webjs:navigation-error and renders the in-place alert (no full reload)', async () => {
    setup();
    try {
      window.fetch = () => jsonResponse({ error: 'boom' }, 500);

      let evt = null;
      const onErr = (e) => { evt = e; };
      document.addEventListener('webjs:navigation-error', onErr);

      document.getElementById('nav-link').click();
      await settle();
      document.removeEventListener('webjs:navigation-error', onErr);

      // (a) the event fired on document (it bubbles), with the right detail.
      assert.ok(evt, 'webjs:navigation-error must fire for a non-HTML 500');
      assert.ok(String(evt.detail.url).endsWith('/boom'), 'detail.url is the failed URL');
      assert.equal(evt.detail.status, 500, 'detail.status is the HTTP status');
      assert.equal(evt.detail.error, null, 'detail.error is null when there was a response');
      assert.ok(evt.bubbles, 'event bubbles so a document-level listener catches it');
      assert.ok(evt.cancelable, 'event is cancelable so a listener can preventDefault');

      // (b) the SPA shell survived (no full reload): outer chrome is intact.
      assert.ok(document.getElementById('outer-chrome'),
        'outer chrome must survive (no full reload)');
      assert.equal(document.getElementById('outer-chrome').textContent, 'CHROME',
        'outer chrome is untouched');

      // (c) the default in-place error surface (role="alert") was rendered
      // into the swap target.
      const alert = container.querySelector('[role="alert"]');
      assert.ok(alert, 'a role="alert" surface is rendered in place');
      assert.ok(alert.textContent.includes('500'),
        'the alert carries the status code');
      assert.ok(!document.getElementById('slot-content'),
        'the prior slot content was replaced by the alert');
    } finally { teardown(); }
  });

  test('preventDefault on the 500 leaves the page intact (app handles recovery)', async () => {
    setup();
    try {
      window.fetch = () => jsonResponse({ error: 'boom' }, 500);

      let fired = false;
      const onErr = (e) => { fired = true; e.preventDefault(); };
      document.addEventListener('webjs:navigation-error', onErr);

      document.getElementById('nav-link').click();
      await settle();
      document.removeEventListener('webjs:navigation-error', onErr);

      assert.ok(fired, 'listener ran');
      // No in-place error surface: the app owns recovery.
      assert.ok(!container.querySelector('[role="alert"]'),
        'preventDefault suppresses the default in-place error surface');
      // The prior content is still there: the shell is fully preserved.
      assert.ok(document.getElementById('slot-content'),
        'the prior slot content is left intact when the app handles the error');
      assert.equal(document.getElementById('slot-content').textContent, 'ORIGINAL',
        'slot content is the original (page untouched)');
      assert.ok(document.getElementById('outer-chrome'),
        'outer chrome survives');
    } finally { teardown(); }
  });

  test('a preventDefault-ed non-HTML error rolls back the optimistic loading skeleton (no stuck skeleton)', async () => {
    setup();
    try {
      // An optimistic loading template, so the nav swaps a skeleton into the
      // slot before the fetch resolves (the loading.ts mechanism).
      const tpl = document.createElement('template');
      tpl.id = 'wj-loading:/';
      tpl.innerHTML = '<span id="skeleton">LOADING</span>';
      container.appendChild(tpl);

      // A deferred fetch so we can observe the skeleton mid-flight.
      let resolveFetch;
      window.fetch = () => new Promise((res) => { resolveFetch = res; });
      const onErr = (e) => { e.preventDefault(); };
      document.addEventListener('webjs:navigation-error', onErr);

      document.getElementById('nav-link').click();
      await settle();
      // Mid-flight: the optimistic skeleton replaced the original content.
      assert.ok(document.getElementById('skeleton'),
        'optimistic loading swapped the skeleton into the slot');
      assert.ok(!document.getElementById('slot-content'),
        'the original content was replaced by the skeleton mid-flight');

      // The non-HTML 500 arrives; the app handles it via preventDefault.
      resolveFetch(new Response(JSON.stringify({ error: 'boom' }), {
        status: 500, headers: { 'content-type': 'application/json' },
      }));
      await settle();
      document.removeEventListener('webjs:navigation-error', onErr);

      // The skeleton must be ROLLED BACK, not left stuck, and the original
      // content restored: the page is exactly as it was before the failed nav.
      assert.ok(!document.getElementById('skeleton'),
        'the loading skeleton is rolled back when the app handles the error');
      assert.ok(document.getElementById('slot-content'),
        'the original slot content is restored');
      assert.equal(document.getElementById('slot-content').textContent, 'ORIGINAL',
        'the page is exactly as it was (no stuck skeleton)');
    } finally { teardown(); }
  });

  test('a transport error fires webjs:navigation-error with error set + renders the in-place surface', async () => {
    setup();
    try {
      // fetch rejects with a non-AbortError (offline / DNS / TLS).
      const boom = new TypeError('Failed to fetch');
      window.fetch = () => Promise.reject(boom);

      let evt = null;
      const onErr = (e) => { evt = e; };
      document.addEventListener('webjs:navigation-error', onErr);

      document.getElementById('nav-link').click();
      await settle();
      document.removeEventListener('webjs:navigation-error', onErr);

      assert.ok(evt, 'webjs:navigation-error must fire on a transport error');
      assert.equal(evt.detail.status, null, 'detail.status is null when there was no response');
      assert.ok(evt.detail.error instanceof Error, 'detail.error is the Error object');
      // In-place surface rendered, no full reload.
      assert.ok(container.querySelector('[role="alert"]'),
        'the in-place error surface is rendered on a transport error');
      assert.ok(document.getElementById('outer-chrome'),
        'outer chrome survives (no full reload)');
    } finally { teardown(); }
  });

  test('an AbortError (superseding nav) does NOT fire webjs:navigation-error', async () => {
    setup();
    try {
      // Simulate a superseding nav: fetch rejects with an AbortError, the
      // exact shape a newer nav aborting an in-flight fetch produces.
      window.fetch = () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      };

      let fired = false;
      const onErr = () => { fired = true; };
      document.addEventListener('webjs:navigation-error', onErr);

      document.getElementById('nav-link').click();
      await settle();
      document.removeEventListener('webjs:navigation-error', onErr);

      assert.ok(!fired,
        'an AbortError is a normal supersede, NOT a navigation error (no false positive)');
      assert.ok(!container.querySelector('[role="alert"]'),
        'no in-place error surface for an aborted nav');
    } finally { teardown(); }
  });
});
