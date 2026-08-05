/**
 * Real-browser tests for `<webjs-frame>` external targeting + the busy
 * lifecycle (#252).
 *
 * Two enhancements, modeled on Turbo's `data-turbo-frame`:
 *   1. External targeting. A trigger carrying `data-webjs-frame="<id>"`
 *      drives the frame with that id even when it is NOT DOM-nested in the
 *      frame, resolved via `getElementById`. `_top` breaks out to a full
 *      nav. Absence keeps today's closest-enclosing-frame default.
 *   2. aria-busy. The router sets `aria-busy="true"` on the frame when its
 *      fetch STARTS and clears it (to `"false"`) on completion (success OR
 *      failure OR abort), and dispatches a bubbling `webjs:frame-busy`
 *      event at both edges.
 *
 * These MUST run in a real browser. The resolution seam reads the live DOM
 * (`closest`, `getElementById`, `dataset`), and the busy toggle is observed
 * across a real fetch + swap that linkedom does not model.
 */
import {
  enableClientRouter,
  _resolveTargetFrameId,
  _FRAME_TOP,
} from '../../../src/router-client.js';

import { assert } from '../../../../../test/browser-assert.js';
import { installNavGuard } from '../../../../../test/browser-nav-guard.js';

/** Shared across the suites below; installed per test in setup(). */
let navGuard;
const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle() { await tick(); await tick(); await tick(); }

const htmlResponse = (body) => Promise.resolve(new Response(body, {
  headers: { 'content-type': 'text/html', 'x-webjs-build': '' },
}));

suite('Client router: <webjs-frame> external targeting (#252)', () => {
  let container;

  function setup() {
    navGuard = installNavGuard();
    enableClientRouter(); // idempotent
    container = document.createElement('div');
    container.innerHTML =
      // An EXTERNAL link (a sidebar), NOT nested in the frame, targeting it
      // by id, plus a wrapper carrying the attribute on an ANCESTOR.
      '<nav id="sidebar" data-webjs-frame="content">' +
        '<a id="ext-ancestor-link" href="/x">via ancestor</a>' +
      '</nav>' +
      '<a id="ext-link" href="/y" data-webjs-frame="content">direct</a>' +
      '<a id="ext-bad-link" href="/z" data-webjs-frame="nope">unresolvable</a>' +
      '<a id="plain-link" href="/p">plain</a>' +
      // The frame itself, with a NESTED link and a `_top` breakout link.
      '<webjs-frame id="content">' +
        '<a id="nested-link" href="/n">nested</a>' +
        '<a id="top-link" href="/t" data-webjs-frame="_top">breakout</a>' +
        '<span id="frame-content">ORIGINAL</span>' +
      '</webjs-frame>';
    document.body.appendChild(container);
  }
  function teardown() { navGuard.remove(); container.remove(); }

  test('an external data-webjs-frame link (not nested) resolves the external frame id', () => {
    setup();
    try {
      const link = document.getElementById('ext-link');
      assert.equal(_resolveTargetFrameId(link), 'content',
        'an external trigger with data-webjs-frame="content" targets that frame');
    } finally { teardown(); }
  });

  test('the attribute may live on an ANCESTOR of the trigger', () => {
    setup();
    try {
      const link = document.getElementById('ext-ancestor-link');
      assert.equal(_resolveTargetFrameId(link), 'content',
        'closest("[data-webjs-frame]") finds the attribute on the wrapping <nav>');
    } finally { teardown(); }
  });

  test('data-webjs-frame="_top" returns null (full nav), even nested inside a frame', () => {
    setup();
    try {
      const link = document.getElementById('top-link');
      assert.equal(_FRAME_TOP, '_top', 'the breakout token is "_top"');
      assert.equal(_resolveTargetFrameId(link), null,
        '_top breaks out of the enclosing frame to a full-page navigation');
    } finally { teardown(); }
  });

  test('no data-webjs-frame keeps the closest-enclosing-frame default', () => {
    setup();
    try {
      const nested = document.getElementById('nested-link');
      assert.equal(_resolveTargetFrameId(nested), 'content',
        'a nested trigger with no attribute falls back to the enclosing frame');
      const plain = document.getElementById('plain-link');
      assert.equal(_resolveTargetFrameId(plain), null,
        'a plain external trigger with no frame context resolves to null');
    } finally { teardown(); }
  });

  test('an unresolvable data-webjs-frame id falls back to null (no throw)', () => {
    setup();
    try {
      const bad = document.getElementById('ext-bad-link');
      const origWarn = console.warn;
      const warnings = [];
      console.warn = (...a) => { warnings.push(a.join(' ')); };
      try {
        assert.equal(_resolveTargetFrameId(bad), null,
          'an id with no matching live <webjs-frame> falls back to a normal nav');
        assert.ok(warnings.some((w) => w.includes('data-webjs-frame="nope"')),
          'a one-time warning names the unresolved id');
      } finally { console.warn = origWarn; }
    } finally { teardown(); }
  });

  test('end-to-end: an EXTERNAL link swaps the frame, leaving the rest of the page intact', async () => {
    setup();
    const origFetch = window.fetch;
    try {
      // The response carries the targeted frame with new content.
      window.fetch = () => htmlResponse(
        '<!doctype html><html><head></head><body>' +
        '<webjs-frame id="content"><span id="frame-content">UPDATED</span></webjs-frame>' +
        '</body></html>'
      );
      // A marker outside the frame proves no full-body swap.
      document.getElementById('ext-link').click();
      await settle();
      assert.equal(document.getElementById('frame-content').textContent, 'UPDATED',
        'the external link swapped the frame content');
      assert.ok(document.getElementById('sidebar'),
        'the sidebar (outside the frame) survived: no full-body swap');
      assert.ok(document.getElementById('plain-link'),
        'other outside-frame content survived');
    } finally { window.fetch = origFetch; teardown(); }
  });
});

suite('Client router: <webjs-frame> aria-busy lifecycle (#252)', () => {
  let container, origFetch;

  function setup() {
    navGuard = installNavGuard();
    enableClientRouter();
    container = document.createElement('div');
    container.innerHTML =
      '<webjs-frame id="busyframe">' +
        '<a id="busy-link" href="/data" data-webjs-frame="busyframe">load</a>' +
        '<span id="busy-content">ORIGINAL</span>' +
      '</webjs-frame>';
    document.body.appendChild(container);
    origFetch = window.fetch;
  }
  function teardown() { navGuard.remove(); window.fetch = origFetch; container.remove(); }

  test('aria-busy is true during the fetch and false after a successful swap, with start+finish events', async () => {
    setup();
    try {
      // A deferred fetch so we can observe the busy state mid-flight.
      let resolveFetch;
      window.fetch = () => new Promise((res) => { resolveFetch = res; });

      /** @type {boolean[]} */
      const busyEvents = [];
      const onBusy = (e) => { busyEvents.push(e.detail.busy); };
      document.addEventListener('webjs:frame-busy', onBusy);

      document.getElementById('busy-link').click();
      await settle();

      const frame = document.getElementById('busyframe');
      // Mid-flight: busy is set, the start event fired.
      assert.equal(frame.getAttribute('aria-busy'), 'true',
        'aria-busy="true" is set while the frame fetch is in flight');
      assert.ok(busyEvents.length >= 1 && busyEvents[0] === true,
        'a webjs:frame-busy { busy: true } event fired at the start');

      // Resolve the fetch with a matching frame; the swap completes.
      resolveFetch(new Response(
        '<!doctype html><html><head></head><body>' +
        '<webjs-frame id="busyframe"><span id="busy-content">UPDATED</span></webjs-frame>' +
        '</body></html>',
        { headers: { 'content-type': 'text/html', 'x-webjs-build': '' } },
      ));
      await settle();
      document.removeEventListener('webjs:frame-busy', onBusy);

      assert.equal(frame.getAttribute('aria-busy'), 'false',
        'aria-busy is cleared to "false" after the swap completes');
      assert.equal(document.getElementById('busy-content').textContent, 'UPDATED',
        'the swap actually applied');
      assert.ok(busyEvents.includes(false),
        'a webjs:frame-busy { busy: false } event fired at the finish');
      assert.equal(busyEvents[busyEvents.length - 1], false,
        'the LAST busy event is the finish (false)');
    } finally { teardown(); }
  });

  test('aria-busy clears on an ABORT (a newer nav supersedes the frame fetch)', async () => {
    setup();
    try {
      // First nav: a fetch that rejects with AbortError, exactly what the
      // router's AbortController throws when a newer nav aborts it. The
      // catch handles AbortError by returning early, so the busy finally is
      // the only thing that clears aria-busy: this proves it clears on the
      // abort exit (no real navigation, so the WTR harness is undisturbed).
      window.fetch = () => Promise.reject(
        Object.assign(new Error('aborted'), { name: 'AbortError' }),
      );
      const frame = document.getElementById('busyframe');
      document.getElementById('busy-link').click();
      await settle();

      assert.equal(frame.getAttribute('aria-busy'), 'false',
        'aria-busy clears to "false" when the frame fetch is aborted');
    } finally { teardown(); }
  });

  test('two rapid frame navs: busy stays true until the SECOND settles (no false mid-load)', async () => {
    // The abort-race guard (#252): nav B supersedes nav A and re-sets busy; A's
    // abort teardown must NOT clear the busy state the live nav B owns, and no
    // spurious { busy: false } may fire while a nav is still in flight.
    setup();
    /** @type {boolean[]} */
    const busyEvents = [];
    const onBusy = (e) => busyEvents.push(e.detail.busy);
    try {
      let resolveLatest;
      // Reject on abort (the router aborts the prior nav), else defer so the
      // newest nav stays in flight under our control.
      window.fetch = (_url, opts = {}) => new Promise((res, rej) => {
        if (opts && opts.signal) {
          opts.signal.addEventListener('abort', () =>
            rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        }
        resolveLatest = res;
      });
      document.addEventListener('webjs:frame-busy', onBusy);
      const frame = document.getElementById('busyframe');

      document.getElementById('busy-link').click(); // nav A
      await settle();
      assert.equal(frame.getAttribute('aria-busy'), 'true', 'nav A set busy');

      document.getElementById('busy-link').click(); // nav B aborts A, re-sets busy
      await settle();
      assert.equal(frame.getAttribute('aria-busy'), 'true',
        'busy stays true while B loads, A abort did not clear the live nav');
      assert.ok(!busyEvents.includes(false),
        'no { busy: false } event fired while a nav is still in flight');

      resolveLatest(new Response(
        '<!doctype html><html><head></head><body>' +
        '<webjs-frame id="busyframe"><span id="busy-content">DONE</span></webjs-frame>' +
        '</body></html>',
        { headers: { 'content-type': 'text/html', 'x-webjs-build': '' } },
      ));
      await settle();
      assert.equal(frame.getAttribute('aria-busy'), 'false', 'busy clears after B settles');
      assert.equal(busyEvents[busyEvents.length - 1], false, 'the last event is the finish (false)');
    } finally {
      document.removeEventListener('webjs:frame-busy', onBusy);
      teardown();
    }
  });

  test('aria-busy clears when the frame is MISSING from the response', async () => {
    setup();
    try {
      window.fetch = () => htmlResponse(
        '<!doctype html><html><head></head><body><h1 id="login">Login</h1></body></html>'
      );
      // Suppress the expected frame-missing warning.
      const origWarn = console.warn;
      console.warn = () => {};
      const frame = document.getElementById('busyframe');
      document.getElementById('busy-link').click();
      await settle();
      console.warn = origWarn;

      assert.equal(frame.getAttribute('aria-busy'), 'false',
        'aria-busy clears even on the frame-missing path');
      assert.ok(document.getElementById('busy-content'),
        'the frame is left unchanged (frame-missing), still in the DOM');
    } finally { teardown(); }
  });
});
