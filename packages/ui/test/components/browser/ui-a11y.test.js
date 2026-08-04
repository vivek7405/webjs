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

  test('arrow nav stays inside its own group when a panel nests another tabs', async () => {
    const root = await mount(html`
      <ui-tabs value="outer-a">
        <ui-tabs-list>
          <ui-tabs-trigger value="outer-a">Outer A</ui-tabs-trigger>
          <ui-tabs-trigger value="outer-b">Outer B</ui-tabs-trigger>
        </ui-tabs-list>
        <ui-tabs-content value="outer-a">
          <ui-tabs value="inner-x">
            <ui-tabs-list>
              <ui-tabs-trigger value="inner-x">Inner X</ui-tabs-trigger>
              <ui-tabs-trigger value="inner-y">Inner Y</ui-tabs-trigger>
            </ui-tabs-list>
            <ui-tabs-content value="inner-x">INNER PANE</ui-tabs-content>
            <ui-tabs-content value="inner-y">INNER PANE Y</ui-tabs-content>
          </ui-tabs>
        </ui-tabs-content>
        <ui-tabs-content value="outer-b">OUTER PANE B</ui-tabs-content>
      </ui-tabs>
    `);
    const outer = root.querySelector('ui-tabs');
    const outerBtns = [
      root.querySelector('ui-tabs-trigger[value="outer-a"] [role="tab"]'),
      root.querySelector('ui-tabs-trigger[value="outer-b"] [role="tab"]'),
    ];
    // ArrowRight from the LAST outer trigger must wrap to the FIRST outer
    // trigger, not jump into the nested group (which would set the outer
    // value to an inner-only value and hide every outer panel).
    outerBtns[1].focus();
    press(outerBtns[1], 'ArrowRight');
    await tick();
    assert.equal(document.activeElement, outerBtns[0], 'wrapped within the outer group');
    assert.equal(outer.getAttribute('value'), 'outer-a', 'outer value stays an outer value');
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

suite('ui-toggle a11y', () => {
  suiteSetup(async () => { await import(`${COMPONENTS_DIR}/toggle.ts`); });

  // The focusable control is the inner <button>, so the name has to be ON it.
  // Counterfactual for the forwarding fix: before it, render() emitted no
  // aria-label, so the documented icon-only shape (an aria-hidden SVG child)
  // left the button with an empty accessible name and these assertions failed.
  test('host aria-label reaches the focusable inner button', async () => {
    const root = await mount(html`
      <ui-toggle aria-label="Toggle bold">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M0 0h1v1H0z" /></svg>
      </ui-toggle>
    `);
    const btn = root.querySelector('ui-toggle button[data-slot="toggle"]');
    assert.equal(btn.getAttribute('aria-label'), 'Toggle bold', 'name is on the button');
    root.remove();
  });

  test('host aria-labelledby reaches the inner button', async () => {
    const root = await mount(html`
      <span id="toggle-bold-label">Bold</span>
      <ui-toggle aria-labelledby="toggle-bold-label">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M0 0h1v1H0z" /></svg>
      </ui-toggle>
    `);
    const btn = root.querySelector('ui-toggle button[data-slot="toggle"]');
    assert.equal(btn.getAttribute('aria-labelledby'), 'toggle-bold-label');
    root.remove();
  });

  // An unlabelled text toggle takes its name from the slotted text, so the
  // forwarding must OMIT the attribute rather than emit an empty one (an
  // aria-label="" would override the text and leave the button unnamed).
  test('an unlabelled toggle emits no empty aria-label', async () => {
    const root = await mount(html`<ui-toggle>Bold</ui-toggle>`);
    const btn = root.querySelector('ui-toggle button[data-slot="toggle"]');
    assert.equal(btn.hasAttribute('aria-label'), false, 'no aria-label attribute');
    assert.equal(btn.hasAttribute('aria-labelledby'), false, 'no aria-labelledby attribute');
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

  // APG Menu Button: closing returns focus to the trigger. Counterfactual for
  // the restore fix: every close path used to call hide() bare, so focus was
  // left on an item inside a panel that had just gone display:none and landed
  // on <body>. Each `activeElement === btn` assertion below fails without it.
  async function mountMenu() {
    const root = await mount(html`
      <button id="before-menu">before</button>
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger><button>Options</button></ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content>
          <ui-dropdown-menu-item>Profile</ui-dropdown-menu-item>
          <ui-dropdown-menu-item>Billing</ui-dropdown-menu-item>
        </ui-dropdown-menu-content>
      </ui-dropdown-menu>
      <button id="after-menu">after</button>
    `);
    const menuEl = root.querySelector('ui-dropdown-menu');
    const btn = root.querySelector('ui-dropdown-menu-trigger button');
    const items = [...root.querySelectorAll('ui-dropdown-menu-item [role="menuitem"]')];
    return { root, menuEl, btn, items };
  }

  test('Escape closes and returns focus to the trigger', async () => {
    const { root, menuEl, btn, items } = await mountMenu();
    menuEl.show();
    await tick();
    assert.equal(document.activeElement, items[0], 'first item focused on open');
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();
    assert.equal(menuEl.open, false, 'menu closed');
    assert.equal(document.activeElement, btn, 'focus back on the trigger');
    root.remove();
  });

  test('item activation closes and returns focus to the trigger', async () => {
    const { root, menuEl, btn, items } = await mountMenu();
    menuEl.show();
    await tick();
    items[1].click();
    await tick();
    assert.equal(menuEl.open, false, 'menu closed');
    assert.equal(document.activeElement, btn, 'focus back on the trigger');
    root.remove();
  });

  // The guard: an outside click that deliberately focused another control must
  // NOT have focus yanked back to the trigger. Counterfactual for the guard
  // itself, which an unconditional restore would fail.
  test('outside click closes without stealing focus back', async () => {
    const { root, menuEl, btn } = await mountMenu();
    menuEl.show();
    await tick();
    const other = root.querySelector('#after-menu');
    other.focus();
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    assert.equal(menuEl.open, false, 'menu closed');
    assert.equal(document.activeElement, other, 'focus stayed on the clicked control');
    assert.notEqual(document.activeElement, btn, 'trigger did not steal focus');
    root.remove();
  });

  // Finding 3: the JSDoc promised Tab closes the menu, and nothing implemented
  // it, so the menu stayed open while focus tabbed away. Tab must NOT be
  // prevented (the browser's own Tab continues the sequence from the trigger).
  test('Tab closes the menu and does not prevent the default tab move', async () => {
    const { root, menuEl, btn, items } = await mountMenu();
    menuEl.show();
    await tick();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    items[0].dispatchEvent(ev);
    await tick();
    assert.equal(menuEl.open, false, 'Tab closed the menu');
    assert.equal(ev.defaultPrevented, false, 'default tab move left alone');
    assert.equal(document.activeElement, btn, 'focus handed to the trigger to tab on from');
    root.remove();
  });

  async function mountSubmenu() {
    const root = await mount(html`
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger><button>Options</button></ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content>
          <ui-dropdown-menu-item>Profile</ui-dropdown-menu-item>
          <ui-dropdown-menu-sub>
            <ui-dropdown-menu-sub-trigger>Invite</ui-dropdown-menu-sub-trigger>
            <ui-dropdown-menu-sub-content>
              <ui-dropdown-menu-item>Email</ui-dropdown-menu-item>
            </ui-dropdown-menu-sub-content>
          </ui-dropdown-menu-sub>
        </ui-dropdown-menu-content>
      </ui-dropdown-menu>
    `);
    const menuEl = root.querySelector('ui-dropdown-menu');
    const sub = root.querySelector('ui-dropdown-menu-sub');
    const subTrigger = root.querySelector('ui-dropdown-menu-sub-trigger [role="menuitem"]');
    menuEl.show();
    await tick();
    subTrigger.focus();
    subTrigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await tick();
    const subItem = root.querySelector('ui-dropdown-menu-sub-content [role="menuitem"]');
    return { root, menuEl, sub, subTrigger, subItem };
  }

  // ArrowRight must open the submenu AND land focus on its first item. The
  // focus used to be queued in a microtask next to show(), which ran BEFORE
  // the popover="manual" panel was revealed, so focus() hit a display:none
  // element and was silently dropped with no retry. Counterfactual: focus
  // stayed on the sub-trigger, which is what this asserts against.
  test('ArrowRight opens the submenu and moves focus into it', async () => {
    const { root, sub, subTrigger, subItem } = await mountSubmenu();
    assert.equal(sub.open, true, 'submenu open');
    assert.notEqual(document.activeElement, subTrigger, 'focus left the sub-trigger');
    assert.equal(document.activeElement, subItem, 'focus is on the first submenu item');
    root.remove();
  });

  // Escape inside a SUBMENU closes only that submenu and refocuses its
  // sub-trigger, per APG (close the menu that CONTAINS focus). The root menu
  // stays open. Before the fix Escape tore the whole menu down at once.
  test('Escape inside a submenu closes only the submenu', async () => {
    const { root, menuEl, sub, subTrigger, subItem } = await mountSubmenu();
    subItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();
    assert.equal(sub.open, false, 'submenu closed');
    assert.equal(menuEl.open, true, 'root menu still open');
    assert.equal(document.activeElement, subTrigger, 'focus back on the sub-trigger');
    root.remove();
  });

  // Escape on the sub-trigger itself is focus in the ROOT panel, so it closes
  // the whole menu rather than the submenu the trigger owns.
  test('Escape on the sub-trigger closes the whole menu', async () => {
    const { root, menuEl, subTrigger } = await mountSubmenu();
    subTrigger.focus();
    subTrigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();
    assert.equal(menuEl.open, false, 'root menu closed');
    root.remove();
  });
});

suite('ui-dropdown-menu checkbox + radio items', () => {
  suiteSetup(async () => { await import(`${COMPONENTS_DIR}/dropdown-menu.ts`); });

  // Finding 4: the JSDoc documented type="checkbox" / type="radio" and the
  // class helpers existed, but the item hardcoded role="menuitem" with no
  // aria-checked, so a screen reader could perceive neither the control type
  // nor the state. Every role / aria-checked assertion here is that
  // counterfactual.
  test('checkbox item exposes menuitemcheckbox + aria-checked and toggles', async () => {
    const root = await mount(html`
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger><button>View</button></ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content>
          <ui-dropdown-menu-item type="checkbox" value="status" checked>Status</ui-dropdown-menu-item>
          <ui-dropdown-menu-item type="checkbox" value="activity">Activity</ui-dropdown-menu-item>
        </ui-dropdown-menu-content>
      </ui-dropdown-menu>
    `);
    const hosts = [...root.querySelectorAll('ui-dropdown-menu-item')];
    const inner = hosts.map((h) => h.querySelector('[role="menuitemcheckbox"]'));
    assert.ok(inner[0] && inner[1], 'both items carry role=menuitemcheckbox');
    assert.equal(inner[0].getAttribute('aria-checked'), 'true', 'checked item is aria-checked');
    assert.equal(inner[1].getAttribute('aria-checked'), 'false', 'unchecked item is not');
    // Activation flips only the item activated.
    inner[1].click();
    await tick();
    assert.equal(hosts[1].checked, true, 'second item became checked');
    assert.equal(
      hosts[1].querySelector('[role="menuitemcheckbox"]').getAttribute('aria-checked'),
      'true',
      'aria-checked followed the flip',
    );
    assert.equal(hosts[0].checked, true, 'checkbox items are independent');
    root.remove();
  });

  test('radio items expose menuitemradio and keep exactly one checked', async () => {
    const root = await mount(html`
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger><button>Panel</button></ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content>
          <ui-dropdown-menu-group aria-label="Panel position">
            <ui-dropdown-menu-item type="radio" value="top" checked>Top</ui-dropdown-menu-item>
            <ui-dropdown-menu-item type="radio" value="bottom">Bottom</ui-dropdown-menu-item>
            <ui-dropdown-menu-item type="radio" value="right">Right</ui-dropdown-menu-item>
          </ui-dropdown-menu-group>
        </ui-dropdown-menu-content>
      </ui-dropdown-menu>
    `);
    const hosts = [...root.querySelectorAll('ui-dropdown-menu-item')];
    const roleOf = (h) => h.querySelector('[role="menuitemradio"]');
    assert.ok(hosts.every(roleOf), 'every item carries role=menuitemradio');
    assert.equal(roleOf(hosts[0]).getAttribute('aria-checked'), 'true');
    roleOf(hosts[2]).click();
    await tick();
    assert.deepEqual(
      hosts.map((h) => h.checked),
      [false, false, true],
      'selecting one unchecks its set',
    );
    assert.equal(roleOf(hosts[0]).getAttribute('aria-checked'), 'false');
    assert.equal(roleOf(hosts[2]).getAttribute('aria-checked'), 'true');
    root.remove();
  });

  // The APG grouping element for menuitemradio is role="group" (radiogroup is
  // for role="radio"), and the set needs a name on it.
  test('group forwards its name onto the role=group element', async () => {
    const root = await mount(html`
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger><button>Panel</button></ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content>
          <ui-dropdown-menu-group aria-label="Panel position">
            <ui-dropdown-menu-item type="radio" value="top">Top</ui-dropdown-menu-item>
          </ui-dropdown-menu-group>
        </ui-dropdown-menu-content>
      </ui-dropdown-menu>
    `);
    const group = root.querySelector('[data-slot="dropdown-menu-group"]');
    assert.equal(group.getAttribute('role'), 'group');
    assert.equal(group.getAttribute('aria-label'), 'Panel position');
    root.remove();
  });

  // A plain item must NOT carry aria-checked: on role="menuitem" it is not
  // allowed, and it reads as a broken state rather than no state.
  test('a plain item carries no aria-checked', async () => {
    const root = await mount(html`
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger><button>Options</button></ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content>
          <ui-dropdown-menu-item>Profile</ui-dropdown-menu-item>
        </ui-dropdown-menu-content>
      </ui-dropdown-menu>
    `);
    const inner = root.querySelector('ui-dropdown-menu-item [role="menuitem"]');
    assert.equal(inner.hasAttribute('aria-checked'), false, 'no aria-checked');
    assert.equal(inner.hasAttribute('data-state'), false, 'no checked data-state');
    root.remove();
  });

  // Checkbox / radio items are focusable menu items, so they must be in arrow
  // nav and the open-focus. Counterfactual for broadening the [role=menuitem]
  // selectors: with the bare query they were skipped entirely.
  test('checkbox items join the open-focus and arrow navigation', async () => {
    const root = await mount(html`
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger><button>View</button></ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content>
          <ui-dropdown-menu-item type="checkbox" value="a">A</ui-dropdown-menu-item>
          <ui-dropdown-menu-item type="checkbox" value="b">B</ui-dropdown-menu-item>
        </ui-dropdown-menu-content>
      </ui-dropdown-menu>
    `);
    const menuEl = root.querySelector('ui-dropdown-menu');
    const inner = [...root.querySelectorAll('[role="menuitemcheckbox"]')];
    menuEl.show();
    await tick();
    assert.equal(document.activeElement, inner[0], 'first checkbox item focused on open');
    inner[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await tick();
    assert.equal(document.activeElement, inner[1], 'ArrowDown reached the second');
    root.remove();
  });

  // Cancelling ui-item-select keeps the menu open, the shadcn
  // onSelect(e => e.preventDefault()) parity shape a multi-select menu needs.
  test('cancelling ui-item-select keeps the menu open but still toggles', async () => {
    const root = await mount(html`
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger><button>View</button></ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content>
          <ui-dropdown-menu-item type="checkbox" value="a">A</ui-dropdown-menu-item>
        </ui-dropdown-menu-content>
      </ui-dropdown-menu>
    `);
    const menuEl = root.querySelector('ui-dropdown-menu');
    const host = root.querySelector('ui-dropdown-menu-item');
    const seen = [];
    menuEl.addEventListener('ui-item-select', (e) => {
      seen.push(e.detail);
      e.preventDefault();
    });
    menuEl.show();
    await tick();
    host.querySelector('[role="menuitemcheckbox"]').click();
    await tick();
    assert.equal(seen.length, 1, 'event fired');
    assert.equal(seen[0].value, 'a', 'detail carries the value');
    assert.equal(seen[0].checked, true, 'detail carries the settled state');
    assert.equal(host.checked, true, 'the toggle still happened');
    assert.equal(menuEl.open, true, 'menu stayed open');
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

  // Finding 5: the file had no keydown handler at all, so a showing tip could
  // only be dismissed by moving the pointer or blurring. APG requires Escape,
  // because a tip can cover the content underneath it. Counterfactual: without
  // the handler `tip.open` stays true and defaultPrevented stays false.
  async function mountTooltip() {
    const root = await mount(html`
      <ui-tooltip delay-duration="0">
        <ui-tooltip-trigger><button aria-label="Help">?</button></ui-tooltip-trigger>
        <ui-tooltip-content>Helpful tip</ui-tooltip-content>
      </ui-tooltip>
    `);
    return { root, tip: root.querySelector('ui-tooltip'), btn: root.querySelector('button') };
  }

  const escape = () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );

  test('Escape dismisses a showing tip and leaves focus on the trigger', async () => {
    const { root, tip, btn } = await mountTooltip();
    btn.focus();
    tip.open = true;
    await tick();
    assert.equal(tip.open, true, 'tip is showing');
    escape();
    await tick();
    assert.equal(tip.open, false, 'Escape dismissed the tip');
    assert.equal(document.activeElement, btn, 'focus stayed on the trigger');
    root.remove();
  });

  test('Escape dismisses immediately, not on the hover-out grace timer', async () => {
    const { root, tip } = await mountTooltip();
    tip.open = true;
    await tick();
    escape();
    // No awaiting a timer: the dismissal is synchronous on the keydown.
    assert.equal(tip.open, false, 'closed on the key, not 100ms later');
    root.remove();
  });

  // A closed tooltip must not swallow Escape from whatever else wants it (a
  // dialog it sits inside, for one). The listener is only bound while open.
  test('a closed tooltip does not consume Escape', async () => {
    const { root, tip } = await mountTooltip();
    assert.equal(tip.open, false, 'starts closed');
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    await tick();
    assert.equal(ev.defaultPrevented, false, 'Escape left for someone else');
    root.remove();
  });

  test('a dismissed tooltip stops listening for Escape', async () => {
    const { root, tip } = await mountTooltip();
    tip.open = true;
    await tick();
    escape();
    await tick();
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    await tick();
    assert.equal(ev.defaultPrevented, false, 'no leftover listener consuming Escape');
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
