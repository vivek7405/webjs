/**
 * Accessibility browser tests for @webjsdev/ui Tier-2 custom elements.
 * Runs in real Chromium via WTR + Playwright.
 *
 * These assert the ARIA wiring the components now provide out of the box
 * (#655): the relationships and roving focus an author would otherwise have
 * to hand-wire. Each assertion is a counterfactual for its fix: it fails if
 * the corresponding attribute / behaviour is removed from the component.
 *
 * Tier-1 class helpers (button, alert, table, ...) push their ARIA to the
 * caller by design, so their contract is documented in JSDoc rather than
 * enforced here.
 */
import { html } from '../../../../core/src/html.js';
import { render } from '../../../../core/src/render-client.js';

import { assert } from '../../../../../test/browser-assert.js';

const COMPONENTS_DIR = '/packages/ui/packages/registry/components';

/** Two RAFs so connectedCallback + queueMicrotask wiring settles. */
const tick = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

async function mount(tpl) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(tpl, root);
  await tick();
  await tick();
  return root;
}

suite('ui-tabs a11y', () => {
  suiteSetup(async () => { await import(`${COMPONENTS_DIR}/tabs.ts`); });

  test('trigger aria-controls + panel aria-labelledby cross-link by value', async () => {
    const root = await mount(html`
      <ui-tabs value="a">
        <ui-tabs-list>
          <ui-tabs-trigger value="a">A</ui-tabs-trigger>
          <ui-tabs-trigger value="b">B</ui-tabs-trigger>
        </ui-tabs-list>
        <ui-tabs-content value="a">PANE A</ui-tabs-content>
        <ui-tabs-content value="b">PANE B</ui-tabs-content>
      </ui-tabs>
    `);
    const trigger = root.querySelector('ui-tabs-trigger[value="a"] [role="tab"]');
    const panel = root.querySelector('ui-tabs-content[value="a"] [role="tabpanel"]');
    assert.ok(trigger.id, 'trigger has an id');
    assert.ok(panel.id, 'panel has an id');
    assert.equal(trigger.getAttribute('aria-controls'), panel.id, 'aria-controls -> panel');
    assert.equal(panel.getAttribute('aria-labelledby'), trigger.id, 'aria-labelledby -> trigger');
    root.remove();
  });

  test('list reports aria-orientation; inactive panel is inert + hidden', async () => {
    const root = await mount(html`
      <ui-tabs value="a" orientation="vertical">
        <ui-tabs-list>
          <ui-tabs-trigger value="a">A</ui-tabs-trigger>
          <ui-tabs-trigger value="b">B</ui-tabs-trigger>
        </ui-tabs-list>
        <ui-tabs-content value="a">PANE A</ui-tabs-content>
        <ui-tabs-content value="b">PANE B</ui-tabs-content>
      </ui-tabs>
    `);
    const list = root.querySelector('ui-tabs-list [role="tablist"]');
    assert.equal(list.getAttribute('aria-orientation'), 'vertical');
    const paneB = root.querySelector('ui-tabs-content[value="b"]');
    assert.ok(paneB.hidden, 'inactive panel hidden');
    assert.ok(paneB.inert, 'inactive panel inert');
    root.remove();
  });

  test('ids are unique across two tab groups reusing the same value', async () => {
    const root = await mount(html`
      <ui-tabs value="x">
        <ui-tabs-list><ui-tabs-trigger value="x">X</ui-tabs-trigger></ui-tabs-list>
        <ui-tabs-content value="x">ONE</ui-tabs-content>
      </ui-tabs>
      <ui-tabs value="x">
        <ui-tabs-list><ui-tabs-trigger value="x">X</ui-tabs-trigger></ui-tabs-list>
        <ui-tabs-content value="x">TWO</ui-tabs-content>
      </ui-tabs>
    `);
    const triggers = root.querySelectorAll('ui-tabs-trigger [role="tab"]');
    assert.ok(triggers[0].id && triggers[1].id, 'both have ids');
    assert.ok(triggers[0].id !== triggers[1].id, 'ids differ across groups');
    root.remove();
  });

  // Keyboard nav (APG automatic activation): arrow / Home / End both select
  // the tab AND move focus to its inner <button role="tab">. The counterfactual
  // for the #1078 fix is `document.activeElement === next inner button`: before
  // the fix the handler focused the non-focusable <ui-tabs-trigger> host, so
  // focus never moved and this assertion failed.
  async function mountTabs(orientation = 'horizontal') {
    const root = await mount(html`
      <ui-tabs value="a" orientation=${orientation}>
        <ui-tabs-list>
          <ui-tabs-trigger value="a">A</ui-tabs-trigger>
          <ui-tabs-trigger value="b">B</ui-tabs-trigger>
          <ui-tabs-trigger value="c">C</ui-tabs-trigger>
        </ui-tabs-list>
        <ui-tabs-content value="a">PANE A</ui-tabs-content>
        <ui-tabs-content value="b">PANE B</ui-tabs-content>
        <ui-tabs-content value="c">PANE C</ui-tabs-content>
      </ui-tabs>
    `);
    const tabsEl = root.querySelector('ui-tabs');
    const btns = [...root.querySelectorAll('ui-tabs-trigger [role="tab"]')];
    return { root, tabsEl, btns };
  }

  const press = (el, key) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

  test('ArrowRight moves focus AND selection to the next trigger', async () => {
    const { root, tabsEl, btns } = await mountTabs();
    btns[0].focus();
    press(btns[0], 'ArrowRight');
    await tick();
    assert.equal(document.activeElement, btns[1], 'focus moved to trigger B');
    assert.equal(tabsEl.getAttribute('value'), 'b', 'selection followed to b');
    assert.equal(btns[1].getAttribute('data-state'), 'active', 'B is active');
    assert.equal(btns[1].tabIndex, 0, 'B is the tab stop');
    assert.equal(btns[0].tabIndex, -1, 'A left the tab order');
    root.remove();
  });

  test('ArrowLeft wraps from the first trigger to the last', async () => {
    const { root, tabsEl, btns } = await mountTabs();
    btns[0].focus();
    press(btns[0], 'ArrowLeft');
    await tick();
    assert.equal(document.activeElement, btns[2], 'focus wrapped to trigger C');
    assert.equal(tabsEl.getAttribute('value'), 'c', 'selection wrapped to c');
    root.remove();
  });

  test('Home / End move focus to the first / last trigger', async () => {
    const { root, tabsEl, btns } = await mountTabs();
    btns[1].focus();
    press(btns[1], 'End');
    await tick();
    assert.equal(document.activeElement, btns[2], 'End -> last trigger');
    assert.equal(tabsEl.getAttribute('value'), 'c');
    press(btns[2], 'Home');
    await tick();
    assert.equal(document.activeElement, btns[0], 'Home -> first trigger');
    assert.equal(tabsEl.getAttribute('value'), 'a');
    root.remove();
  });

  test('vertical orientation navigates with ArrowDown / ArrowUp', async () => {
    const { root, tabsEl, btns } = await mountTabs('vertical');
    btns[0].focus();
    press(btns[0], 'ArrowDown');
    await tick();
    assert.equal(document.activeElement, btns[1], 'ArrowDown -> next trigger');
    assert.equal(tabsEl.getAttribute('value'), 'b');
    press(btns[1], 'ArrowUp');
    await tick();
    assert.equal(document.activeElement, btns[0], 'ArrowUp -> previous trigger');
    assert.equal(tabsEl.getAttribute('value'), 'a');
    root.remove();
  });
});

suite('ui-toggle-group a11y', () => {
  suiteSetup(async () => { await import(`${COMPONENTS_DIR}/toggle-group.ts`); });

  test('roving tabindex: exactly one item is in the tab order', async () => {
    const root = await mount(html`
      <ui-toggle-group type="single" value="bold">
        <ui-toggle-group-item value="bold">B</ui-toggle-group-item>
        <ui-toggle-group-item value="italic">I</ui-toggle-group-item>
        <ui-toggle-group-item value="underline">U</ui-toggle-group-item>
      </ui-toggle-group>
    `);
    const items = [...root.querySelectorAll('ui-toggle-group-item')];
    const tabbable = items.filter((i) => i.tabIndex === 0);
    assert.equal(tabbable.length, 1, 'one tabbable item');
    assert.equal(tabbable[0].getAttribute('value'), 'bold', 'selected item is the tab stop');
    root.remove();
  });

  test('ArrowRight moves focus and the tab stop to the next item', async () => {
    const root = await mount(html`
      <ui-toggle-group type="single" value="bold">
        <ui-toggle-group-item value="bold">B</ui-toggle-group-item>
        <ui-toggle-group-item value="italic">I</ui-toggle-group-item>
      </ui-toggle-group>
    `);
    const items = [...root.querySelectorAll('ui-toggle-group-item')];
    items[0].focus();
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await tick();
    assert.equal(document.activeElement, items[1], 'focus moved to item 2');
    assert.equal(items[1].tabIndex, 0, 'item 2 is now the tab stop');
    assert.equal(items[0].tabIndex, -1, 'item 1 left the tab order');
    root.remove();
  });

  test('End jumps focus to the last item', async () => {
    const root = await mount(html`
      <ui-toggle-group type="multiple">
        <ui-toggle-group-item value="a">a</ui-toggle-group-item>
        <ui-toggle-group-item value="b">b</ui-toggle-group-item>
        <ui-toggle-group-item value="c">c</ui-toggle-group-item>
      </ui-toggle-group>
    `);
    const items = [...root.querySelectorAll('ui-toggle-group-item')];
    items[0].focus();
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    await tick();
    assert.equal(document.activeElement, items[2], 'focus on last item');
    root.remove();
  });
});

suite('ui-dropdown-menu a11y', () => {
  suiteSetup(async () => { await import(`${COMPONENTS_DIR}/dropdown-menu.ts`); });

  test('menu declares orientation; disabled item exposes aria-disabled', async () => {
    const root = await mount(html`
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger><button>Options</button></ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content>
          <ui-dropdown-menu-item>Profile</ui-dropdown-menu-item>
          <ui-dropdown-menu-item data-disabled>Billing</ui-dropdown-menu-item>
        </ui-dropdown-menu-content>
      </ui-dropdown-menu>
    `);
    const menu = root.querySelector('ui-dropdown-menu-content [role="menu"]');
    assert.equal(menu.getAttribute('aria-orientation'), 'vertical');
    const disabled = root.querySelector('ui-dropdown-menu-item[data-disabled] [role="menuitem"]');
    assert.equal(disabled.getAttribute('aria-disabled'), 'true');
    root.remove();
  });

  test('trigger control gets haspopup, controls, and live aria-expanded', async () => {
    const root = await mount(html`
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger><button>Options</button></ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content>
          <ui-dropdown-menu-item>Profile</ui-dropdown-menu-item>
        </ui-dropdown-menu-content>
      </ui-dropdown-menu>
    `);
    const btn = root.querySelector('ui-dropdown-menu-trigger button');
    const menu = root.querySelector('ui-dropdown-menu-content [role="menu"]');
    assert.equal(btn.getAttribute('aria-haspopup'), 'menu');
    assert.equal(btn.getAttribute('aria-controls'), menu.id);
    assert.equal(btn.getAttribute('aria-expanded'), 'false', 'closed -> false');
    root.querySelector('ui-dropdown-menu').show();
    await tick();
    assert.equal(btn.getAttribute('aria-expanded'), 'true', 'open -> true');
    root.remove();
  });

  // Keyboard nav: opening focuses the first item, ArrowDown/Up move focus
  // among [role="menuitem"] (skipping disabled), and Escape closes the menu.
  test('open focuses first item; ArrowDown/Up move focus; Escape closes', async () => {
    const root = await mount(html`
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger><button>Options</button></ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content>
          <ui-dropdown-menu-item>Profile</ui-dropdown-menu-item>
          <ui-dropdown-menu-item>Billing</ui-dropdown-menu-item>
          <ui-dropdown-menu-item>Settings</ui-dropdown-menu-item>
        </ui-dropdown-menu-content>
      </ui-dropdown-menu>
    `);
    const menuEl = root.querySelector('ui-dropdown-menu');
    const items = [...root.querySelectorAll('ui-dropdown-menu-item [role="menuitem"]')];
    menuEl.show();
    await tick();
    assert.equal(document.activeElement, items[0], 'first item focused on open');
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await tick();
    assert.equal(document.activeElement, items[1], 'ArrowDown -> second item');
    items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await tick();
    assert.equal(document.activeElement, items[0], 'ArrowUp -> first item');
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();
    assert.equal(menuEl.open, false, 'Escape closes the menu');
    root.remove();
  });
});

suite('ui-dialog a11y', () => {
  suiteSetup(async () => { await import(`${COMPONENTS_DIR}/dialog.ts`); });

  test('open dialog is labelled by its title and described by its description', async () => {
    const root = await mount(html`
      <ui-dialog>
        <ui-dialog-content>
          <div>
            <h2 data-slot="dialog-title">Edit profile</h2>
            <p data-slot="dialog-description">Make changes.</p>
          </div>
        </ui-dialog-content>
      </ui-dialog>
    `);
    root.querySelector('ui-dialog').show();
    await tick();
    await tick();
    const panel = root.querySelector('[data-slot="dialog-content"]');
    const title = root.querySelector('[data-slot="dialog-title"]');
    const desc = root.querySelector('[data-slot="dialog-description"]');
    assert.ok(title.id, 'title got an id');
    assert.equal(panel.getAttribute('aria-labelledby'), title.id);
    assert.equal(panel.getAttribute('aria-describedby'), desc.id);
    root.querySelector('ui-dialog').hide();
    root.remove();
  });
});

suite('ui-alert-dialog a11y', () => {
  suiteSetup(async () => { await import(`${COMPONENTS_DIR}/alert-dialog.ts`); });

  test('open alertdialog is labelled by its title and described by its description', async () => {
    const root = await mount(html`
      <ui-alert-dialog>
        <ui-alert-dialog-content>
          <div>
            <h2 data-slot="alert-dialog-title">Delete account?</h2>
            <p data-slot="alert-dialog-description">This cannot be undone.</p>
          </div>
        </ui-alert-dialog-content>
      </ui-alert-dialog>
    `);
    root.querySelector('ui-alert-dialog').show();
    await tick();
    await tick();
    const panel = root.querySelector('[data-slot="alert-dialog-content"]');
    const title = root.querySelector('[data-slot="alert-dialog-title"]');
    const desc = root.querySelector('[data-slot="alert-dialog-description"]');
    assert.ok(title.id);
    assert.equal(panel.getAttribute('aria-labelledby'), title.id);
    assert.equal(panel.getAttribute('aria-describedby'), desc.id);
    root.querySelector('ui-alert-dialog').hide();
    root.remove();
  });
});

suite('ui-tooltip a11y', () => {
  suiteSetup(async () => { await import(`${COMPONENTS_DIR}/tooltip.ts`); });

  test('trigger references the tip via aria-describedby', async () => {
    const root = await mount(html`
      <ui-tooltip>
        <ui-tooltip-trigger><button aria-label="Help">?</button></ui-tooltip-trigger>
        <ui-tooltip-content>Helpful tip</ui-tooltip-content>
      </ui-tooltip>
    `);
    const btn = root.querySelector('ui-tooltip-trigger button');
    const content = root.querySelector('ui-tooltip-content [role="tooltip"]');
    assert.ok(content.id, 'tip got an id');
    assert.equal(btn.getAttribute('aria-describedby'), content.id);
    root.remove();
  });
});

suite('ui-hover-card a11y', () => {
  suiteSetup(async () => { await import(`${COMPONENTS_DIR}/hover-card.ts`); });

  test('trigger gets haspopup + controls and aria-expanded tracks open', async () => {
    const root = await mount(html`
      <ui-hover-card>
        <ui-hover-card-trigger><a href="/u">@vivek</a></ui-hover-card-trigger>
        <ui-hover-card-content>Card body</ui-hover-card-content>
      </ui-hover-card>
    `);
    const link = root.querySelector('ui-hover-card-trigger a');
    const content = root.querySelector('ui-hover-card-content [role="dialog"]');
    assert.equal(link.getAttribute('aria-haspopup'), 'dialog');
    assert.equal(link.getAttribute('aria-controls'), content.id);
    assert.equal(link.getAttribute('aria-expanded'), 'false');
    root.querySelector('ui-hover-card').open = true;
    await tick();
    assert.equal(link.getAttribute('aria-expanded'), 'true');
    root.remove();
  });
});

suite('ui-sonner a11y', () => {
  suiteSetup(async () => { await import(`${COMPONENTS_DIR}/sonner.ts`); });

  test('viewport is a persistent polite live region; error toast is assertive', async () => {
    const root = await mount(html`<ui-sonner></ui-sonner>`);
    const region = root.querySelector('[data-slot="sonner"]');
    assert.equal(region.getAttribute('role'), 'region');
    assert.equal(region.getAttribute('aria-live'), 'polite');
    root.querySelector('ui-sonner').addToast('Boom', {}, 'error');
    await tick();
    const alert = region.querySelector('[role="alert"]');
    assert.ok(alert, 'error toast carries role=alert');
    root.remove();
  });
});
