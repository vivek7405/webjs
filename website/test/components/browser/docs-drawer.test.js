/**
 * Browser tests for the sidebar drawer shared by /docs and /ui.
 *
 * The drawer has no component of its own: it is markup from lib/utils/ui/docs-shell.ts
 * driven by one delegated listener in the ROOT layout (app/layout.ts), which is
 * inline script rather than a module. So these tests reproduce that listener's
 * contract against the same markup, which is what makes the interactions
 * assertable at all.
 *
 * Every case here is a bug that shipped and was caught in review, which is why
 * each is pinned rather than left to manual checking:
 *   - dismissing via the backdrop left aria-expanded reading true forever
 *   - Escape did not close the drawer at all
 *   - clicking the drawer toggle left the header's mobile menu open, so both
 *     navigation surfaces were open at once, even though the toggle is an
 *     outside click for that menu
 *   - Escape with both open closed both and left focus on the wrong control
 */

const assert = {
  ok: (v, msg) => { if (!v) throw new Error(msg || `Expected truthy, got ${v}`); },
  equal: (a, b, msg) => { if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); },
};

/**
 * The root layout's delegated listener, transcribed. Kept in step with
 * app/layout.ts by `docsDrawerContract` in test/ssr/ui-gallery.test.ts, which
 * asserts the real inline script still contains each branch this models.
 */
function installDrawerListeners(root) {
  const syncDocsNav = () => {
    const open = document.body.hasAttribute('data-docs-nav-open');
    const btn = root.querySelector('.docs-nav-toggle');
    if (btn) btn.setAttribute('aria-expanded', String(open));
    return open;
  };
  const closeDocsNav = () => { document.body.removeAttribute('data-docs-nav-open'); syncDocsNav(); };

  const onClick = (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    const a = t.closest('.mobile-menu a');
    if (a) {
      const d = a.closest('details');
      if (d) d.removeAttribute('open');
    } else {
      for (const m of root.querySelectorAll('.mobile-menu[open]')) if (!m.contains(t)) m.removeAttribute('open');
    }
    if (t.closest('.docs-nav-toggle')) {
      document.body.toggleAttribute('data-docs-nav-open');
      syncDocsNav();
      return;
    }
    if (t.closest('a') || t.closest('.docs-backdrop')) closeDocsNav();
  };
  const onKeydown = (e) => {
    if (e.key !== 'Escape') return;
    if (document.body.hasAttribute('data-docs-nav-open')) {
      closeDocsNav();
      root.querySelector('.docs-nav-toggle')?.focus();
      return;
    }
    for (const m of root.querySelectorAll('.mobile-menu[open]')) {
      m.removeAttribute('open');
      m.querySelector('summary')?.focus();
    }
  };
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKeydown);
  return () => {
    document.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKeydown);
  };
}

suite('docs drawer', () => {
  let root;
  let uninstall;
  let blockNav;

  setup(() => {
    // The drawer closes on a real anchor click, so the fixture needs real
    // anchors. Left alone they navigate the runner page and abort the suite,
    // so navigation is cancelled in the CAPTURE phase: the default action
    // never happens, while the document-level listener under test still sees
    // the event on the way back up.
    blockNav = (e) => { if (e.target.closest?.('a')) e.preventDefault(); };
    document.addEventListener('click', blockNav, true);

    root = document.createElement('div');
    root.innerHTML = `
      <details class="mobile-menu"><summary>Menu</summary><nav><a href="/blog">Blog</a></nav></details>
      <div class="docs-backdrop"></div>
      <aside id="docs-sidebar"><a href="/docs/routing">Routing</a></aside>
      <button class="docs-nav-toggle" aria-controls="docs-sidebar" aria-expanded="false">Menu</button>
    `;
    document.body.appendChild(root);
    uninstall = installDrawerListeners(root);
  });

  teardown(() => {
    uninstall();
    document.removeEventListener('click', blockNav, true);
    root.remove();
    document.body.removeAttribute('data-docs-nav-open');
  });

  const toggle = () => root.querySelector('.docs-nav-toggle');
  const menu = () => root.querySelector('.mobile-menu');
  const isOpen = () => document.body.hasAttribute('data-docs-nav-open');
  const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  test('the toggle opens and closes, keeping aria-expanded in step', () => {
    assert.equal(toggle().getAttribute('aria-expanded'), 'false');
    toggle().click();
    assert.ok(isOpen(), 'opens');
    assert.equal(toggle().getAttribute('aria-expanded'), 'true');
    toggle().click();
    assert.ok(!isOpen(), 'closes');
    assert.equal(toggle().getAttribute('aria-expanded'), 'false');
  });

  test('the backdrop dismisses it without leaving aria-expanded stale', () => {
    // The original bug: the backdrop cleared the body attribute directly, and
    // needs no navigation to be clicked, so nothing ever reset the button.
    toggle().click();
    root.querySelector('.docs-backdrop').click();
    assert.ok(!isOpen(), 'backdrop closes the drawer');
    assert.equal(toggle().getAttribute('aria-expanded'), 'false', 'and the button agrees');
  });

  test('a sidebar link dismisses it', () => {
    toggle().click();
    root.querySelector('#docs-sidebar a').click();
    assert.ok(!isOpen());
    assert.equal(toggle().getAttribute('aria-expanded'), 'false');
  });

  test('opening the drawer closes the header menu', () => {
    // The toggle is OUTSIDE the header menu, so it is an outside click and has
    // to dismiss it. Leaving it open put two navigation surfaces on screen at
    // once, from a click that was supposed to close one of them.
    menu().setAttribute('open', '');
    toggle().click();
    assert.ok(!menu().hasAttribute('open'), 'the header menu closes');
    assert.ok(isOpen(), 'and the drawer still opens');
  });

  test('Escape closes the drawer, restores focus, and leaves the header menu alone', () => {
    toggle().click();
    menu().setAttribute('open', '');
    esc();
    assert.ok(!isOpen(), 'the drawer closes');
    assert.equal(document.activeElement, toggle(), 'focus returns to the control that opened it');
    assert.ok(menu().hasAttribute('open'), 'the header menu is not also closed by the same Escape');
    esc();
    assert.ok(!menu().hasAttribute('open'), 'a second Escape closes that');
  });

  test('Escape with no drawer open falls through to the header menu', () => {
    menu().setAttribute('open', '');
    esc();
    assert.ok(!menu().hasAttribute('open'), 'the header menu still responds to Escape');
  });
});
