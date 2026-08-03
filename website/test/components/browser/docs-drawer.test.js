/**
 * Browser tests for <docs-drawer>, the sidebar drawer shared by /docs and /ui.
 *
 * These used to TRANSCRIBE a delegated listener out of app/layout.ts and test
 * the copy, because the drawer had no component to import. It has one now, so
 * every case below drives the real element, and test/ssr/ui-gallery.test.ts no
 * longer needs to guard the transcription against drift.
 *
 * Every case here is a bug that shipped and was caught in review, which is why
 * each is pinned rather than left to manual checking:
 *   - dismissing via the backdrop left aria-expanded reading true forever
 *   - Escape did not close the drawer at all
 *   - clicking the drawer toggle left the header's mobile menu open, so both
 *     navigation surfaces were open at once
 *   - Escape with both open closed both and left focus on the wrong control
 */

import '#components/docs-drawer.ts';
import '#components/site-nav-menu.ts';

const assert = {
  ok: (v, msg) => { if (!v) throw new Error(msg || `Expected truthy, got ${v}`); },
  equal: (a, b, msg) => { if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); },
};

const tick = () => new Promise((r) => requestAnimationFrame(() => r()));

/**
 * The toggle is `hidden max-wide:inline-flex`, so it only paints below the
 * 900px drawer breakpoint. The runner window is wider than that, which would
 * leave the button `display: none`, and a display:none element cannot take
 * focus, so the focus-restoration case would fail for a reason that has
 * nothing to do with the behaviour under test. The drawer is only reachable
 * below the breakpoint in the first place, so forcing the button visible here
 * reproduces the real conditions rather than papering over them.
 */
function forceToggleVisible() {
  const style = document.createElement('style');
  style.id = 'drawer-test-viewport';
  style.textContent = '.docs-nav-toggle { display: inline-flex !important; }';
  document.head.appendChild(style);
  return () => style.remove();
}

suite('docs drawer', () => {
  let host;
  let drawer;
  let menu;
  let blockNav;
  let unforce;

  setup(async () => {
    unforce = forceToggleVisible();
    // The drawer closes on a real anchor click, so the fixture needs real
    // anchors. Left alone they navigate the runner page and abort the suite,
    // so navigation is cancelled in the CAPTURE phase: the default action never
    // happens, while the listeners under test still see the event.
    blockNav = (e) => { if (e.target.closest?.('a')) e.preventDefault(); };
    document.addEventListener('click', blockNav, true);

    host = document.createElement('div');
    // Both surfaces, because their Escape priority is a contract BETWEEN them.
    host.innerHTML = `
      <site-nav-menu label="Toggle navigation">
        <a href="/blog">Blog</a>
      </site-nav-menu>
      <docs-drawer label="Documentation" menu-label="Documentation menu" content-class="prose-docs">
        <div slot="nav"><a href="/docs/routing">Routing</a></div>
        <p>page content</p>
      </docs-drawer>
    `;
    document.body.appendChild(host);
    drawer = host.querySelector('docs-drawer');
    menu = host.querySelector('site-nav-menu');
    await drawer.updateComplete;
    await menu.updateComplete;
  });

  teardown(() => {
    document.removeEventListener('click', blockNav, true);
    host.remove();
    unforce();
  });

  const toggle = () => drawer.querySelector('.docs-nav-toggle');
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

  /** See site-nav-menu.test.js: the details toggle event is queued, not sync. */
  const clickSummary = async () => {
    const details = menu.querySelector('details');
    const landed = new Promise((r) => details.addEventListener('toggle', r, { once: true }));
    summary().click();
    await landed;
    await menu.updateComplete;
  };

  test('the toggle opens and closes, keeping aria-expanded in step', async () => {
    assert.equal(toggle().getAttribute('aria-expanded'), 'false');
    toggle().click();
    await drawer.updateComplete;
    assert.ok(drawer.open, 'opens');
    assert.equal(toggle().getAttribute('aria-expanded'), 'true');
    toggle().click();
    await drawer.updateComplete;
    assert.ok(!drawer.open, 'closes');
    assert.equal(toggle().getAttribute('aria-expanded'), 'false');
  });

  test('the open state reflects to the host, which is what the CSS selects on', async () => {
    // lib/ui/docs-shell.ts styles the drawer through docs-drawer[open]. If the
    // property stopped reflecting, every other case here would still pass and
    // the drawer would never visibly move.
    toggle().click();
    await drawer.updateComplete;
    assert.ok(drawer.hasAttribute('open'), 'the host carries the open attribute');
    toggle().click();
    await drawer.updateComplete;
    assert.ok(!drawer.hasAttribute('open'), 'and drops it on close');
  });

  test('the backdrop dismisses it without leaving aria-expanded stale', async () => {
    // The original bug: the backdrop cleared the body attribute directly, and
    // needs no navigation to be clicked, so nothing ever reset the button.
    toggle().click();
    await drawer.updateComplete;
    drawer.querySelector('.docs-backdrop').click();
    await drawer.updateComplete;
    assert.ok(!drawer.open, 'backdrop closes the drawer');
    assert.equal(toggle().getAttribute('aria-expanded'), 'false', 'and the button agrees');
  });

  test('a sidebar link dismisses it', async () => {
    toggle().click();
    await drawer.updateComplete;
    drawer.querySelector('[slot="nav"] a').click();
    await drawer.updateComplete;
    assert.ok(!drawer.open);
    assert.equal(toggle().getAttribute('aria-expanded'), 'false');
  });

  test('a click on nav whitespace does not dismiss it', async () => {
    // The delegated version asked t.closest('a'), so only links closed it.
    // Closing on any click inside the nav would be a regression a reader would
    // feel as the drawer snapping shut on a stray tap.
    toggle().click();
    await drawer.updateComplete;
    drawer.querySelector('.docs-nav').click();
    await drawer.updateComplete;
    assert.ok(drawer.open, 'still open after clicking the nav container itself');
  });

  test('opening the drawer closes the header menu', async () => {
    // The toggle is OUTSIDE the header menu, so it is an outside click and has
    // to dismiss it. Leaving it open put two navigation surfaces on screen at
    // once, from a click that was supposed to close one of them.
    await clickSummary();
    assert.ok(menu.open, 'menu opened');
    toggle().click();
    await Promise.all([menu.updateComplete, drawer.updateComplete]);
    assert.ok(!menu.open, 'the header menu closes');
    assert.ok(drawer.open, 'and the drawer still opens');
  });

  test('Escape closes the drawer, restores focus, and leaves the header menu alone', async () => {
    toggle().click();
    await drawer.updateComplete;
    // Open the menu directly rather than by clicking, since an outside click
    // would close the drawer and destroy the both-open state under test.
    menu.open = true;
    await menu.updateComplete;

    esc();
    await Promise.all([menu.updateComplete, drawer.updateComplete]);
    assert.ok(!drawer.open, 'the drawer closes');
    assert.equal(document.activeElement, toggle(), 'focus returns to the control that opened it');
    assert.ok(menu.open, 'the header menu is not also closed by the same Escape');

    esc();
    await menu.updateComplete;
    assert.ok(!menu.open, 'a second Escape closes that');
  });

  test('Escape with no drawer open falls through to the header menu', async () => {
    menu.open = true;
    await menu.updateComplete;
    esc();
    await menu.updateComplete;
    assert.ok(!menu.open, 'the header menu still responds to Escape');
  });

  test('a soft navigation closes it', async () => {
    // Not expressible before this was a component. /docs/a to /docs/b morphs
    // the docs layout, so this element SURVIVES the swap with its state, and
    // an open drawer would be left hanging over the page just navigated to.
    toggle().click();
    await drawer.updateComplete;
    document.dispatchEvent(new CustomEvent('webjs:navigate'));
    await drawer.updateComplete;
    assert.ok(!drawer.open, 'the drawer closes on webjs:navigate');
  });

  test('it stops answering Escape once removed from the document', async () => {
    // The delegated version could not do this: its listeners were registered
    // once by an inline script and lived for the tab. A component that failed
    // to remove them in disconnectedCallback would leak one per navigation and
    // keep a detached element reacting to document events forever.
    const detached = document.createElement('docs-drawer');
    detached.setAttribute('label', 'Detached');
    detached.setAttribute('menu-label', 'Detached menu');
    document.body.appendChild(detached);
    await detached.updateComplete;

    detached.open = true;
    await detached.updateComplete;
    detached.remove();
    await tick();

    // Re-open on the DETACHED element, then fire Escape at the document. A
    // live leaked listener would close it; a properly removed one leaves it be.
    detached.open = true;
    await detached.updateComplete;
    esc();
    await tick();
    assert.ok(detached.open, 'the removed element no longer responds to a document Escape');
  });
});
