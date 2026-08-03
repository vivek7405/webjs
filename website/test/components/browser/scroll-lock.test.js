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
 */

import { lockScroll, unlockScroll } from '#lib/scroll-lock.ts';

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
