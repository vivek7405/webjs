/**
 * Real-browser tests for the dev error overlay renderer (#264).
 *
 * `dev-overlay.js` is the BROWSER half of the dev error overlay: the exact
 * source the dev reload client inlines (`reloadClientJs` reads this file,
 * strips `export`, and embeds it), so driving it here tests the code that
 * ships. The headline acceptance ("the dev reload client renders an overlay on
 * a webjs-error event") is browser-observable, so it MUST run in a real browser.
 *
 * The security property is the most important assertion: the overlay is built
 * with textContent only, so a hostile error message can never inject markup.
 */
import {
  renderDevOverlay,
  dismissDevOverlay,
  syncDevOverlayToLocation,
  installDevOverlayNavSync,
  markDevOverlayNavStart,
} from '../../../src/dev-overlay.js';

import { assert } from '../../../../../test/browser-assert.js';

suite('dev error overlay renderer (#264)', () => {
  function teardown() {
    dismissDevOverlay();
    document.querySelectorAll('[data-webjs-error-overlay]').forEach((e) => e.remove());
  }

  test('renders an overlay carrying the message, file:line, code frame, hint, and stack', () => {
    renderDevOverlay({
      kind: 'ts-strip',
      message: 'enum is not erasable',
      file: '/app/components/bad.ts',
      line: 2,
      column: 1,
      codeFrame: '> 2 | enum Color { Red }',
      hint: 'use erasable equivalents',
      stack: 'Error: enum\n    at strip (/app/components/bad.ts:2:1)',
    });
    const overlay = document.querySelector('[data-webjs-error-overlay]');
    assert.ok(overlay, 'an overlay element is in the DOM');
    const text = overlay.textContent;
    assert.ok(text.includes('enum is not erasable'), 'the message renders');
    assert.ok(text.includes('/app/components/bad.ts:2:1'), 'the file:line:column renders');
    assert.ok(text.includes('enum Color { Red }'), 'the code frame renders');
    assert.ok(text.includes('use erasable equivalents'), 'the hint renders (in the UI, not only a console comment)');
    assert.ok(text.includes('TypeScript error'), 'the kind label renders for a ts-strip');
    assert.ok(overlay.querySelector('pre'), 'the code frame is in a <pre>');
    assert.ok(overlay.querySelector('details'), 'the stack is in a collapsible <details>');
    assert.ok(text.includes('Stack trace'), 'the stack section renders');
    teardown();
  });

  test('SECURITY: a script-laden message is rendered as inert text, never injected', () => {
    renderDevOverlay({
      kind: 'render',
      message: '<script>window.__pwned = true;</script><img src=x onerror=alert(1)>',
      file: null,
      codeFrame: '<script>also.this()</script>',
    });
    const overlay = document.querySelector('[data-webjs-error-overlay]');
    assert.ok(overlay, 'overlay present');
    // The hostile markup is present as TEXT...
    assert.ok(overlay.textContent.includes('<script>window.__pwned'), 'the message shows as literal text');
    // ...but NO script/img element was ever created inside the overlay.
    assert.equal(overlay.querySelector('script'), null, 'no <script> element injected');
    assert.equal(overlay.querySelector('img'), null, 'no <img> element injected');
    assert.equal(window.__pwned, undefined, 'the inline script never executed');
    teardown();
  });

  test('a second render replaces the first (one overlay at a time), dismiss removes it', () => {
    renderDevOverlay({ kind: 'render', message: 'first' });
    renderDevOverlay({ kind: 'render', message: 'second' });
    assert.equal(document.querySelectorAll('[data-webjs-error-overlay]').length, 1, 'exactly one overlay');
    assert.ok(document.querySelector('[data-webjs-error-overlay]').textContent.includes('second'), 'the latest frame wins');
    dismissDevOverlay();
    assert.equal(document.querySelector('[data-webjs-error-overlay]'), null, 'dismiss removes the overlay');
    teardown();
  });

  test('the Dismiss button removes the overlay', () => {
    renderDevOverlay({ kind: 'rebuild', message: 'boom' });
    const overlay = document.querySelector('[data-webjs-error-overlay]');
    overlay.querySelector('button').click();
    assert.equal(document.querySelector('[data-webjs-error-overlay]'), null, 'clicking Dismiss removes it');
    teardown();
  });
});

/**
 * The URL scope gate (#1047). A render frame carries the url that produced it,
 * and the overlay renders only on that page. The whole point is browser
 * behaviour (what is in the DOM after a client-router navigation, and what a
 * mere link prefetch does NOT put there), so it belongs here rather than in a
 * node unit test.
 */
suite('dev error overlay URL scope (#1047)', () => {
  const HERE = '/good';
  const CRASH = '/crash';

  function teardown() {
    dismissDevOverlay();
    document.querySelectorAll('[data-webjs-error-overlay]').forEach((e) => e.remove());
  }

  const overlay = () => document.querySelector('[data-webjs-error-overlay]');

  test('a render frame for ANOTHER page renders nothing (the prefetch case)', () => {
    // Hovering a link to a throwing page fires a real GET, which reports a
    // frame to every open tab. The tab is looking at /good, so: no overlay.
    renderDevOverlay({ kind: 'render', message: 'demo: this page threw', url: CRASH }, HERE);
    assert.equal(overlay(), null, 'another page\'s render error stays off this page');
    teardown();
  });

  test('a render frame for THIS page renders normally', () => {
    renderDevOverlay({ kind: 'render', message: 'demo: this page threw', url: CRASH }, CRASH);
    assert.ok(overlay(), 'the page that actually threw still shows its overlay');
    assert.ok(overlay().textContent.includes('demo: this page threw'));
    teardown();
  });

  test('a frame with no url always renders (rebuild / ts-strip are not URL-scoped)', () => {
    // These describe a still-broken build, not one page, so scoping them would
    // hide a real state. Only the next successful rebuild clears them.
    renderDevOverlay({ kind: 'rebuild', message: 'rebuild failed' }, HERE);
    assert.ok(overlay(), 'a rebuild frame renders wherever you are');
    teardown();
    renderDevOverlay({ kind: 'ts-strip', message: 'enum is not erasable' }, HERE);
    assert.ok(overlay(), 'a ts-strip frame renders wherever you are');
    teardown();
  });

  test('a refused render frame does not wipe a live rebuild overlay', () => {
    // renderDevOverlay used to dismiss first and build second, so a foreign
    // frame would have taken down an unrelated, still-current overlay.
    renderDevOverlay({ kind: 'rebuild', message: 'rebuild failed' }, HERE);
    renderDevOverlay({ kind: 'render', message: 'someone else threw', url: CRASH }, HERE);
    assert.ok(overlay(), 'the rebuild overlay survives');
    assert.ok(overlay().textContent.includes('rebuild failed'), 'and it is still the rebuild one');
    teardown();
  });

  test('a frame that arrives BEFORE the URL advances renders once it does', () => {
    // The real ordering on a click through to a throwing page: the navigation
    // starts, the SSE frame is pushed during the render, so it lands while
    // location is still the old page. Refuse-and-drop would lose the overlay on
    // the page that threw.
    markDevOverlayNavStart();
    renderDevOverlay({ kind: 'render', message: 'demo: this page threw', url: CRASH }, HERE);
    assert.equal(overlay(), null, 'held, not shown, while still on the old page');
    syncDevOverlayToLocation(CRASH);
    assert.ok(overlay(), 'and shown once the navigation lands on it');
    assert.ok(overlay().textContent.includes('demo: this page threw'));
    teardown();
  });

  test('a frame held from an IDLE render never paints on a later visit', () => {
    // Another tab renders /crash and it throws, so the frame reaches this tab
    // over the shared SSE channel while it sits on /good with no navigation in
    // flight. If /crash later renders fine, visiting it must be clean: painting
    // the held frame there would put a "Server render error" over a page that
    // just rendered perfectly, which is the bug this whole gate exists to stop.
    //
    // Driven through the INSTALLED listeners, not by calling the nav-start
    // marker by hand: `webjs:before-cache` is the only thing that bumps the
    // seq in the shipping client, so a test that marks it directly would pass
    // with that wiring deleted.
    let path = HERE;
    const uninstall = installDevOverlayNavSync({ document, window, getPath: () => path });
    try {
      renderDevOverlay({ kind: 'render', message: 'stale, from another tab', url: CRASH }, HERE);
      assert.equal(overlay(), null, 'held while idle');
      // The user now clicks through to /crash, and it renders fine this time.
      document.dispatchEvent(new CustomEvent('webjs:before-cache', { detail: { url: HERE } }));
      path = CRASH;
      document.dispatchEvent(new CustomEvent('webjs:navigate', { detail: { url: CRASH } }));
      assert.equal(overlay(), null, 'the idle-time frame is not this navigation\'s');
    } finally { uninstall(); teardown(); }
  });

  test('a snapshot restore cannot leave an undismissable overlay copy behind', () => {
    // The router's back/forward snapshot is `outerHTML`, so it can carry an
    // overlay, and its tier-4 restore does `document.body.replaceChildren`
    // straight from that HTML. The reinserted copy is not the node this module
    // holds, so nothing could remove it and its Dismiss button has no listener.
    renderDevOverlay({ kind: 'render', message: 'was on screen at snapshot time', url: CRASH }, CRASH);
    const snapshot = overlay().outerHTML;
    overlay().remove();                                   // the body swap drops the live node...
    document.body.insertAdjacentHTML('beforeend', snapshot); // ...and parses the cached copy in
    assert.ok(overlay(), 'the restored copy is in the DOM');

    syncDevOverlayToLocation(CRASH);
    const after = document.querySelectorAll('[data-webjs-error-overlay]');
    assert.equal(after.length, 1, 'exactly one overlay, not the copy plus a re-render');
    after[0].querySelector('button').click();
    assert.equal(overlay(), null, 'and it is a real one: Dismiss works');
    teardown();
  });

  test('a frame held during a navigation still renders even after a later one', () => {
    // The counterpart: the seq must not be so strict that it drops a frame that
    // genuinely belongs to the navigation now finishing.
    markDevOverlayNavStart();
    markDevOverlayNavStart();
    renderDevOverlay({ kind: 'render', message: 'this nav threw', url: CRASH }, HERE);
    syncDevOverlayToLocation(CRASH);
    assert.ok(overlay(), 'the in-flight navigation\'s own frame still renders');
    teardown();
  });

  test('navigating away takes a live overlay down; a rebuild overlay stays', () => {
    renderDevOverlay({ kind: 'render', message: 'demo: this page threw', url: CRASH }, CRASH);
    syncDevOverlayToLocation(HERE);
    assert.equal(overlay(), null, 'the stale overlay is gone after the swap');

    renderDevOverlay({ kind: 'rebuild', message: 'rebuild failed' }, HERE);
    syncDevOverlayToLocation(CRASH);
    assert.ok(overlay(), 'a rebuild overlay is not URL-scoped, so navigation leaves it alone');
    teardown();
  });

  test('a held frame is consumed by the first navigation, so it cannot resurface later', () => {
    renderDevOverlay({ kind: 'render', message: 'demo: this page threw', url: CRASH }, HERE);
    syncDevOverlayToLocation('/somewhere-else');
    assert.equal(overlay(), null, 'dropped by a navigation that is not its page');
    syncDevOverlayToLocation(CRASH);
    assert.equal(overlay(), null, 'and it does not come back on a later visit');
    teardown();
  });

  test('a manual dismiss is not resurrected by a later navigation', () => {
    renderDevOverlay({ kind: 'render', message: 'demo: this page threw', url: CRASH }, CRASH);
    overlay().querySelector('button').click();
    syncDevOverlayToLocation(CRASH);
    assert.equal(overlay(), null, 'once you dismiss it, it stays dismissed');
    teardown();
  });

  test('the gate is percent-encoding tolerant, so a dynamic segment still matches', () => {
    // A mismatch fails closed (no overlay), so an encoding difference between
    // the server-stamped url and location.pathname would hide a real error.
    renderDevOverlay({ kind: 'render', message: 'boom', url: '/blog/hello%20world' }, '/blog/hello world');
    assert.ok(overlay(), 'encoded and decoded forms of the same path match');
    teardown();
  });

  test('installDevOverlayNavSync wires webjs:navigate, popstate, and webjs:before-cache', () => {
    let path = HERE;
    const uninstall = installDevOverlayNavSync({
      document, window, getPath: () => path,
    });
    try {
      // The real click-through sequence the router produces, in order:
      // before-cache (it snapshots the page it is leaving, at the TOP of the
      // navigation), then the frame lands mid-render, then navigate.
      document.dispatchEvent(new CustomEvent('webjs:before-cache', { detail: { url: HERE } }));
      renderDevOverlay({ kind: 'render', message: 'demo: this page threw', url: CRASH }, HERE);
      assert.equal(overlay(), null, 'held while still on the old page');
      path = CRASH;
      document.dispatchEvent(new CustomEvent('webjs:navigate', { detail: { url: CRASH } }));
      assert.ok(overlay(), 'webjs:navigate renders it on the page it belongs to');

      // Navigating on: before-cache must NOT tear the overlay down by itself
      // (it fires on every navigation, including ones that go nowhere), and
      // webjs:navigate takes it down because the page changed.
      document.dispatchEvent(new CustomEvent('webjs:before-cache', { detail: { url: CRASH } }));
      assert.ok(overlay(), 'before-cache alone does not remove anything');
      path = HERE;
      document.dispatchEvent(new CustomEvent('webjs:navigate', { detail: { url: HERE } }));
      assert.equal(overlay(), null, 'the overlay follows the page off screen');

      // popstate, because a snapshot-cache restore returns before the router
      // dispatches webjs:navigate.
      renderDevOverlay({ kind: 'render', message: 'still broken', url: HERE }, HERE);
      path = CRASH;
      window.dispatchEvent(new PopStateEvent('popstate'));
      assert.equal(overlay(), null, 'popstate alone is enough to take a stale overlay down');

      // A frame nav leaves the path alone, so a live overlay stays put.
      renderDevOverlay({ kind: 'render', message: 'still broken', url: CRASH }, CRASH);
      document.dispatchEvent(new CustomEvent('webjs:navigate', { detail: { url: CRASH } }));
      assert.ok(overlay(), 'a navigation that does not change the path keeps the overlay');

      // The regression this ordering exists to catch: before-cache fires on
      // EVERY navigation, so stripping the overlay there would tear a rebuild
      // or ts-strip overlay off the page the instant you clicked any link,
      // while the build was still broken and nothing would put it back.
      teardown();
      renderDevOverlay({ kind: 'rebuild', message: 'rebuild failed' }, CRASH);
      document.dispatchEvent(new CustomEvent('webjs:before-cache', { detail: { url: CRASH } }));
      path = HERE;
      document.dispatchEvent(new CustomEvent('webjs:navigate', { detail: { url: HERE } }));
      assert.ok(overlay(), 'a rebuild overlay survives a client-router navigation');
      assert.ok(overlay().textContent.includes('rebuild failed'), 'and it is still the rebuild one');
    } finally {
      uninstall();
      teardown();
    }
  });

  test('the uninstall thunk really unwires the listeners', () => {
    let path = CRASH;
    const uninstall = installDevOverlayNavSync({ document, window, getPath: () => path });
    renderDevOverlay({ kind: 'render', message: 'boom', url: CRASH }, CRASH);
    uninstall();
    path = HERE;
    document.dispatchEvent(new CustomEvent('webjs:navigate', { detail: { url: HERE } }));
    assert.ok(overlay(), 'no sync runs after uninstall');
    teardown();
  });
});
