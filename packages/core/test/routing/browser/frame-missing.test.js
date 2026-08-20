/**
 * Real-browser regression tests for the <webjs-frame> "frame missing"
 * contract (#251).
 *
 * The client router's frame escape hatch (applySwap branch 1) swaps only
 * the inside of a matching `<webjs-frame id>`. Before the fix, when a
 * frame-scoped navigation's response did NOT carry the requested frame,
 * control fell through to the full-body swap, silently replacing the
 * ENTIRE document (an auth redirect returning a login page without the
 * frame thus destroyed the page).
 *
 * The fix dispatches a cancelable, bubbling `webjs:frame-missing` event
 * and returns: default behaviour warns and leaves the frame unchanged
 * (never a full-body swap); a listener calling preventDefault owns the
 * outcome.
 *
 * This MUST run in a real browser. The headline behaviour (a CustomEvent
 * fired, the document NOT wholesale-replaced, a stale-but-intact frame)
 * is browser-observable: linkedom does not model the real swap + event
 * dispatch path that drives it. We stub `window.fetch` to return the
 * navigation response, then drive a real link click so `activeFrameId`,
 * `performNavigation`, `fetchAndApply`, and `applySwap` all run exactly
 * as in production.
 */
import { enableClientRouter, loadFrame } from '../../../src/router-client.js';

import { assert } from '../../../../../test/browser-assert.js';
import { installNavGuard } from '../../../../../test/browser-nav-guard.js';

/** Shared across the suites below; installed per test in setup(). */
let navGuard;
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Wait for the router's async navigation pipeline to settle. */
async function settle() { await tick(); await tick(); await tick(); }

const htmlResponse = (body) => Promise.resolve(new Response(body, {
  headers: { 'content-type': 'text/html', 'x-webjs-build': '' },
}));

suite('Client router: <webjs-frame> frame-missing contract (#251)', () => {
  let container, origFetch, origWarn, warnings;

  function setup() {
    navGuard = installNavGuard();
    enableClientRouter(); // idempotent; ensures the document listeners are attached
    container = document.createElement('div');
    // Sibling content that lives OUTSIDE the frame. If the document is
    // wholesale-replaced this node is destroyed: its survival is the
    // proof that no full-body swap happened.
    const sibling = document.createElement('div');
    sibling.id = 'sibling-outside-frame';
    sibling.textContent = 'OUTSIDE';
    document.body.appendChild(sibling);
    // The frame, with a link inside it (so activeFrameId resolves "main")
    // and identifiable content.
    container.innerHTML =
      '<!--wj:children:/:/-->' +
      '<webjs-frame id="main">' +
        '<span id="frame-content">ORIGINAL</span>' +
        '<a id="frame-link" href="/no-frame-here">go</a>' +
      '</webjs-frame>' +
      '<a id="plain-link" href="/plain-target">plain</a>' +
      '<!--/wj:children:/-->';
    document.body.appendChild(container);

    origFetch = window.fetch;
    origWarn = console.warn;
    warnings = [];
    console.warn = (...a) => { warnings.push(a.join(' ')); };
  }
  function teardown() {
    navGuard.remove();
    window.fetch = origFetch;
    console.warn = origWarn;
    container.remove();
    const s = document.getElementById('sibling-outside-frame');
    if (s) s.remove();
  }

  test('a frameless response fires webjs:frame-missing and does NOT wholesale-replace the document', async () => {
    setup();
    try {
      // The navigation response lacks <webjs-frame id="main"> entirely.
      window.fetch = () => htmlResponse(
        '<!doctype html><html><head></head><body>' +
        '<h1 id="login">Please log in</h1>' +
        '</body></html>'
      );

      let evt = null;
      const onMissing = (e) => { evt = e; };
      document.addEventListener('webjs:frame-missing', onMissing);

      document.getElementById('frame-link').click();
      await settle();
      document.removeEventListener('webjs:frame-missing', onMissing);

      // (a) the event fired on document (it bubbles), with the frame id.
      assert.ok(evt, 'webjs:frame-missing must fire when the response lacks the frame');
      assert.equal(evt.detail.frameId, 'main', 'detail.frameId names the requested frame');
      assert.ok(evt.detail.document, 'detail.document carries the parsed response document');
      assert.ok(evt.bubbles, 'event bubbles so a document-level listener catches it');
      assert.ok(evt.cancelable, 'event is cancelable so a listener can preventDefault');

      // (b) the document was NOT wholesale-replaced: the sibling-outside
      // content and the original frame content both survive.
      assert.ok(document.getElementById('sibling-outside-frame'),
        'sibling-outside-frame must survive (no full-body swap)');
      assert.equal(document.getElementById('sibling-outside-frame').textContent, 'OUTSIDE',
        'outside content is untouched');
      assert.ok(document.getElementById('frame-content'),
        'the original frame content stays (frame left unchanged, stale)');
      assert.equal(document.getElementById('frame-content').textContent, 'ORIGINAL',
        'frame content is the original, not the login page');
      assert.ok(!document.getElementById('login'),
        'the frameless response body must NOT have been spliced into the document');

      // default (not prevented): a warning was emitted.
      assert.ok(warnings.some((w) => w.includes('frame "main"') && w.includes('frame-missing')),
        'default behaviour warns about the missing frame');
    } finally { teardown(); }
  });

  // #1398: `applySwap` returns a `'none'` sentinel here, which `fetchAndApply`
  // maps to `applied: false`. Before that, a frame-missing response reported
  // `applied: true` having left the frame untouched.
  test('a frameless response reports applied:false, and a matching one reports true', async () => {
    setup();
    try {
      window.fetch = () => htmlResponse(
        '<!doctype html><html><head></head><body><h1 id="login">Login</h1></body></html>'
      );
      const missing = await loadFrame(document.getElementById('main'), '/no-frame-here');
      assert.equal(missing.applied, false, 'nothing was applied, so it must not claim otherwise');
      assert.equal(missing.aborted, false, 'and it is not an abort either');

      // The counterfactual: an implementation that always reported false would
      // pass the assertion above and fail this one.
      window.fetch = () => htmlResponse(
        '<!doctype html><html><head></head><body>' +
        '<webjs-frame id="main"><span id="frame-content">SWAPPED</span></webjs-frame>' +
        '</body></html>'
      );
      const ok = await loadFrame(document.getElementById('main'), '/has-the-frame');
      assert.equal(ok.applied, true, 'a real frame swap reports applied');
      assert.equal(document.getElementById('frame-content').textContent, 'SWAPPED',
        'and the swap actually happened');
    } finally { teardown(); }
  });

  // The `'none'` sentinel is a REPORTING change and must not alter the
  // pipeline. A click-driven frame nav records history, so an implementation
  // that returned early on the sentinel would stop advancing the URL here,
  // which nothing else in the suite would notice.
  test('a frameless response advances the URL and holds the scroll offset', async () => {
    setup();
    // Observe the history CALL rather than reading `location` afterwards.
    //
    // Reading `location` cannot work here without two history mutations of its
    // own, a park before and a restore after, because an earlier case in this
    // suite clicks the same link and leaves the URL at its target (web-test
    // -runner isolates per file, not per test) so the assertion would otherwise
    // be satisfied by that case's push. Both of those mutations are hazards in
    // their own right: this file's only cross-case leaks have come from exactly
    // those two lines, and WebKit rate-limits history mutations, so either can
    // throw and strand the shared page state on the cases below.
    //
    // A spy needs neither, depends on no sibling case, and asserts the thing
    // directly instead of inferring it from a global the whole file shares.
    const pushed = [];
    const origPush = history.pushState;
    history.pushState = function (...args) { pushed.push(String(args[2])); };
    // The SCROLL half of the same contract (#1427). This path keeps a truthy
    // `frameId` all the way through, so the guard holds the offset even though
    // nothing was applied: the reader gets a changed address over an unchanged
    // panel, still in their place. The docs say so on both surfaces and nothing
    // pinned it, which is how the claim it replaced went stale in the first
    // place. The spacer is what gives the assertion teeth, since a document
    // that cannot hold an offset reports 0 either way.
    const spacer = document.createElement('div');
    spacer.style.height = '3000px';
    document.body.appendChild(spacer);
    try {
      window.fetch = () => htmlResponse(
        '<!doctype html><html><head></head><body><h1 id="login">Login</h1></body></html>'
      );
      window.scrollTo({ left: 0, top: 400, behavior: 'instant' });
      assert.equal(window.scrollY, 400,
        'precondition: the page holds an offset, so a 0 below is the router moving it');

      document.getElementById('frame-link').click();
      await settle();
      assert.equal(pushed.length, 1, 'the frame-missing return still records history');
      assert.match(pushed[0], /\/no-frame-here$/, 'and it advanced to the navigation target');
      assert.equal(window.scrollY, 400,
        'a frame-missing response leaves the window where the reader put it');
    } finally {
      history.pushState = origPush;
      // Reset before the next case: nothing else in this file expects an offset.
      window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
      spacer.remove();
      teardown();
    }
  });

  test('preventDefault suppresses the warning and still performs no full swap', async () => {
    setup();
    try {
      window.fetch = () => htmlResponse(
        '<!doctype html><html><head></head><body><h1 id="login">Login</h1></body></html>'
      );

      let fired = false;
      const onMissing = (e) => { fired = true; e.preventDefault(); };
      document.addEventListener('webjs:frame-missing', onMissing);

      document.getElementById('frame-link').click();
      await settle();
      document.removeEventListener('webjs:frame-missing', onMissing);

      assert.ok(fired, 'listener ran');
      assert.equal(warnings.length, 0,
        'preventDefault suppresses the framework warning (listener owns the outcome)');
      // Still no full-body swap: the framework returns after dispatch.
      assert.ok(document.getElementById('sibling-outside-frame'),
        'no full-body swap even when prevented');
      assert.ok(document.getElementById('frame-content'),
        'frame untouched when prevented');
      assert.ok(!document.getElementById('login'),
        'frameless response body not spliced in');
    } finally { teardown(); }
  });

  test('counterfactual: a response WITH the frame still swaps the frame (happy path intact)', async () => {
    setup();
    try {
      // The response DOES carry <webjs-frame id="main"> with new content.
      window.fetch = () => htmlResponse(
        '<!doctype html><html><head></head><body>' +
        '<webjs-frame id="main"><span id="frame-content">UPDATED</span></webjs-frame>' +
        '</body></html>'
      );

      let fired = false;
      document.addEventListener('webjs:frame-missing', () => { fired = true; }, { once: true });

      document.getElementById('frame-link').click();
      await settle();

      assert.ok(!fired, 'frame-missing must NOT fire when the frame is present');
      assert.equal(document.getElementById('frame-content').textContent, 'UPDATED',
        'the frame content swapped to the response content');
      assert.ok(document.getElementById('sibling-outside-frame'),
        'outside-frame content preserved by the frame swap (no full swap)');
    } finally { teardown(); }
  });

  test('counterfactual: a NON-frame nav (frameId null) never fires frame-missing', async () => {
    setup();
    try {
      // The new guard is scoped to frameId only. A plain link (outside any
      // frame) must NOT trigger frame-missing even when the response lacks
      // any frame: it just falls through to the normal layout/full swap.
      // (The "still swaps normally" guarantee is covered by the positive
      // control in router-js-handled.test.js; here we prove the new early
      // return is scoped to frameId and never over-triggers.)
      window.fetch = () => htmlResponse(
        '<!doctype html><html><head></head><body>' +
        '<!--wj:children:/:/--><h1 id="plain-swapped">Plain target</h1><!--/wj:children:/-->' +
        '</body></html>'
      );

      let fired = false;
      document.addEventListener('webjs:frame-missing', () => { fired = true; }, { once: true });

      document.getElementById('plain-link').click();
      await settle();

      assert.ok(!fired, 'a non-frame nav must NOT fire frame-missing (guard is scoped to frameId)');
    } finally { teardown(); }
  });
});
