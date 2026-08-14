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

/** Escape at the document, where the overlay components listen for it. */
const escape = () =>
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );

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

  // Finding 11: the item declared only value + pressed, so a group item could
  // not be disabled at all and _items() would not have skipped one. Since the
  // group is a SINGLE tab stop, focus landing on a disabled item could not be
  // tabbed past, so skipping it is what keeps the group usable.
  async function mountDisabled() {
    const root = await mount(html`
      <ui-toggle-group type="single" value="a">
        <ui-toggle-group-item value="a">a</ui-toggle-group-item>
        <ui-toggle-group-item value="b" disabled>b</ui-toggle-group-item>
        <ui-toggle-group-item value="c">c</ui-toggle-group-item>
      </ui-toggle-group>
    `);
    return { root, items: [...root.querySelectorAll('ui-toggle-group-item')] };
  }

  test('a disabled item reports aria-disabled', async () => {
    const { root, items } = await mountDisabled();
    assert.equal(items[1].getAttribute('aria-disabled'), 'true', 'disabled item');
    assert.equal(items[0].getAttribute('aria-disabled'), 'false', 'enabled items are not');
    root.remove();
  });

  test('ArrowRight skips over a disabled item', async () => {
    const { root, items } = await mountDisabled();
    items[0].focus();
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await tick();
    assert.equal(document.activeElement, items[2], 'jumped past the disabled item');
    root.remove();
  });

  test('a disabled item never holds the tab stop', async () => {
    const { root, items } = await mountDisabled();
    assert.equal(items[1].tabIndex, -1, 'disabled item is out of the tab order');
    const tabbable = items.filter((i) => i.tabIndex === 0);
    assert.equal(tabbable.length, 1, 'exactly one tab stop');
    assert.ok(!tabbable[0].disabled, 'and it is an enabled item');
    root.remove();
  });

  test('a disabled item refuses click and Enter', async () => {
    const { root, items } = await mountDisabled();
    const group = root.querySelector('ui-toggle-group');
    items[1].click();
    await tick();
    assert.equal(group.getAttribute('value'), 'a', 'click did not select it');
    items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick();
    assert.equal(group.getAttribute('value'), 'a', 'Enter did not select it either');
    root.remove();
  });

  // Disabling the item that currently holds the tab stop must hand the stop to
  // an enabled sibling, or the group becomes unreachable by keyboard.
  test('disabling the tabbable item moves the tab stop to an enabled one', async () => {
    const { root, items } = await mountDisabled();
    const held = items.find((i) => i.tabIndex === 0);
    held.disabled = true;
    await tick();
    await tick();
    const tabbable = items.filter((i) => i.tabIndex === 0);
    assert.equal(tabbable.length, 1, 'still exactly one tab stop');
    assert.ok(!tabbable[0].disabled, 'and it moved to an enabled item');
    root.remove();
  });

  test('an all-disabled group leaves no item in the tab order', async () => {
    const root = await mount(html`
      <ui-toggle-group type="single">
        <ui-toggle-group-item value="a" disabled>a</ui-toggle-group-item>
        <ui-toggle-group-item value="b" disabled>b</ui-toggle-group-item>
      </ui-toggle-group>
    `);
    const items = [...root.querySelectorAll('ui-toggle-group-item')];
    assert.equal(items.filter((i) => i.tabIndex === 0).length, 0, 'no dead-end tab stop');
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

  // An outside click is still a close of a popover="manual" panel, so it owes the
  // same focus care as Escape. TWO branches, and both need covering: the first
  // version of this test only exercised the second, so it passed identically with
  // an unconditional restore and proved nothing about the guard.
  //
  // Branch 1: the click landed on nothing focusable, so focus would be lost to
  // <body> when the panel hides. Counterfactual: with the bare hide() this path
  // used to do, activeElement ends up <body> instead of the trigger.
  test('outside click on nothing focusable hands focus back to the trigger', async () => {
    const { root, menuEl, btn, items } = await mountMenu();
    menuEl.show();
    await tick();
    assert.equal(document.activeElement, items[0], 'focus starts inside the menu');
    // pointerdown is where focus-inside is sampled, before the browser moves it.
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    assert.equal(menuEl.open, false, 'menu closed');
    assert.notEqual(document.activeElement, document.body, 'focus was not dropped to <body>');
    assert.equal(document.activeElement, btn, 'focus went back to the trigger');
    root.remove();
  });

  // Branch 2: the click put focus on another control, so that control keeps it.
  // This is what makes the restore conditional rather than unconditional.
  test('outside click onto another control leaves focus there', async () => {
    const { root, menuEl, btn } = await mountMenu();
    menuEl.show();
    await tick();
    const other = root.querySelector('#after-menu');
    other.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    other.focus();
    other.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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

  // A menu item is a <div role="menuitem">, which gets NO native activation, so
  // Enter / Space are synthesized. Before this, the keyboard could focus a
  // checkable item and then do nothing with it: activation is its only state
  // transition. Every other test in this suite uses .click(), which is exactly
  // why CI could not see it. Counterfactual: without the branch, `checked` stays
  // false and Space does not even preventDefault, so the page scrolls.
  async function mountCheckable() {
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
    menuEl.show();
    await tick();
    return { root, menuEl, host, inner: host.querySelector('[role="menuitemcheckbox"]') };
  }

  test('Enter activates a checkable item from the keyboard', async () => {
    const { root, host, inner } = await mountCheckable();
    assert.equal(document.activeElement, inner, 'the item has keyboard focus');
    assert.equal(host.checked, false, 'starts unchecked');
    inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick();
    assert.equal(host.checked, true, 'Enter toggled it');
    root.remove();
  });

  test('Space activates a checkable item and does not scroll the page', async () => {
    const { root, host, inner } = await mountCheckable();
    const ev = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    inner.dispatchEvent(ev);
    await tick();
    assert.equal(host.checked, true, 'Space toggled it');
    assert.equal(ev.defaultPrevented, true, 'and the page scroll was suppressed');
    root.remove();
  });

  // Space must NOT be swallowed for a control the author slotted into the panel:
  // it is inside [role="menu"] too, so an unconditional preventDefault meant a
  // user could not type a space into their own filter input.
  test('Space still reaches an author control slotted into the panel', async () => {
    const root = await mount(html`
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger><button>Options</button></ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content>
          <input id="menu-filter" placeholder="Filter">
          <ui-dropdown-menu-item>Profile</ui-dropdown-menu-item>
        </ui-dropdown-menu-content>
      </ui-dropdown-menu>
    `);
    const menuEl = root.querySelector('ui-dropdown-menu');
    const input = root.querySelector('#menu-filter');
    menuEl.show();
    await tick();
    input.focus();
    const ev = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
    await tick();
    assert.equal(ev.defaultPrevented, false, 'the space was left for the input');
    assert.equal(menuEl.open, true, 'and it did not activate anything');
    root.remove();
  });

  // Space while a typeahead search is in flight belongs to the SEARCH, or a
  // multi-word item can never be disambiguated past its first word.
  test('Space continues a typeahead search rather than activating', async () => {
    const root = await mount(html`
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger><button>View</button></ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content>
          <ui-dropdown-menu-item text-value="Status line">Status line</ui-dropdown-menu-item>
          <ui-dropdown-menu-item text-value="Status bar">Status bar</ui-dropdown-menu-item>
        </ui-dropdown-menu-content>
      </ui-dropdown-menu>
    `);
    const menuEl = root.querySelector('ui-dropdown-menu');
    const inner = [...root.querySelectorAll('[role="menuitem"]')];
    menuEl.show();
    await tick();
    // Type "status", then a space: the space must extend the buffer, not select.
    for (const ch of 'status') {
      inner[0].dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
    }
    await tick();
    inner[0].dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    await tick();
    assert.equal(menuEl.open, true, 'the space did not activate and close the menu');
    // "status b" now disambiguates to the second item.
    inner[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    await tick();
    assert.equal(document.activeElement, inner[1], 'multi-word typeahead reached "Status bar"');
    root.remove();
  });

  test('Enter on a plain item activates it and closes the menu', async () => {
    const root = await mount(html`
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger><button>Options</button></ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content>
          <ui-dropdown-menu-item>Profile</ui-dropdown-menu-item>
        </ui-dropdown-menu-content>
      </ui-dropdown-menu>
    `);
    const menuEl = root.querySelector('ui-dropdown-menu');
    const btn = root.querySelector('ui-dropdown-menu-trigger button');
    const item = root.querySelector('ui-dropdown-menu-item [role="menuitem"]');
    menuEl.show();
    await tick();
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick();
    assert.equal(menuEl.open, false, 'activation closed the menu');
    assert.equal(document.activeElement, btn, 'and focus returned to the trigger');
    root.remove();
  });

  // A submenu is a role="menu" too, and APG asks for it to be named by the
  // menuitem that opens it. Only the ROOT panel was wired, so every submenu
  // shipped unnamed while the A11y block claimed the panel is always labelled.
  // Enter on a sub-trigger also had no branch, same as every other item.
  test('Enter opens a submenu, and the submenu panel is named by its trigger', async () => {
    const root = await mount(html`
      <ui-dropdown-menu>
        <ui-dropdown-menu-trigger><button>Options</button></ui-dropdown-menu-trigger>
        <ui-dropdown-menu-content>
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
    const panel = root.querySelector('ui-dropdown-menu-sub-content [role="menu"]');
    menuEl.show();
    await tick();
    // Naming is wired independently of open state.
    assert.ok(subTrigger.id, 'the sub-trigger got an id to point at');
    assert.equal(panel.getAttribute('aria-labelledby'), subTrigger.id, 'submenu is named');
    assert.equal(subTrigger.getAttribute('aria-controls'), panel.id, 'and points back at it');
    subTrigger.focus();
    subTrigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick();
    assert.equal(sub.open, true, 'Enter opened the submenu');
    const subItem = root.querySelector('ui-dropdown-menu-sub-content [role="menuitem"]');
    assert.equal(document.activeElement, subItem, 'and focus moved into it');
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
    const panel = root.querySelector('dialog[data-slot="dialog-native"]');
    const title = root.querySelector('[data-slot="dialog-title"]');
    const desc = root.querySelector('[data-slot="dialog-description"]');
    assert.ok(title.id, 'title got an id');
    assert.equal(panel.getAttribute('aria-labelledby'), title.id);
    assert.equal(panel.getAttribute('aria-describedby'), desc.id);
    assert.equal(panel.hasAttribute('aria-label'), false, 'no competing generic name');
    root.querySelector('ui-dialog').hide();
    root.remove();
  });

  // Finding 8: the wiring named the panel only when a title node existed, so a
  // title-less dialog shipped with no accessible name at all, which is an APG
  // failure for a modal. Counterfactual: without the fallback the panel has
  // neither aria-labelledby nor aria-label.
  test('a title-less dialog still gets an accessible name', async () => {
    const root = await mount(html`
      <ui-dialog>
        <ui-dialog-content><div>Bare content, no title node.</div></ui-dialog-content>
      </ui-dialog>
    `);
    root.querySelector('ui-dialog').show();
    await tick();
    await tick();
    const panel = root.querySelector('dialog[data-slot="dialog-native"]');
    assert.equal(panel.hasAttribute('aria-labelledby'), false, 'nothing to point at');
    assert.equal(panel.getAttribute('aria-label'), 'Dialog', 'generic name as the floor');
    root.querySelector('ui-dialog').hide();
    root.remove();
  });

  // The case the first pass at this missed: an authored name AND a title node.
  // The forwarding set aria-label, then the title wiring set aria-labelledby
  // alongside it, and aria-labelledby beats aria-label per accname, so the title
  // silently won over the name the author asked for. Counterfactual: restore the
  // fall-through and aria-labelledby comes back, outranking the author's name.
  //
  // Cleanup is in a `finally` on purpose. A modal <dialog> left open makes the
  // rest of the document inert, so a dialog assertion that throws before its
  // hide() turns one real failure into a cascade of unrelated focus failures in
  // every later suite. That cascade actually happened while verifying this test.
  test('an authored name beats a title node, and leaves nothing to outrank it', async () => {
    const root = await mount(html`
      <ui-dialog>
        <ui-dialog-content aria-label="Edit profile">
          <h2 data-slot="dialog-title">Some other title</h2>
          <p data-slot="dialog-description">Make changes.</p>
        </ui-dialog-content>
      </ui-dialog>
    `);
    const dlg = root.querySelector('ui-dialog');
    try {
      dlg.show();
      await tick();
      await tick();
      const panel = root.querySelector('dialog[data-slot="dialog-native"]');
      const desc = root.querySelector('[data-slot="dialog-description"]');
      assert.equal(panel.getAttribute('aria-label'), 'Edit profile', 'author name applied');
      assert.equal(
        panel.hasAttribute('aria-labelledby'),
        false,
        'no aria-labelledby, which would outrank the author name',
      );
      // The description is independent of the name and must still be wired.
      assert.equal(panel.getAttribute('aria-describedby'), desc.id, 'description still wired');
    } finally {
      dlg.hide();
      root.remove();
    }
  });

  test('an authored aria-labelledby beats a title node too', async () => {
    const root = await mount(html`
      <span id="dlg-own-label">My own label</span>
      <ui-dialog>
        <ui-dialog-content aria-labelledby="dlg-own-label">
          <h2 data-slot="dialog-title">Some other title</h2>
        </ui-dialog-content>
      </ui-dialog>
    `);
    const dlg = root.querySelector('ui-dialog');
    try {
      dlg.show();
      await tick();
      await tick();
      const panel = root.querySelector('dialog[data-slot="dialog-native"]');
      assert.equal(panel.getAttribute('aria-labelledby'), 'dlg-own-label', 'author reference wins');
    } finally {
      dlg.hide();
      root.remove();
    }
  });

  test('an authored aria-label on the content host reaches the panel and wins', async () => {
    const root = await mount(html`
      <ui-dialog>
        <ui-dialog-content aria-label="Edit profile">
          <div>Bare content, no title node.</div>
        </ui-dialog-content>
      </ui-dialog>
    `);
    root.querySelector('ui-dialog').show();
    await tick();
    await tick();
    const panel = root.querySelector('dialog[data-slot="dialog-native"]');
    assert.equal(panel.getAttribute('aria-label'), 'Edit profile', 'author name forwarded');
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
    const panel = root.querySelector('dialog[data-slot="alert-dialog-native"]');
    const title = root.querySelector('[data-slot="alert-dialog-title"]');
    const desc = root.querySelector('[data-slot="alert-dialog-description"]');
    assert.ok(title.id);
    assert.equal(panel.getAttribute('aria-labelledby'), title.id);
    assert.equal(panel.getAttribute('aria-describedby'), desc.id);
    assert.equal(panel.hasAttribute('aria-label'), false, 'no competing generic name');
    root.querySelector('ui-alert-dialog').hide();
    root.remove();
  });

  // Same finding-8 gap, and worse here: this dialog blocks Escape and demands
  // an explicit choice, so an unnamed one traps the user in something they
  // cannot identify.
  test('a title-less alert dialog still gets an accessible name', async () => {
    const root = await mount(html`
      <ui-alert-dialog>
        <ui-alert-dialog-content><div>Bare content, no title node.</div></ui-alert-dialog-content>
      </ui-alert-dialog>
    `);
    root.querySelector('ui-alert-dialog').show();
    await tick();
    await tick();
    const panel = root.querySelector('dialog[data-slot="alert-dialog-native"]');
    assert.equal(panel.hasAttribute('aria-labelledby'), false, 'nothing to point at');
    assert.equal(panel.getAttribute('aria-label'), 'Alert dialog', 'generic name as the floor');
    root.querySelector('ui-alert-dialog').hide();
    root.remove();
  });

  // Same precedence bug as dialog: the forwarding set aria-label and the title
  // wiring then added an aria-labelledby that outranks it per accname.
  test('an authored name beats a title node on the alert dialog too', async () => {
    const root = await mount(html`
      <ui-alert-dialog>
        <ui-alert-dialog-content aria-label="Confirm deletion">
          <h2 data-slot="alert-dialog-title">Some other title</h2>
          <p data-slot="alert-dialog-description">This cannot be undone.</p>
        </ui-alert-dialog-content>
      </ui-alert-dialog>
    `);
    const dlg = root.querySelector('ui-alert-dialog');
    try {
      dlg.show();
      await tick();
      await tick();
      const panel = root.querySelector('dialog[data-slot="alert-dialog-native"]');
      const desc = root.querySelector('[data-slot="alert-dialog-description"]');
      assert.equal(panel.getAttribute('aria-label'), 'Confirm deletion');
      assert.equal(
        panel.hasAttribute('aria-labelledby'),
        false,
        'nothing outranks the author name',
      );
      assert.equal(panel.getAttribute('aria-describedby'), desc.id, 'description still wired');
    } finally {
      dlg.hide();
      root.remove();
    }
  });

  test('an authored aria-label on the alert content host reaches the panel', async () => {
    const root = await mount(html`
      <ui-alert-dialog>
        <ui-alert-dialog-content aria-label="Confirm deletion">
          <div>Bare content, no title node.</div>
        </ui-alert-dialog-content>
      </ui-alert-dialog>
    `);
    root.querySelector('ui-alert-dialog').show();
    await tick();
    await tick();
    const panel = root.querySelector('dialog[data-slot="alert-dialog-native"]');
    assert.equal(panel.getAttribute('aria-label'), 'Confirm deletion', 'author name forwarded');
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
        <ui-hover-card-trigger><a href="#hc-u">@vivek</a></ui-hover-card-trigger>
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

  // Finding 6a: the content rendered role="dialog" and nothing ever named it.
  // role="dialog" REQUIRES a name, so an unnamed one is an ARIA defect. Each
  // assertion below is the counterfactual for one rung of the fallback chain.
  test('unnamed card falls back to the trigger for its dialog name', async () => {
    const root = await mount(html`
      <ui-hover-card>
        <ui-hover-card-trigger><a href="#hc-u">@vivek</a></ui-hover-card-trigger>
        <ui-hover-card-content>Just prose, no title node.</ui-hover-card-content>
      </ui-hover-card>
    `);
    const link = root.querySelector('ui-hover-card-trigger a');
    const content = root.querySelector('ui-hover-card-content [role="dialog"]');
    assert.ok(link.id, 'trigger got an id to point at');
    assert.equal(content.getAttribute('aria-labelledby'), link.id, 'named by the trigger');
    root.remove();
  });

  test('a title node inside the card names it in preference to the trigger', async () => {
    const root = await mount(html`
      <ui-hover-card>
        <ui-hover-card-trigger><a href="#hc-u">@vivek</a></ui-hover-card-trigger>
        <ui-hover-card-content>
          <div data-slot="hover-card-title">Vivek Khandelwal</div>
        </ui-hover-card-content>
      </ui-hover-card>
    `);
    const title = root.querySelector('[data-slot="hover-card-title"]');
    const content = root.querySelector('ui-hover-card-content [role="dialog"]');
    assert.ok(title.id, 'title got an id');
    assert.equal(content.getAttribute('aria-labelledby'), title.id, 'named by the title');
    root.remove();
  });

  // Two bugs in one shape, both matching what dialog / alert-dialog were fixed
  // for. (a) precedence: this checked aria-label FIRST, the opposite of every
  // other component, so an author writing both got a different name here than in
  // a dialog. (b) staleness: _nameContent re-runs on every open change and its
  // fallback writes aria-labelledby unconditionally, so a card first named from
  // its title kept that reference, and it outranks a later authored aria-label.
  test('a later authored aria-label wins over the name from an earlier pass', async () => {
    const root = await mount(html`
      <ui-hover-card>
        <ui-hover-card-trigger><a href="#hc-u">@vivek</a></ui-hover-card-trigger>
        <ui-hover-card-content>
          <div data-slot="hover-card-title">Vivek Khandelwal</div>
        </ui-hover-card-content>
      </ui-hover-card>
    `);
    const card = root.querySelector('ui-hover-card');
    const contentHost = root.querySelector('ui-hover-card-content');
    const content = root.querySelector('ui-hover-card-content [role="dialog"]');
    // First pass names it from the title node.
    assert.ok(content.getAttribute('aria-labelledby'), 'named from the title initially');
    // Now the author supplies a name and the card re-opens, re-running the wiring.
    contentHost.setAttribute('aria-label', 'Profile summary');
    card.open = true;
    await tick();
    assert.equal(content.getAttribute('aria-label'), 'Profile summary', 'author name applied');
    assert.equal(
      content.hasAttribute('aria-labelledby'),
      false,
      'the stale title reference is gone, so it cannot outrank the author name',
    );
    card.open = false;
    root.remove();
  });

  test('aria-labelledby on the content host beats aria-label, as elsewhere', async () => {
    const root = await mount(html`
      <span id="hc-own-label">My own label</span>
      <ui-hover-card>
        <ui-hover-card-trigger><a href="#hc-u">@vivek</a></ui-hover-card-trigger>
        <ui-hover-card-content aria-label="Ignored" aria-labelledby="hc-own-label">
          Body
        </ui-hover-card-content>
      </ui-hover-card>
    `);
    const content = root.querySelector('ui-hover-card-content [role="dialog"]');
    assert.equal(content.getAttribute('aria-labelledby'), 'hc-own-label', 'labelledby wins');
    assert.equal(content.hasAttribute('aria-label'), false, 'and aria-label is not also set');
    root.remove();
  });

  // The documented contract is that the card stays open while focus is inside
  // it, which is what makes in-card content Tab-reachable. A mouseleave can
  // schedule the delayed close while a keyboard user still holds focus on an
  // in-card link, and closing then would pull the card out from under them.
  // Counterfactual: a close path that ignores focus closes the card here.
  test('the delayed close is refused while the card holds focus', async () => {
    const root = await mount(html`
      <ui-hover-card open-delay="0" close-delay="10">
        <ui-hover-card-trigger><a href="#hc-u" id="hc-t2">@vivek</a></ui-hover-card-trigger>
        <ui-hover-card-content><a href="#hc-p2" id="hc-i2">Read the posts</a></ui-hover-card-content>
      </ui-hover-card>
    `);
    const card = root.querySelector('ui-hover-card');
    const trigger = root.querySelector('#hc-t2');
    const inner = root.querySelector('#hc-i2');
    card.open = true;
    await tick();
    inner.focus();
    assert.equal(document.activeElement, inner, 'focus is inside the card');
    card.hide();
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(card.open, true, 'the card stayed open for the focus it holds');
    assert.equal(document.activeElement, inner, 'and focus was left exactly where it was');
    // Once focus genuinely leaves, the next scheduled close does go through.
    trigger.focus();
    card.hide();
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(card.open, false, 'closes once focus is no longer inside');
    root.remove();
  });

  test('an authored aria-label on the content host wins outright', async () => {
    const root = await mount(html`
      <ui-hover-card>
        <ui-hover-card-trigger><a href="#hc-u">@vivek</a></ui-hover-card-trigger>
        <ui-hover-card-content aria-label="Profile summary">
          <div data-slot="hover-card-title">Vivek Khandelwal</div>
        </ui-hover-card-content>
      </ui-hover-card>
    `);
    const content = root.querySelector('ui-hover-card-content [role="dialog"]');
    assert.equal(content.getAttribute('aria-label'), 'Profile summary');
    assert.equal(content.hasAttribute('aria-labelledby'), false, 'no competing name source');
    root.remove();
  });

  // Finding 6b + 6c. The card holds a link; the trigger closes the card on its
  // own focusout, so before the content's focusin/focusout linger the close was
  // already scheduled by the time focus could land inside, and the in-card link
  // was unreachable by keyboard. Escape then has to hand focus back, since
  // hiding a popover that holds focus drops it to <body>.
  async function mountHoverCard() {
    const root = await mount(html`
      <ui-hover-card open-delay="0" close-delay="20">
        <ui-hover-card-trigger><a href="#hc-u" id="hc-trigger">@vivek</a></ui-hover-card-trigger>
        <ui-hover-card-content>
          <a href="#hc-u-posts" id="hc-inner">Read the posts</a>
        </ui-hover-card-content>
      </ui-hover-card>
    `);
    return {
      root,
      card: root.querySelector('ui-hover-card'),
      trigger: root.querySelector('#hc-trigger'),
      inner: root.querySelector('#hc-inner'),
    };
  }

  test('focus moving into the card keeps it open past the close delay', async () => {
    const { root, card, trigger, inner } = await mountHoverCard();
    card.open = true;
    await tick();
    trigger.focus();
    await tick();
    // Tab from the trigger into the card, using real focus moves: the trigger's
    // focusout schedules the close, and the content's focusin must cancel it.
    inner.focus();
    // Wait out the close-delay window: an uncancelled close would land here.
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(card.open, true, 'card stayed open for the focused content');
    assert.equal(document.activeElement, inner, 'focus is on the in-card link');
    root.remove();
  });

  test('Escape dismisses the card and returns focus to the trigger', async () => {
    const { root, card, trigger, inner } = await mountHoverCard();
    card.open = true;
    await tick();
    inner.focus();
    assert.equal(document.activeElement, inner, 'focus starts inside the card');
    escape();
    await tick();
    assert.equal(card.open, false, 'Escape dismissed the card');
    assert.equal(document.activeElement, trigger, 'focus handed back to the trigger');
    root.remove();
  });

  test('Escape with focus outside the card closes it without moving focus', async () => {
    const { root, card } = await mountHoverCard();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    card.open = true;
    await tick();
    outside.focus();
    escape();
    await tick();
    assert.equal(card.open, false, 'card closed');
    assert.equal(document.activeElement, outside, 'focus left alone');
    outside.remove();
    root.remove();
  });

  test('a closed hover card does not consume Escape', async () => {
    const { root, card } = await mountHoverCard();
    assert.equal(card.open, false, 'starts closed');
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    await tick();
    assert.equal(ev.defaultPrevented, false, 'Escape left for someone else');
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

  // #1245: an ordinary toast carries NO role of its own. role="status" is
  // itself a live region, so it resolved under TWO nested live roots (measured
  // over CDP) and some readers double-announce that, while buying nothing:
  // the viewport is already polite. Asserting the ABSENCE of the attribute
  // matters more than it looks. The template branches the whole attribute
  // rather than emitting a nullish hole, because a nullish hole serves
  // role="" from the server renderer, and an empty role is not a role.
  test('an ordinary toast carries no role of its own, and no empty one', async () => {
    const root = await mount(html`<ui-sonner></ui-sonner>`);
    root.querySelector('ui-sonner').addToast('Saved', {});
    await tick();
    const toast = root.querySelector('[data-slot="sonner-toast"]');
    assert.ok(toast, 'the toast rendered');
    assert.equal(toast.hasAttribute('role'), false, 'no role attribute at all');
    assert.equal(toast.getAttribute('role'), null, 'and not an empty one');
    root.remove();
  });

  // Finding 7: render() emitted no close button, so a toast could only leave via
  // its auto-dismiss timer or a programmatic toast.dismiss(id). Counterfactual
  // for the close button: without it there is no [data-slot="sonner-close"] to
  // find and nothing a user can click.
  test('every toast ships a labelled close button that dismisses it', async () => {
    const root = await mount(html`<ui-sonner></ui-sonner>`);
    const sonner = root.querySelector('ui-sonner');
    sonner.addToast('Saved', {});
    await tick();
    const close = root.querySelector('[data-slot="sonner-close"]');
    assert.ok(close, 'a close button is rendered');
    assert.equal(close.getAttribute('aria-label'), 'Close notification', 'and it is labelled');
    assert.equal(close.tagName, 'BUTTON', 'and it is a real button');
    close.click();
    await tick();
    assert.equal(root.querySelector('[data-slot="sonner-toast"]'), null, 'clicking dismissed it');
    root.remove();
  });

  // The worst case the finding calls out: toast.loading() defaults to
  // duration 0, so before the close button it could not be dismissed from the
  // UI at all.
  test('a never-auto-dismissing loading toast can still be dismissed by hand', async () => {
    const root = await mount(html`<ui-sonner></ui-sonner>`);
    const sonner = root.querySelector('ui-sonner');
    sonner.addToast('Saving', {}, 'loading');
    await tick();
    const toastEl = root.querySelector('[data-slot="sonner-toast"]');
    assert.equal(toastEl.getAttribute('data-type'), 'loading', 'a loading toast');
    root.querySelector('[data-slot="sonner-close"]').click();
    await tick();
    assert.equal(root.querySelector('[data-slot="sonner-toast"]'), null, 'dismissed by hand');
    root.remove();
  });

  // The `cancel` option was documented in the JSDoc but absent from
  // ToastOptions and never rendered. Counterfactual: no cancel button exists
  // and onClick is never called.
  test('the documented cancel option renders and runs its onClick', async () => {
    const root = await mount(html`<ui-sonner></ui-sonner>`);
    const sonner = root.querySelector('ui-sonner');
    let cancelled = 0;
    sonner.addToast('Post deleted', { cancel: { label: 'Dismiss', onClick: () => cancelled++ } });
    await tick();
    const cancel = root.querySelector('[data-slot="sonner-cancel"]');
    assert.ok(cancel, 'cancel button rendered');
    assert.equal(cancel.textContent.trim(), 'Dismiss', 'carries the given label');
    cancel.click();
    await tick();
    assert.equal(cancelled, 1, 'onClick ran');
    assert.equal(root.querySelector('[data-slot="sonner-toast"]'), null, 'and it dismissed');
    root.remove();
  });

  test('action and cancel can coexist on one toast', async () => {
    const root = await mount(html`<ui-sonner></ui-sonner>`);
    const sonner = root.querySelector('ui-sonner');
    sonner.addToast('Post deleted', {
      action: { label: 'Undo', onClick: () => {} },
      cancel: { label: 'Dismiss', onClick: () => {} },
    });
    await tick();
    assert.ok(root.querySelector('[data-slot="sonner-action"]'), 'action rendered');
    assert.ok(root.querySelector('[data-slot="sonner-cancel"]'), 'cancel rendered');
    assert.ok(root.querySelector('[data-slot="sonner-close"]'), 'close still rendered');
    root.remove();
  });

  // Decorative icons must not be walked for a name, or a screen reader can
  // announce stray graphic nodes alongside the message.
  test('toast icons are aria-hidden', async () => {
    const root = await mount(html`<ui-sonner></ui-sonner>`);
    root.querySelector('ui-sonner').addToast('Saved', {}, 'success');
    await tick();
    const svgs = [...root.querySelectorAll('[data-slot="sonner-toast"] svg')];
    assert.ok(svgs.length > 0, 'there are icons to check');
    assert.ok(
      svgs.every((s) => s.getAttribute('aria-hidden') === 'true'),
      'every toast icon is aria-hidden',
    );
    root.remove();
  });
});
