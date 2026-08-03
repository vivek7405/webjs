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
   * `cancelable: true` is the load-bearing half. `preventDefault()` on a
   * non-cancelable event is a silent no-op, so `defaultPrevented` stays false,
   * the drawer cannot signal that it consumed the press, and both surfaces
   * close. Dispatching from inside the tree rather than at `document` is for
   * realism only: the capture-beats-bubble priority holds at the target too,
   * because the dispatch algorithm honours the capture flag on both traversals
   * of the propagation path.
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

  test('it subscribes to all three navigation signals with a stable handler, and unsubscribes', async () => {
    // A link click closes it via the outside/link path, but a programmatic
    // navigate(), and Back or Forward, produce no click at all. This element
    // lives in the ROOT layout, so it survives every client-router swap and
    // would otherwise stay open over the page it lands on.
    //
    // THREE signals, not one, and popstate is NOT redundant with
    // webjs:navigate. A back/forward that hits the snapshot cache applies the
    // swap and returns before webjs:navigate is ever dispatched, so on that
    // path popstate is the only timely signal. webjs:before-cache closes the
    // surface before the snapshot is serialized, or a forward restore brings
    // it back open.
    //
    // The recorded FUNCTION is compared, not just the event name. Removing a
    // different function object than the one added is the classic listener
    // leak, and a name-only assertion passes straight through it.
    const added = [];
    const removed = [];
    const addedFns = {};
    const removedFns = {};
    const realWinAdd = window.addEventListener.bind(window);
    const realWinRemove = window.removeEventListener.bind(window);
    const realDocAdd = document.addEventListener.bind(document);
    const realDocRemove = document.removeEventListener.bind(document);
    window.addEventListener = (t, f, o) => { added.push('window:' + t); addedFns['window:' + t] = f; return realWinAdd(t, f, o); };
    window.removeEventListener = (t, f, o) => { removed.push('window:' + t); removedFns['window:' + t] = f; return realWinRemove(t, f, o); };
    document.addEventListener = (t, f, o) => { added.push('document:' + t); addedFns['document:' + t] = f; return realDocAdd(t, f, o); };
    document.removeEventListener = (t, f, o) => { removed.push('document:' + t); removedFns['document:' + t] = f; return realDocRemove(t, f, o); };

    try {
      const probe = document.createElement('site-nav-menu');
      document.body.appendChild(probe);
      await probe.updateComplete;
      probe.remove();
    } finally {
      // Restored in a finally: a throw here would otherwise leave window and
      // document patched for every remaining test in this file.
      window.addEventListener = realWinAdd;
      window.removeEventListener = realWinRemove;
      document.addEventListener = realDocAdd;
      document.removeEventListener = realDocRemove;
    }

    for (const sig of ['document:webjs:navigate', 'window:popstate', 'document:webjs:before-cache']) {
      assert.ok(added.includes(sig), `connecting subscribes to ${sig}`);
      assert.ok(removed.includes(sig), `disconnecting unsubscribes from ${sig}`);
      assert.ok(addedFns[sig] && addedFns[sig] === removedFns[sig], `${sig} removes the SAME function object, so nothing leaks`);
    }
  });

  test('a programmatic soft navigation closes it', async () => {
    await clickSummary();
    document.dispatchEvent(new CustomEvent('webjs:navigate'));
    await menu.updateComplete;
    assert.ok(!menu.open, 'webjs:navigate closes the menu');
  });

  test('a popstate closes it', async () => {
    // A cached back/forward applies the swap and returns before webjs:navigate
    // is dispatched, so popstate is the only timely signal on that path.
    await clickSummary();
    window.dispatchEvent(new PopStateEvent('popstate'));
    await menu.updateComplete;
    assert.ok(!menu.open, 'popstate closes the menu');
  });

  test('before-cache leaves NO open state in the serialized snapshot', async () => {
    // The router dispatches webjs:before-cache synchronously and reads
    // documentElement.outerHTML on the very next statement, so a handler's
    // mutation only counts if it lands SYNCHRONOUSLY. Setting the reactive
    // property reflects the host attribute at once, but the <details ?open>
    // binding is committed on the next render, one microtask later. The details
    // element is what actually shows the panel and drives the icon swap, so a
    // handler that only sets the property serializes an OPEN menu and a forward
    // restore brings it back.
    await clickSummary();
    assert.ok(menu.querySelector('details').open, 'open before the snapshot');

    document.dispatchEvent(new CustomEvent('webjs:before-cache', { detail: { url: location.href } }));
    // Read exactly the way snapshotCurrent does: no await in between.
    const serialized = menu.outerHTML;

    assert.ok(!/<details[^>]*\sopen/.test(serialized), 'the serialized details is not open');
    assert.ok(!/<site-nav-menu[^>]*\sopen/.test(serialized), 'and neither is the host');
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
