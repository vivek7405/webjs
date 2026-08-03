/**
 * Browser tests for the page scroll lock (#1147).
 *
 * Locking page scroll hides the scrollbar, and a classic scrollbar takes real
 * layout width, so hiding it WIDENS the viewport. In-flow content can be held
 * still by padding, but the site header is `position: fixed`, so it lays out
 * against the initial containing block and no padding can reach it: it slides
 * right by the scrollbar width. Measured on the live site at an 800x700
 * viewport, the header went 785px to 800px and the right-hand controls jumped
 * the full 15px.
 *
 * The old lock was a bare `body[data-docs-nav-open] { overflow: hidden }` rule
 * in the shell's stylesheet. A CSS-only lock cannot measure what it did, which
 * is exactly why it could not compensate.
 *
 * These only mean anything where the scrollbar has width, so
 * web-test-runner.config.js drops Playwright's `--hide-scrollbars`. Without
 * that the assertions pass vacuously.
 *
 * KNOWN COVERAGE GAP, stated rather than implied. The lock has two mechanisms.
 * Mechanism 1 reserves the scrollbar gutter, and mechanism 2 is the fallback for
 * engines that ignore `scrollbar-gutter` (WebKit today), which measures the
 * residual, pads the root, and publishes `--wj-scrollbar-compensation`. This
 * runner is Chromium only, where mechanism 1 works, so the measured residual is
 * always zero and mechanism 2 NEVER EXECUTES here. That is by design (the two
 * cannot double-compensate), which also means no test in this file can reach the
 * fallback, and deleting it would leave the suite green while the #1147 header
 * shift returned on the one engine the fallback exists for. Covering it needs a
 * WebKit runner, as the framework's root web-test-runner.config.js has.
 */

import { lockScroll, unlockScroll } from '#lib/scroll-lock.ts';
import '#components/docs-drawer.ts';

const assert = {
  ok: (v, msg) => { if (!v) throw new Error(msg || `Expected truthy, got ${v}`); },
  equal: (a, b, msg) => { if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); },
  close: (a, b, tol, msg) => {
    if (Math.abs(a - b) > tol) throw new Error(`${msg || 'values differ'}: ${a} vs ${b} (tolerance ${tol})`);
  },
};

suite('page scroll lock', () => {
  let fixture;
  let tall;

  setup(() => {
    fixture = document.createElement('div');
    fixture.innerHTML = `
      <style id="scroll-lock-fixture-style">
        .fixture-top { position: fixed; inset-inline: 0; top: 0; z-index: 20; background: #222; }
        /* The opt-in app/layout.ts already carries on .site-top > header. */
        .fixture-top > header { border-right: var(--wj-scrollbar-compensation, 0px) solid transparent; }
        .fixture-bar { max-width: 1100px; margin: 0 auto; display: flex; justify-content: space-between; }
      </style>
      <div class="fixture-top"><header><div class="fixture-bar">
        <span id="brand">brand</span><span id="controls">controls</span>
      </div></header></div>
      <div id="tall"></div>
    `;
    document.body.appendChild(fixture);
    tall = fixture.querySelector('#tall');
    // Force a real page scrollbar. Without one there is nothing to hide, so
    // nothing to compensate, and every assertion below is vacuous.
    tall.style.height = '4000px';
  });

  teardown(() => {
    // Make sure a failed assertion cannot leave the document locked for the
    // next suite. unlockScroll is refcounted, so drain it.
    for (let i = 0; i < 5; i++) unlockScroll();
    fixture.remove();
  });

  const hasScrollbar = () => window.innerWidth > document.documentElement.clientWidth;
  const rightEdge = (sel) => fixture.querySelector(sel).getBoundingClientRect().right;

  test('the fixture actually has a measurable scrollbar', () => {
    // A guard on the guard. If this engine reports no scrollbar width, the two
    // tests below cannot detect the regression and would pass no matter what,
    // so fail loudly here rather than report false confidence.
    assert.ok(hasScrollbar(), 'the runner must expose a layout-width scrollbar (--hide-scrollbars dropped?)');
  });

  test('locking does not move a fixed, right-aligned header control', async () => {
    // Measure a RIGHT-aligned element. The brand is left-aligned and does not
    // move even with the bug present, so measuring it reports a false pass.
    const before = rightEdge('#controls');
    lockScroll();
    const after = rightEdge('#controls');
    assert.close(after, before, 1, 'the right-hand control stays put through the lock');
    unlockScroll();
    assert.close(rightEdge('#controls'), before, 1, 'and is back where it started after the unlock');
  });

  test('locking does not shift in-flow content either', () => {
    const probe = document.createElement('div');
    probe.style.cssText = 'width: 100%; height: 10px;';
    tall.appendChild(probe);
    const before = probe.getBoundingClientRect().width;
    lockScroll();
    const after = probe.getBoundingClientRect().width;
    assert.close(after, before, 1, 'a full-width in-flow box keeps its width');
    unlockScroll();
  });

  test('the page really is locked while held', () => {
    // The compensation must not have quietly disabled the lock itself.
    lockScroll();
    assert.equal(getComputedStyle(document.body).overflow, 'hidden', 'body scroll is locked');
    unlockScroll();
    assert.ok(getComputedStyle(document.body).overflow !== 'hidden', 'and released');
  });

  test('nested locks release in any order, not just LIFO', () => {
    // The refcount is shared on globalThis with the UI kit's overlays for this
    // exact reason: disconnectedCallback fires in tree order and the
    // before-cache close runs in registration order, so an inner surface can
    // release AFTER an outer one. Two independent counters would leave <html>
    // padded for good.
    const style = document.documentElement.getAttribute('style') || '';
    lockScroll();
    lockScroll();
    unlockScroll();
    assert.equal(getComputedStyle(document.body).overflow, 'hidden', 'still locked while one holder remains');
    unlockScroll();
    assert.ok(getComputedStyle(document.body).overflow !== 'hidden', 'released once the last holder lets go');
    assert.equal(document.documentElement.getAttribute('style') || '', style, 'and <html> is restored exactly');
  });

  test('an unmatched unlock is a no-op, not a reset', () => {
    // Clamping to zero and restoring would replay a stale snapshot over
    // whatever the page owns now.
    const style = document.documentElement.getAttribute('style') || '';
    unlockScroll();
    assert.equal(document.documentElement.getAttribute('style') || '', style, '<html> untouched');
  });
});

/**
 * The drawer only locks BELOW its 900px breakpoint, since above it the sidebar
 * is an ordinary sticky column and locking the page would be a bug. The runner
 * window is wider than that and cannot be resized from inside the page, so the
 * media query is stubbed to report a match. That is the one seam here; the lock
 * itself is the real module, and the assertions are about real document state.
 */
/**
 * A `matchMedia` stub whose match state the test controls.
 *
 * Built by hand rather than by spreading a real MediaQueryList: `matches`,
 * `media`, and the listener methods are all prototype members, not own
 * enumerable properties, so `{ ...window.matchMedia(q) }` copies literally
 * nothing and yields `{}`. The listener methods are stubbed too, so a component
 * that starts observing the query does not throw against this.
 */
function stubMatchMedia(getMatches) {
  const real = window.matchMedia;
  const listeners = new Set();
  window.matchMedia = (q) => ({
    get matches() { return getMatches(); },
    media: q,
    onchange: null,
    addEventListener(type, fn) { if (type === 'change') listeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'change') listeners.delete(fn); },
    addListener(fn) { listeners.add(fn); },
    removeListener(fn) { listeners.delete(fn); },
    dispatchEvent() { return false; },
  });
  const restore = () => { window.matchMedia = real; listeners.clear(); };
  // Drives a viewport change the way the browser would, so a component that
  // OBSERVES the query is exercised rather than merely polled.
  restore.fireChange = () => { for (const fn of [...listeners]) fn({ matches: getMatches() }); };
  return restore;
}

/**
 * The drawer only locks BELOW its 900px breakpoint, since above it the sidebar
 * is an ordinary sticky column and locking the page would be a bug. The runner
 * window is wider than that and cannot be resized from inside the page, so the
 * media query is stubbed to report a match. That is the one seam here; the lock
 * itself is the real module, and the assertions are about real document state.
 */
suite('drawer scroll lock wiring', () => {
  let drawer;
  let restoreMatchMedia;

  setup(async () => {
    restoreMatchMedia = stubMatchMedia(() => true);

    drawer = document.createElement('docs-drawer');
    drawer.setAttribute('label', 'Documentation');
    drawer.setAttribute('menu-label', 'Documentation menu');
    document.body.appendChild(drawer);
    await drawer.updateComplete;
  });

  teardown(() => {
    restoreMatchMedia();
    drawer.remove();
    for (let i = 0; i < 5; i++) unlockScroll();
  });

  const locked = () => getComputedStyle(document.body).overflow === 'hidden';

  test('opening locks the page and closing releases it', async () => {
    assert.ok(!locked(), 'not locked to begin with');
    drawer.open = true;
    await drawer.updateComplete;
    assert.ok(locked(), 'opening the drawer locks page scroll');
    drawer.open = false;
    await drawer.updateComplete;
    assert.ok(!locked(), 'closing releases it');
  });

  test('being removed while open releases the lock', async () => {
    // A client-router navigation away from the docs tears the element out. If
    // disconnectedCallback did not release, the refcount would never return to
    // zero and the whole site would be left unscrollable with nothing on the
    // page able to fix it.
    drawer.open = true;
    await drawer.updateComplete;
    assert.ok(locked(), 'locked while open');
    drawer.remove();
    assert.ok(!locked(), 'removing the open drawer releases the page');
  });

  test('an update that does not change open does not touch the lock', async () => {
    // updated() fires for any changed property, so a label change must not
    // re-enter the lock and push the refcount up with no matching release.
    drawer.open = true;
    await drawer.updateComplete;
    drawer.label = 'Renamed';
    await drawer.updateComplete;
    drawer.open = false;
    await drawer.updateComplete;
    assert.ok(!locked(), 'one open and one close balance out regardless of other updates');
  });
});

/**
 * The viewport crossing the drawer breakpoint WHILE the drawer is open.
 *
 * Gating the release on the media query the way the take is gated strands the
 * lock forever: `body { overflow: hidden }` never comes off and the refcount,
 * which is shared with the UI kit's overlays, never returns to zero, so their
 * locks are pinned too. Nothing else in this file can see that, because the
 * other suites hold the query at a constant match state.
 */
suite('drawer scroll lock across the breakpoint', () => {
  let drawer;
  let narrow;
  let restoreMatchMedia;

  setup(async () => {
    narrow = true;
    restoreMatchMedia = stubMatchMedia(() => narrow);
    drawer = document.createElement('docs-drawer');
    drawer.setAttribute('label', 'Documentation');
    drawer.setAttribute('menu-label', 'Documentation menu');
    document.body.appendChild(drawer);
    await drawer.updateComplete;
  });

  teardown(() => {
    // Order matters: the drawer must disconnect while the stub is still
    // installed, or its unsubscribe lands on a stub that is no longer there and
    // a leaked media listener would go unnoticed.
    drawer.remove();
    restoreMatchMedia();
    for (let i = 0; i < 5; i++) unlockScroll();
    document.body.style.overflow = '';
  });

  const locked = () => getComputedStyle(document.body).overflow === 'hidden';
  const count = () => (globalThis.__webjsScrollLock || {}).count;

  test('a rotate to landscape while open still releases on close', async () => {
    drawer.open = true;
    await drawer.updateComplete;
    assert.ok(locked(), 'locked while open at a narrow viewport');

    narrow = false;            // the device rotates, or the window is widened
    drawer.open = false;       // any close path: link, Escape, backdrop, nav
    await drawer.updateComplete;

    assert.ok(!locked(), 'the page is scrollable again');
    assert.equal(count(), 0, 'and the shared refcount is back to zero');
  });

  test('close-then-disconnect after a rotate leaves nothing held', async () => {
    // The disconnect case that actually discriminates. Disconnecting while
    // still `open` was already released by the old code, so asserting that
    // proves nothing. Here the drawer is CLOSED after the rotate, which is
    // exactly where the old code stranded the lock: its release was skipped on
    // close, and its disconnect release was keyed on `open` so it did not fire
    // either.
    drawer.open = true;
    await drawer.updateComplete;
    narrow = false;
    drawer.open = false;
    await drawer.updateComplete;
    drawer.remove();
    await new Promise((r) => requestAnimationFrame(() => r()));

    assert.ok(!locked(), 'the page is scrollable again');
    assert.equal(count(), 0, 'and the shared refcount is back to zero');
  });

  test('a wide-viewport open that is never locked does not over-release on disconnect', async () => {
    // The other half of the hazard. The shared refcount is global, so a
    // disconnect that unlocks without ever having locked decrements somebody
    // else's hold. Simulated with a concurrent holder standing in for an open
    // <ui-dialog>.
    narrow = false;
    drawer.open = true;              // wide open: no lock is taken
    await drawer.updateComplete;

    lockScroll();                    // a dialog opens and takes the page
    assert.ok(locked(), 'the other holder has the page');

    drawer.remove();                 // the drawer goes away
    await new Promise((r) => requestAnimationFrame(() => r()));

    assert.ok(locked(), "the other holder's lock survives the drawer's teardown");
    assert.equal(count(), 1, 'refcount still reflects exactly the one real holder');
    unlockScroll();
  });

  test('rotating to landscape releases the lock with no other interaction', async () => {
    // The decisive case. A rotate changes no property, so `updated()` never
    // fires and only an observer on the query can notice. The drawer is not
    // dismissed by a resize, so it stays open as an ordinary sticky column, and
    // holding the page locked in that state is the same bug from the other side.
    drawer.open = true;
    await drawer.updateComplete;
    assert.ok(locked(), 'locked at a narrow viewport');

    narrow = false;
    restoreMatchMedia.fireChange();   // the browser reporting the rotate
    await drawer.updateComplete;

    assert.ok(!locked(), 'a wide viewport does not hold the page locked');
    assert.equal(count(), 0, 'refcount released');
  });

  test('rotating back to portrait retakes the lock', async () => {
    drawer.open = true;
    await drawer.updateComplete;
    narrow = false;
    restoreMatchMedia.fireChange();
    await drawer.updateComplete;
    assert.ok(!locked(), 'released while wide');

    narrow = true;
    restoreMatchMedia.fireChange();
    await drawer.updateComplete;
    assert.ok(locked(), 'an open drawer back at a narrow viewport locks again');
    assert.equal(count(), 1, 'exactly one hold, not a double-take');
  });

  test('re-entering the document with open still set re-takes the lock', async () => {
    // disconnectedCallback releases and clears the held flag, so a re-insert
    // (a DOM move, or any swap that re-inserts rather than morphs) comes back
    // rendering open at a narrow viewport. Without a re-sync on connect the
    // page would be scrollable underneath an open drawer.
    drawer.open = true;
    await drawer.updateComplete;
    assert.ok(locked(), 'locked before the move');

    drawer.remove();
    await new Promise((r) => requestAnimationFrame(() => r()));
    assert.ok(!locked(), 'released while detached');

    document.body.appendChild(drawer);
    await drawer.updateComplete;
    assert.ok(drawer.open, 'still rendering open');
    assert.ok(locked(), 'and the lock is re-taken on reconnect');
    assert.equal(count(), 1, 'exactly once');
  });

  test('it unsubscribes from the media query on disconnect', async () => {
    // The keydown leak has its own behavioural test; this is the same hazard on
    // the query listener, which teardown ordering previously hid.
    let live = 0;
    const realMM = window.matchMedia;
    window.matchMedia = (q) => ({
      get matches() { return narrow; },
      media: q,
      addEventListener() { live++; },
      removeEventListener() { live--; },
      addListener() {}, removeListener() {}, dispatchEvent() { return false; },
    });
    const probe = document.createElement('docs-drawer');
    document.body.appendChild(probe);
    await probe.updateComplete;
    assert.equal(live, 1, 'connecting subscribes to the query');
    probe.remove();
    await new Promise((r) => requestAnimationFrame(() => r()));
    assert.equal(live, 0, 'disconnecting unsubscribes');
    window.matchMedia = realMM;
  });

  test('opening above the breakpoint never takes the lock at all', async () => {
    // A guard on the surrounding behaviour rather than on this fix: the old
    // implementation early-returned on a non-matching query and passed this
    // too. Kept because the take is still conditional and a future change that
    // dropped the condition would make the sidebar lock the page on desktop.
    narrow = false;
    drawer.open = true;
    await drawer.updateComplete;
    assert.ok(!locked(), 'a wide-viewport open is an ordinary sidebar, not a modal');
    assert.equal(count(), 0, 'nothing taken, so nothing to strand');
  });
});
