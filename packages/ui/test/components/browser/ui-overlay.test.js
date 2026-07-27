/**
 * Browser tests for overlay Tier-2 @webjsdev/ui custom elements: dialog,
 * popover, tooltip, dropdown-menu. Runs in real Chromium via WTR + Playwright.
 *
 * API conventions across all four (mirror what they actually implement, not
 * what shadcn's React API looks like):
 *   - `el.isOpen`: boolean getter (popover, dialog, tooltip). For dropdown-
 *     menu and collapsible the state lives on the `open` HTML attribute, so
 *     `el.hasAttribute('open')` is the canonical read.
 *   - `el.show()` / `el.hide()` / `el.toggle()`: programmatic control.
 *   - Event `ui-open-change` with `detail: { open }`: fires from dialog,
 *     popover, and collapsible. Tooltip and dropdown-menu do NOT emit this
 *     today, so tests for those use post-action state assertions instead.
 *   - Content is rendered INLINE as `:scope > ui-X-content` (not portaled to
 *     document.body). Visibility is controlled by CSS:
 *     `ui-X:not([open]) ui-X-content { display: none !important; }`. So
 *     queries always go through the host element / root, not document.body.
 */
import { html } from '../../../../core/src/html.js';
import { render } from '../../../../core/src/render-client.js';

import { assert } from '../../../../../test/browser-assert.js';

const COMPONENTS_DIR = '/packages/ui/packages/registry/components';

const tick = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

async function mount(tpl) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(tpl, root);
  await tick();
  return root;
}

suite('ui-dialog', () => {
  suiteSetup(async () => {
    await import(`${COMPONENTS_DIR}/dialog.ts`);
  });

  test('trigger click opens dialog', async () => {
    const root = await mount(html`
      <ui-dialog>
        <ui-dialog-trigger><button>Open</button></ui-dialog-trigger>
        <ui-dialog-content>
          <ui-dialog-title>T</ui-dialog-title>
          <ui-dialog-description>D</ui-dialog-description>
        </ui-dialog-content>
      </ui-dialog>
    `);
    // Click the inner wrapper that <ui-dialog-trigger> renders (where
    // @click is bound). The user-authored <button> is projected through
    // the slot inside it; clicking either bubbles into the @click
    // handler on the wrapper.
    root.querySelector('ui-dialog-trigger [data-slot="dialog-trigger"]').click();
    await tick();
    const dialog = root.querySelector('ui-dialog');
    assert.equal(dialog.isOpen, true, 'dialog.isOpen=true after trigger click');
    const inner = dialog.querySelector('[data-slot="dialog"]');
    assert.equal(inner.getAttribute('data-state'), 'open');
    dialog.hide();
    root.remove();
  });

  test('native close event on the inner <dialog> closes the host (escape path)', async () => {
    // The WebComponent dialog wires the host's open state to the native
    // <dialog> element's `close` event. In a real browser, pressing Escape
    // while the modal is open fires `cancel` then `close` on the native
    // dialog. We simulate that final close (the UA-internal step) by
    // dispatching a synthetic close event on the native dialog element.
    const root = await mount(html`
      <ui-dialog>
        <ui-dialog-trigger><button>Open</button></ui-dialog-trigger>
        <ui-dialog-content><ui-dialog-title>T</ui-dialog-title></ui-dialog-content>
      </ui-dialog>
    `);
    const dialog = root.querySelector('ui-dialog');
    dialog.show();
    await tick();
    const nativeDialog = dialog.querySelector('dialog[data-slot="dialog-native"]');
    nativeDialog.dispatchEvent(new Event('close'));
    await tick();
    assert.equal(dialog.isOpen, false, 'host closes when native dialog fires close');
    root.remove();
  });

  test('fires ui-open-change event when toggling', async () => {
    const root = await mount(html`
      <ui-dialog>
        <ui-dialog-trigger><button>Open</button></ui-dialog-trigger>
        <ui-dialog-content><ui-dialog-title>T</ui-dialog-title></ui-dialog-content>
      </ui-dialog>
    `);
    const dialog = root.querySelector('ui-dialog');
    let detail = null;
    dialog.addEventListener('ui-open-change', (e) => { detail = e.detail; });
    dialog.show();
    await tick();
    assert.equal(detail?.open, true);
    dialog.hide();
    await tick();
    assert.equal(detail?.open, false);
    root.remove();
  });

  test('dialog-content has data-state="closed" when host is not open', async () => {
    const root = await mount(html`
      <ui-dialog>
        <ui-dialog-trigger><button>O</button></ui-dialog-trigger>
        <ui-dialog-content><ui-dialog-title>T</ui-dialog-title></ui-dialog-content>
      </ui-dialog>
    `);
    await tick();
    const dialog = root.querySelector('ui-dialog');
    // data-state lives on the inner [role="dialog"] element rendered
    // inside the <ui-dialog-content> host.
    const contentInner = dialog.querySelector('ui-dialog-content [role="dialog"]');
    assert.ok(contentInner, 'inner content element exists in DOM');
    assert.equal(contentInner.getAttribute('data-state'), 'closed');
    assert.equal(getComputedStyle(dialog.querySelector('ui-dialog-content')).display, 'none', 'host hidden when closed');
    root.remove();
  });
});

// --------------------------------------------------------------------------
// Scroll lock layout (#1144)
//
// Locking body scroll hides the page scrollbar, which widens the viewport by
// the scrollbar's width. Padding the body holds in-flow content still, but a
// `position: fixed` header lays out against the initial containing block, so
// it used to slide right by half the scrollbar width.
//
// These assertions are only meaningful where the scrollbar takes LAYOUT WIDTH.
// Headless browsers default to overlay scrollbars (zero width), which makes the
// whole scenario inert, so `buildFixedHeaderPage()` styles the root scrollbar to
// force a classic one and each test skips EXPLICITLY when the engine still
// reports zero. A silent pass under overlay scrollbars would prove nothing.
// --------------------------------------------------------------------------

const scrollbarWidth = () => window.innerWidth - document.documentElement.clientWidth;

/**
 * Build the reproduction: a page that overflows, a fixed full-width header with
 * a centred inner box (the thing that visibly jumped), and a centred in-flow
 * box (which must not move either). The header opts into the published
 * compensation, which is a no-op on engines that hold the viewport width via
 * the reserved gutter.
 *
 * Centres are what matter here. The body's own border box legitimately widens
 * when the compensation path runs (padding holds the CONTENT still, not the
 * border box), so measuring the body would report a false shift.
 */
async function buildFixedHeaderPage() {
  const style = document.createElement('style');
  style.textContent =
    'html::-webkit-scrollbar { width: 15px; background: #eee; }' +
    'html::-webkit-scrollbar-thumb { background: #888; }';
  document.head.appendChild(style);

  const spacer = document.createElement('div');
  spacer.style.height = '300vh';
  document.body.appendChild(spacer);

  const flow = document.createElement('div');
  flow.style.cssText = 'max-width:400px;margin:0 auto;height:20px;';
  document.body.appendChild(flow);

  const header = document.createElement('div');
  header.style.cssText =
    'position:fixed;top:0;left:0;right:0;height:40px;' +
    'padding-right:var(--wj-scrollbar-compensation, 0px);';
  const inner = document.createElement('div');
  inner.style.cssText = 'max-width:400px;margin:0 auto;height:40px;';
  header.appendChild(inner);
  document.body.appendChild(header);

  // WebKit only materialises a custom root scrollbar after a layout pass, so
  // the precondition check has to wait or it under-reports the width.
  await tick();

  const mounted = [];

  return {
    header,
    inner,
    flow,
    /** Track a mounted root so teardown can unmount it even after a failure. */
    track(root) {
      mounted.push(root);
      return root;
    },
    teardown() {
      // Close every dialog FIRST. An assertion that throws mid-test would
      // otherwise leave the lock engaged, and the next test would see a page
      // with no scrollbar and skip itself instead of running.
      for (const root of mounted) {
        for (const el of root.querySelectorAll('ui-dialog, ui-alert-dialog')) el.hide?.();
        root.remove();
      }
      style.remove();
      spacer.remove();
      flow.remove();
      header.remove();
    },
  };
}

const centreOf = (el) => Math.round(el.getBoundingClientRect().left * 100) / 100;

suite('ui-dialog scroll lock layout', () => {
  suiteSetup(async () => {
    await import(`${COMPONENTS_DIR}/dialog.ts`);
  });

  test('opening a dialog leaves a position:fixed header exactly where it was', async function () {
    const page = await buildFixedHeaderPage();
    try {
      if (scrollbarWidth() === 0) this.skip();

      const root = page.track(await mount(html`
        <ui-dialog>
          <ui-dialog-content><ui-dialog-title>T</ui-dialog-title></ui-dialog-content>
        </ui-dialog>
      `));
      const dialog = root.querySelector('ui-dialog');

      const fixedBefore = centreOf(page.inner);
      const flowBefore = centreOf(page.flow);

      dialog.show();
      await tick();

      assert.equal(centreOf(page.inner), fixedBefore, 'fixed header content does not move on open');
      assert.equal(centreOf(page.flow), flowBefore, 'in-flow content does not move on open');

      dialog.hide();
      await tick();
      assert.equal(centreOf(page.inner), fixedBefore, 'fixed header content does not move on close');
    } finally {
      page.teardown();
    }
  });

  test('the lock is released cleanly, leaving no compensation behind', async function () {
    const page = await buildFixedHeaderPage();
    try {
      if (scrollbarWidth() === 0) this.skip();

      const root = page.track(await mount(html`
        <ui-dialog>
          <ui-dialog-content><ui-dialog-title>T</ui-dialog-title></ui-dialog-content>
        </ui-dialog>
      `));
      const dialog = root.querySelector('ui-dialog');

      dialog.show();
      await tick();
      dialog.hide();
      await tick();

      assert.equal(document.body.style.overflow, '', 'body overflow restored');
      assert.equal(document.body.style.paddingRight, '', 'body padding restored');
      assert.equal(document.documentElement.style.scrollbarGutter, '', 'scrollbar gutter restored');
      assert.equal(
        document.documentElement.style.getPropertyValue('--wj-scrollbar-compensation'),
        '',
        'compensation custom property cleared',
      );
    } finally {
      page.teardown();
    }
  });

  test('nested dialogs release the compensation only on the outermost close', async function () {
    const page = await buildFixedHeaderPage();
    try {
      if (scrollbarWidth() === 0) this.skip();

      const root = page.track(await mount(html`
        <ui-dialog id="outer">
          <ui-dialog-content><ui-dialog-title>Outer</ui-dialog-title></ui-dialog-content>
        </ui-dialog>
        <ui-dialog id="inner">
          <ui-dialog-content><ui-dialog-title>Inner</ui-dialog-title></ui-dialog-content>
        </ui-dialog>
      `));
      const outer = root.querySelector('#outer');
      const nested = root.querySelector('#inner');

      const fixedBefore = centreOf(page.inner);

      outer.show();
      await tick();
      nested.show();
      await tick();
      assert.equal(centreOf(page.inner), fixedBefore, 'fixed header held with both dialogs open');

      nested.hide();
      await tick();
      assert.equal(document.body.style.overflow, 'hidden', 'still locked while the outer dialog is open');
      assert.equal(centreOf(page.inner), fixedBefore, 'fixed header still held after the nested close');

      outer.hide();
      await tick();
      assert.equal(document.body.style.overflow, '', 'released on the outermost close');
      assert.equal(
        document.documentElement.style.getPropertyValue('--wj-scrollbar-compensation'),
        '',
        'compensation released on the outermost close',
      );
      assert.equal(centreOf(page.inner), fixedBefore, 'fixed header back where it started');
    } finally {
      page.teardown();
    }
  });
});

suite('ui-tooltip', () => {
  suiteSetup(async () => {
    await import(`${COMPONENTS_DIR}/tooltip.ts`);
  });

  // The Lit-idiomatic refactor renders each compound subcomponent's
  // ARIA role + popover element inside its slot output. The host stays
  // a thin wrapper; data-state, role, popover, class all live on the
  // inner rendered element. Tests target the inner element accordingly.

  test('tooltip is closed initially', async () => {
    const root = await mount(html`
      <ui-tooltip>
        <ui-tooltip-trigger><button>Hover</button></ui-tooltip-trigger>
        <ui-tooltip-content>Tip</ui-tooltip-content>
      </ui-tooltip>
    `);
    await tick();
    const tip = root.querySelector('ui-tooltip');
    assert.equal(tip.isOpen, false);
    const inner = tip.querySelector('[data-slot="tooltip"]');
    assert.equal(inner.getAttribute('data-state'), 'closed');
    root.remove();
  });

  test('show() opens the tooltip and reflects via data-state', async () => {
    // `delay-duration="0"` skips the default 700ms open delay so the
    // setTimeout fires effectively immediately.
    const root = await mount(html`
      <ui-tooltip delay-duration="0">
        <ui-tooltip-trigger><button>Hover</button></ui-tooltip-trigger>
        <ui-tooltip-content>Tip</ui-tooltip-content>
      </ui-tooltip>
    `);
    const tip = root.querySelector('ui-tooltip');
    tip.show();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(tip.isOpen, true);
    const inner = tip.querySelector('[data-slot="tooltip"]');
    assert.equal(inner.getAttribute('data-state'), 'open');
    const contentPanel = tip.querySelector('ui-tooltip-content [role="tooltip"]');
    assert.ok(contentPanel, 'tooltip content element rendered');
    root.remove();
  });

  test('mouseleave on trigger closes after open', async () => {
    const root = await mount(html`
      <ui-tooltip>
        <ui-tooltip-trigger><button>Hover</button></ui-tooltip-trigger>
        <ui-tooltip-content>Tip</ui-tooltip-content>
      </ui-tooltip>
    `);
    const tip = root.querySelector('ui-tooltip');
    tip.show();
    await tick();
    // Dispatch on the inner wrapper since that is where @mouseleave is bound.
    const triggerWrapper = root.querySelector('ui-tooltip-trigger [data-slot="tooltip-trigger"]');
    triggerWrapper.dispatchEvent(new Event('mouseleave', { bubbles: true }));
    await tick();
    assert.equal(tip.isOpen, false);
    root.remove();
  });

  test('content has tooltip-content styling classes', async () => {
    const root = await mount(html`
      <ui-tooltip>
        <ui-tooltip-trigger><button>Hover</button></ui-tooltip-trigger>
        <ui-tooltip-content>TipText</ui-tooltip-content>
      </ui-tooltip>
    `);
    const tip = root.querySelector('ui-tooltip');
    tip.show();
    await tick();
    const panel = tip.querySelector('ui-tooltip-content [popover]');
    assert.ok(panel);
    assert.match(panel.className, /bg-foreground/);
    tip.hide();
    root.remove();
  });
});

suite('ui-dropdown-menu', () => {
  suiteSetup(async () => {
    await import(`${COMPONENTS_DIR}/dropdown-menu.ts`);
  });

  test('show() opens content and content has role="menu"', async () => {
    const root = await mount(html`
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger><button>Open</button></ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content>
          <ui-dropdown-menu-item>One</ui-dropdown-menu-item>
          <ui-dropdown-menu-item>Two</ui-dropdown-menu-item>
        </ui-dropdown-menu-content>
      </ui-dropdown-menu>
    `);
    const dm = root.querySelector('ui-dropdown-menu');
    dm.show();
    await tick();
    assert.ok(dm.hasAttribute('open'));
    const contentInner = dm.querySelector('ui-dropdown-menu-content [role="menu"]');
    assert.ok(contentInner, 'inner role="menu" rendered');
    dm.hide();
    root.remove();
  });

  test('ArrowDown cycles focus across items', async () => {
    const root = await mount(html`
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger><button>Open</button></ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content>
          <ui-dropdown-menu-item>One</ui-dropdown-menu-item>
          <ui-dropdown-menu-item>Two</ui-dropdown-menu-item>
          <ui-dropdown-menu-item>Three</ui-dropdown-menu-item>
        </ui-dropdown-menu-content>
      </ui-dropdown-menu>
    `);
    const dm = root.querySelector('ui-dropdown-menu');
    dm.show();
    await tick();
    // The focusable target is now the inner [role=menuitem] rendered
    // inside each <ui-dropdown-menu-item> host.
    const items = root.querySelectorAll('ui-dropdown-menu-item [role="menuitem"]');
    assert.ok(items.length >= 2);
    items[0].focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await tick();
    assert.equal(document.activeElement, items[1]);
    dm.hide();
    root.remove();
  });

  test('focus highlights the item (signal-backed data-highlighted), blur clears it', async () => {
    const root = await mount(html`
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger><button>Open</button></ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content>
          <ui-dropdown-menu-item>One</ui-dropdown-menu-item>
          <ui-dropdown-menu-item>Two</ui-dropdown-menu-item>
        </ui-dropdown-menu-content>
      </ui-dropdown-menu>
    `);
    const dm = root.querySelector('ui-dropdown-menu');
    dm.show();
    await tick();
    const items = root.querySelectorAll('ui-dropdown-menu-item [role="menuitem"]');
    assert.ok(items.length >= 2);
    // Highlight rides a local signal -> ?data-highlighted re-render, so it
    // applies after the microtask tick, not synchronously on focus.
    items[0].focus();
    await tick();
    assert.equal(items[0].hasAttribute('data-highlighted'), true, 'focused item is highlighted');
    assert.equal(items[1].hasAttribute('data-highlighted'), false, 'unfocused item is not highlighted');
    // Moving focus to the next item blurs the first and highlights the second.
    items[1].focus();
    await tick();
    assert.equal(items[0].hasAttribute('data-highlighted'), false, 'blurred item clears highlight');
    assert.equal(items[1].hasAttribute('data-highlighted'), true, 'newly focused item is highlighted');
    dm.hide();
    root.remove();
  });

  test('escape closes the dropdown', async () => {
    const root = await mount(html`
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger><button>Open</button></ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content>
          <ui-dropdown-menu-item>One</ui-dropdown-menu-item>
        </ui-dropdown-menu-content>
      </ui-dropdown-menu>
    `);
    const dm = root.querySelector('ui-dropdown-menu');
    dm.show();
    await tick();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();
    assert.equal(dm.hasAttribute('open'), false);
    root.remove();
  });

  test('clicking an item closes the menu', async () => {
    const root = await mount(html`
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger><button>Open</button></ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content>
          <ui-dropdown-menu-item>One</ui-dropdown-menu-item>
        </ui-dropdown-menu-content>
      </ui-dropdown-menu>
    `);
    const dm = root.querySelector('ui-dropdown-menu');
    dm.show();
    await tick();
    root.querySelector('ui-dropdown-menu-item [role="menuitem"]').click();
    await tick();
    assert.equal(dm.hasAttribute('open'), false);
    root.remove();
  });

  test('trigger click toggles open', async () => {
    const root = await mount(html`
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger><button>Open</button></ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content>
          <ui-dropdown-menu-item>One</ui-dropdown-menu-item>
        </ui-dropdown-menu-content>
      </ui-dropdown-menu>
    `);
    const dm = root.querySelector('ui-dropdown-menu');
    const trigger = root.querySelector('ui-dropdown-menu-trigger [data-slot="dropdown-menu-trigger"]');
    trigger.click();
    await tick();
    assert.equal(dm.hasAttribute('open'), true);
    trigger.click();
    await tick();
    assert.equal(dm.hasAttribute('open'), false);
    root.remove();
  });
});

suite('ui-alert-dialog', () => {
  suiteSetup(async () => {
    await import(`${COMPONENTS_DIR}/alert-dialog.ts`);
  });

  // alert-dialog carries its own copy of the scroll lock (deliberately not
  // imported from dialog.ts, so `webjs ui add alert-dialog` stays self
  // contained), so the #1144 guarantee is asserted against it separately. This
  // is the exact case reported on webjs.dev/ui: the Delete-account demo moved
  // the site's fixed navbar.
  test('opening an alert-dialog leaves a position:fixed header where it was', async function () {
    const page = await buildFixedHeaderPage();
    try {
      if (scrollbarWidth() === 0) this.skip();

      const root = page.track(await mount(html`
        <ui-alert-dialog>
          <ui-alert-dialog-content><ui-alert-dialog-title>T</ui-alert-dialog-title></ui-alert-dialog-content>
        </ui-alert-dialog>
      `));
      const dialog = root.querySelector('ui-alert-dialog');

      const fixedBefore = centreOf(page.inner);
      const flowBefore = centreOf(page.flow);

      dialog.show();
      await tick();
      assert.equal(centreOf(page.inner), fixedBefore, 'fixed header content does not move on open');
      assert.equal(centreOf(page.flow), flowBefore, 'in-flow content does not move on open');

      dialog.hide();
      await tick();
      assert.equal(centreOf(page.inner), fixedBefore, 'fixed header content does not move on close');
      assert.equal(
        document.documentElement.style.getPropertyValue('--wj-scrollbar-compensation'),
        '',
        'compensation released on close',
      );
    } finally {
      page.teardown();
    }
  });

  test('trigger click opens via show(); content has role="alertdialog"', async () => {
    const root = await mount(html`
      <ui-alert-dialog>
        <ui-alert-dialog-trigger><button>Delete</button></ui-alert-dialog-trigger>
        <ui-alert-dialog-content>
          <ui-alert-dialog-title>Are you sure?</ui-alert-dialog-title>
          <ui-alert-dialog-cancel><button>Cancel</button></ui-alert-dialog-cancel>
          <ui-alert-dialog-action><button>Delete</button></ui-alert-dialog-action>
        </ui-alert-dialog-content>
      </ui-alert-dialog>
    `);
    const ad = root.querySelector('ui-alert-dialog');
    root.querySelector('ui-alert-dialog-trigger [data-slot="alert-dialog-trigger"]').click();
    await tick();
    assert.ok(ad.hasAttribute('open'), 'host gets [open] attribute');
    const inner = ad.querySelector('ui-alert-dialog-content [role="alertdialog"]');
    assert.ok(inner, 'inner alertdialog rendered');
    // showModal() reaches the own-rendered native <dialog> through the
    // ref()/createRef() handle, so the native element is actually open.
    const native = ad.querySelector('dialog[data-slot="alert-dialog-native"]');
    assert.ok(native && native.open, 'ref()-driven showModal opened the native <dialog>');
    ad.hide();
    root.remove();
  });

  test('cancel trigger closes the dialog (no escape close, unlike ui-dialog)', async () => {
    const root = await mount(html`
      <ui-alert-dialog>
        <ui-alert-dialog-trigger><button>Delete</button></ui-alert-dialog-trigger>
        <ui-alert-dialog-content>
          <ui-alert-dialog-title>T</ui-alert-dialog-title>
          <ui-alert-dialog-cancel><button>Cancel</button></ui-alert-dialog-cancel>
        </ui-alert-dialog-content>
      </ui-alert-dialog>
    `);
    const ad = root.querySelector('ui-alert-dialog');
    ad.show();
    await tick();
    root.querySelector('ui-alert-dialog-cancel [data-slot="alert-dialog-cancel"]').click();
    await tick();
    assert.equal(ad.hasAttribute('open'), false, 'cancel closes');
    root.remove();
  });

  test('action trigger closes the dialog', async () => {
    const root = await mount(html`
      <ui-alert-dialog>
        <ui-alert-dialog-trigger><button>X</button></ui-alert-dialog-trigger>
        <ui-alert-dialog-content>
          <ui-alert-dialog-action><button>Confirm</button></ui-alert-dialog-action>
        </ui-alert-dialog-content>
      </ui-alert-dialog>
    `);
    const ad = root.querySelector('ui-alert-dialog');
    ad.show();
    await tick();
    root.querySelector('ui-alert-dialog-action [data-slot="alert-dialog-action"]').click();
    await tick();
    assert.equal(ad.hasAttribute('open'), false);
    root.remove();
  });

  test('content hidden when host has no [open] attribute', async () => {
    const root = await mount(html`
      <ui-alert-dialog>
        <ui-alert-dialog-trigger><button>X</button></ui-alert-dialog-trigger>
        <ui-alert-dialog-content>
          <ui-alert-dialog-title>T</ui-alert-dialog-title>
        </ui-alert-dialog-content>
      </ui-alert-dialog>
    `);
    const ad = root.querySelector('ui-alert-dialog');
    const content = ad.querySelector('ui-alert-dialog-content');
    assert.ok(content, 'content stays in DOM when closed');
    assert.equal(getComputedStyle(content).display, 'none', 'CSS hides content when not [open]');
    root.remove();
  });
});

suite('ui-hover-card', () => {
  suiteSetup(async () => {
    await import(`${COMPONENTS_DIR}/hover-card.ts`);
  });

  // After the Lit-idiomatic refactor, role + data-state + popover all
  // live on the inner rendered element, not the <ui-*> host.

  test('hover-card is closed initially; data-state="closed"', async () => {
    const root = await mount(html`
      <ui-hover-card>
        <ui-hover-card-trigger><span>Hover me</span></ui-hover-card-trigger>
        <ui-hover-card-content>Profile preview</ui-hover-card-content>
      </ui-hover-card>
    `);
    await tick();
    const hc = root.querySelector('ui-hover-card');
    assert.equal(hc.hasAttribute('open'), false);
    const inner = hc.querySelector('[data-slot="hover-card"]');
    assert.equal(inner.getAttribute('data-state'), 'closed');
    root.remove();
  });

  test('show() with open-delay=0 opens immediately on next macrotask', async () => {
    // Default open-delay is 700ms: too long for a tick(). Set to 0 to
    // make the setTimeout fire on the next macrotask.
    const root = await mount(html`
      <ui-hover-card open-delay="0" close-delay="0">
        <ui-hover-card-trigger><span>x</span></ui-hover-card-trigger>
        <ui-hover-card-content>preview</ui-hover-card-content>
      </ui-hover-card>
    `);
    const hc = root.querySelector('ui-hover-card');
    hc.show();
    await new Promise((r) => setTimeout(r, 5));
    assert.ok(hc.hasAttribute('open'));
    const inner = hc.querySelector('[data-slot="hover-card"]');
    assert.equal(inner.getAttribute('data-state'), 'open');
    hc.hide();
    root.remove();
  });

  test('hide() closes after close-delay', async () => {
    const root = await mount(html`
      <ui-hover-card open-delay="0" close-delay="0">
        <ui-hover-card-trigger><span>x</span></ui-hover-card-trigger>
        <ui-hover-card-content>preview</ui-hover-card-content>
      </ui-hover-card>
    `);
    const hc = root.querySelector('ui-hover-card');
    hc.show();
    await new Promise((r) => setTimeout(r, 5));
    hc.hide();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(hc.hasAttribute('open'), false);
    root.remove();
  });

  test('content has role="dialog" for screen-reader semantics', async () => {
    const root = await mount(html`
      <ui-hover-card>
        <ui-hover-card-trigger><span>x</span></ui-hover-card-trigger>
        <ui-hover-card-content>preview</ui-hover-card-content>
      </ui-hover-card>
    `);
    await tick();
    const panel = root.querySelector('ui-hover-card-content [role="dialog"]');
    assert.ok(panel, 'role="dialog" present on rendered inner element');
    root.remove();
  });
});
