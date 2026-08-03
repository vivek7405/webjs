/**
 * Browser tests for <site-nav-menu>, the header's mobile navigation menu.
 *
 * The component wraps a native <details> and adds only the three dismissals a
 * bare <details> has no opinion about: outside click, link click, and Escape.
 * So the cases below are mostly about NOT breaking the native half while
 * layering those on. Before this was a component the same behaviour lived in a
 * delegated listener in app/layout.ts with no harness at all, and the only test
 * of it was an SSR grep for the string 'Escape' in the served HTML.
 */

import '#components/site-nav-menu.ts';

const assert = {
  ok: (v, msg) => { if (!v) throw new Error(msg || `Expected truthy, got ${v}`); },
  equal: (a, b, msg) => { if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); },
};

suite('site nav menu', () => {
  let host;
  let menu;
  let outside;
  let blockNav;

  setup(async () => {
    blockNav = (e) => { if (e.target.closest?.('a')) e.preventDefault(); };
    document.addEventListener('click', blockNav, true);

    host = document.createElement('div');
    host.innerHTML = `
      <site-nav-menu label="Toggle navigation">
        <a href="/blog">Blog</a>
        <a href="/compare">Compare</a>
      </site-nav-menu>
      <button id="outside">elsewhere</button>
    `;
    document.body.appendChild(host);
    menu = host.querySelector('site-nav-menu');
    outside = host.querySelector('#outside');
    await menu.updateComplete;
  });

  teardown(() => {
    document.removeEventListener('click', blockNav, true);
    host.remove();
  });

  const details = () => menu.querySelector('details');
  const summary = () => menu.querySelector('summary');
  /**
   * Dispatch Escape the way a real key press arrives: from an element INSIDE
   * the document, cancelable.
   *
   * Both details matter. Dispatching on `document` itself makes document the
   * TARGET, and at the target phase listeners run in registration order with
   * the capture flag ignored, which silently collapses the capture-beats-bubble
   * priority the two components rely on. And `preventDefault()` on a
   * non-cancelable event is a no-op, so the drawer could not signal that it had
   * consumed the press and both surfaces would close.
   */
  const esc = () => document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );

  /**
   * Click the summary and wait for the state to actually land.
   *
   * The details `toggle` event is queued rather than dispatched synchronously,
   * so the component learns about a native open one task later. Awaiting only
   * updateComplete (a microtask) races that and reads the pre-click state.
   */
  const clickSummary = async () => {
    const landed = new Promise((r) => details().addEventListener('toggle', r, { once: true }));
    summary().click();
    await landed;
    await menu.updateComplete;
  };

  test('the summary toggles it natively, and the component absorbs that', async () => {
    // The native <details> is what makes this work with JavaScript off, so the
    // component must not intercept the summary. It listens for the resulting
    // toggle event instead. If it ever started calling preventDefault here,
    // the no-JS path would break silently while this test still passed unless
    // it checks BOTH the element and the component state.
    assert.ok(!details().open, 'starts closed');
    await clickSummary();
    assert.ok(details().open, 'the details really opened');
    assert.equal(menu.open, true, 'and the component knows');

    await clickSummary();
    assert.ok(!details().open, 'the details really closed');
    assert.equal(menu.open, false, 'and the component knows');
  });

  test('the open state reflects to the host', async () => {
    await clickSummary();
    assert.ok(menu.hasAttribute('open'), 'host carries open');
    await clickSummary();
    assert.ok(!menu.hasAttribute('open'), 'and drops it');
  });

  test('a click outside dismisses it', async () => {
    await clickSummary();
    outside.click();
    await menu.updateComplete;
    assert.ok(!menu.open, 'clicking elsewhere closes the menu');
    assert.ok(!details().open, 'and the details agrees');
  });

  test('a click on one of its links dismisses it', async () => {
    await clickSummary();
    menu.querySelector('a').click();
    await menu.updateComplete;
    assert.ok(!menu.open, 'a link navigates, so the menu should not stay open over the new page');
  });

  test('Escape dismisses it and restores focus to the summary', async () => {
    await clickSummary();
    esc();
    await menu.updateComplete;
    assert.ok(!menu.open, 'Escape closes it');
    assert.equal(document.activeElement, summary(), 'focus returns to the control that opened it');
  });

  test('an Escape another surface already consumed is left alone', async () => {
    // <docs-drawer> listens in the capture phase and calls preventDefault when
    // it takes an Escape, which is how one press does not close both surfaces.
    // This is the other half of that contract, tested here without the drawer
    // so a change to either component fails on its own terms.
    await clickSummary();

    const consumed = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.addEventListener('keydown', (e) => e.preventDefault(), { capture: true, once: true });
    document.dispatchEvent(consumed);
    await menu.updateComplete;

    assert.ok(menu.open, 'the menu ignores an Escape that was already handled');
  });

  test('it stops answering document events once removed', async () => {
    const detached = document.createElement('site-nav-menu');
    document.body.appendChild(detached);
    await detached.updateComplete;
    detached.open = true;
    await detached.updateComplete;

    detached.remove();
    await new Promise((r) => requestAnimationFrame(() => r()));

    detached.open = true;
    await detached.updateComplete;
    esc();
    await new Promise((r) => requestAnimationFrame(() => r()));
    assert.ok(detached.open, 'a removed menu no longer responds to a document Escape');
  });
});
