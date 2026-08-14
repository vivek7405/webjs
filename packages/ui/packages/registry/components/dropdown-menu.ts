/**
 * DropdownMenu: popover-style menu of actions. Tier-2. Hand-rolled
 * keyboard nav, focus management, and positioning (no Radix).
 *
 * APG pattern: https://www.w3.org/WAI/ARIA/apg/patterns/menu/
 *
 * shadcn parity:
 *   DropdownMenu              → <ui-dropdown-menu open>
 *   DropdownMenuTrigger       → <ui-dropdown-menu-trigger>
 *   DropdownMenuContent       → <ui-dropdown-menu-content side align side-offset align-offset>
 *   DropdownMenuItem          → <ui-dropdown-menu-item variant inset>
 *   DropdownMenuCheckboxItem  → <ui-dropdown-menu-item type="checkbox" checked>
 *   DropdownMenuRadioGroup    → <ui-dropdown-menu-group> wrapping
 *   DropdownMenuRadioItem     → <ui-dropdown-menu-item type="radio" value>
 *   DropdownMenuLabel         → <ui-dropdown-menu-label inset>
 *   DropdownMenuSeparator     → <ui-dropdown-menu-separator>
 *   DropdownMenuShortcut      → <ui-dropdown-menu-shortcut>
 *   DropdownMenuGroup         → <ui-dropdown-menu-group>
 *   DropdownMenuSub           → <ui-dropdown-menu-sub>
 *   DropdownMenuSubTrigger    → <ui-dropdown-menu-sub-trigger inset>
 *   DropdownMenuSubContent    → <ui-dropdown-menu-sub-content>
 *
 * Attributes on <ui-dropdown-menu>:
 *   `open`:  boolean (reflected). Open state.
 *
 * Attributes on <ui-dropdown-menu-content>:
 *   `side`:         "top" | "right" | "bottom" (default) | "left".
 *   `align`:        "start" (default) | "center" | "end".
 *   `side-offset`:  number, default 4. Pixels between trigger and content.
 *   `align-offset`: number, default 0. Pixels of cross-axis shift.
 *
 * Attributes on <ui-dropdown-menu-item>:
 *   `variant`: "default" (default) | "destructive".
 *   `inset`:   boolean. Adds left padding to align with checkbox / radio items.
 *   `type`:    omit (default) | "checkbox" | "radio".
 *   `checked`: boolean. Applies to checkbox / radio items.
 *   `value`:   string. Identifier for radio items.
 *   `data-disabled`: boolean. Skips keyboard focus and activation, dims the
 *                    item, and sets aria-disabled. Same attribute on a
 *                    <ui-dropdown-menu-sub-trigger> disables the submenu.
 *
 * Events:
 *   `ui-open-change` on <ui-dropdown-menu>: `{ detail: { open } }` after a transition.
 *   `ui-item-select` bubbled by an item on activation, CANCELABLE:
 *     `{ detail: { value, item, type, checked } }`. `checked` is the state the
 *     item has settled on, so a checkbox / radio listener reads it directly.
 *     Calling `preventDefault()` keeps the menu OPEN (the parity shape for
 *     shadcn's `onSelect={e => e.preventDefault()}`), which is what a
 *     multi-select checkbox menu wants.
 *
 * Programmatic API on <ui-dropdown-menu>: `.show()` · `.hide()` · `.toggle()`.
 *
 * Keyboard:
 *   ArrowUp / ArrowDown   move focus between items
 *   ArrowRight            on a sub-trigger: open submenu, focus first item
 *   ArrowLeft             inside a submenu: close it, refocus the sub-trigger
 *   Home / End            first / last item
 *   Enter / Space         activate focused item
 *   Escape                close the menu that holds focus (a submenu first,
 *                         refocusing its sub-trigger) and refocus the trigger
 *   Tab                   close menu and proceed with normal tab order
 *
 * Design: A menu holds actions, not navigation and not settings, and it holds the ones
 * too numerous or too rare to sit on the surface. If there are two actions, put
 * them on the surface as buttons instead, because a menu costs a click and hides
 * what is available. Group with separators when there are more than about five,
 * and put anything destructive at the bottom behind a separator so it is not
 * adjacent to something routine.
 *
 * A11y (owned by the element, nothing to supply):
 *   The trigger gets `aria-haspopup` / `aria-expanded` / `aria-controls`, the
 *   panel is a `role="menu"` labelled back by the trigger, and a disabled item
 *   reflects `aria-disabled`. EVERY close path leaves focus somewhere sensible
 *   rather than dropping it to `<body>`: Escape, Tab, and item activation
 *   return focus to the trigger, and so does an outside click that did not put
 *   focus anywhere itself. An outside click ON another control leaves focus on
 *   that control, since the user chose it.
 *   A `type="checkbox"` / `type="radio"` item carries
 *   `role="menuitemcheckbox"` / `role="menuitemradio"` plus `aria-checked`.
 *   What you DO supply: a name for a radio set, as `aria-label` on the
 *   enclosing `<ui-dropdown-menu-group>` (APG asks a menuitemradio set to sit
 *   in a labelled group; the group forwards the name onto its `role="group"`).
 *   Put it in the MARKUP. The group declares no reactive props, so it renders
 *   once and its `aria-label` / `aria-labelledby` are not observed attributes: a
 *   name set on the host after mount is never picked up.
 *
 * Design tokens used: --popover, --popover-foreground, --accent,
 * --accent-foreground, --destructive, --muted-foreground, --border.
 *
 * @example
 * ```html
 * <ui-dropdown-menu>
 *   <ui-dropdown-menu-trigger>
 *     <button class=${buttonClass({ variant: 'outline' })}>Options</button>
 *   </ui-dropdown-menu-trigger>
 *   <ui-dropdown-menu-content align="end">
 *     <ui-dropdown-menu-label>My Account</ui-dropdown-menu-label>
 *     <ui-dropdown-menu-separator></ui-dropdown-menu-separator>
 *     <ui-dropdown-menu-item>Profile</ui-dropdown-menu-item>
 *     <ui-dropdown-menu-sub>
 *       <ui-dropdown-menu-sub-trigger>Invite users</ui-dropdown-menu-sub-trigger>
 *       <ui-dropdown-menu-sub-content>
 *         <ui-dropdown-menu-item>Email</ui-dropdown-menu-item>
 *       </ui-dropdown-menu-sub-content>
 *     </ui-dropdown-menu-sub>
 *     <ui-dropdown-menu-separator></ui-dropdown-menu-separator>
 *     <ui-dropdown-menu-item variant="destructive">Sign out</ui-dropdown-menu-item>
 *   </ui-dropdown-menu-content>
 * </ui-dropdown-menu>
 *
 * <!-- Checkbox items. Read the new state off the event's detail.checked. -->
 * <ui-dropdown-menu @ui-item-select=${onSelect}>
 *   <ui-dropdown-menu-trigger>
 *     <button class=${buttonClass({ variant: 'outline' })}>View</button>
 *   </ui-dropdown-menu-trigger>
 *   <ui-dropdown-menu-content>
 *     <ui-dropdown-menu-item type="checkbox" value="status" checked>
 *       Status bar
 *     </ui-dropdown-menu-item>
 *     <ui-dropdown-menu-item type="checkbox" value="activity">
 *       Activity bar
 *     </ui-dropdown-menu-item>
 *   </ui-dropdown-menu-content>
 * </ui-dropdown-menu>
 *
 * <!-- A multi-select menu cancels the event so the menu stays open:
 *      const onSelect = (e) => { e.preventDefault(); save(e.detail); };  -->
 *
 * <!-- Radio items: one checked per group. Name the set on the group. -->
 * <ui-dropdown-menu>
 *   <ui-dropdown-menu-trigger>
 *     <button class=${buttonClass({ variant: 'outline' })}>Panel</button>
 *   </ui-dropdown-menu-trigger>
 *   <ui-dropdown-menu-content>
 *     <ui-dropdown-menu-group aria-label="Panel position">
 *       <ui-dropdown-menu-item type="radio" value="top" checked>Top</ui-dropdown-menu-item>
 *       <ui-dropdown-menu-item type="radio" value="bottom">Bottom</ui-dropdown-menu-item>
 *       <ui-dropdown-menu-item type="radio" value="right">Right</ui-dropdown-menu-item>
 *     </ui-dropdown-menu-group>
 *   </ui-dropdown-menu-content>
 * </ui-dropdown-menu>
 * ```
 */
import { WebComponent, html, unsafeHTML, signal, prop } from '@webjsdev/core';
import { ensureId } from '../lib/utils.ts';
import { onBeforeCache } from '../lib/dom.ts';
import { positionFloating, type PopoverSide, type PopoverAlign } from './popover.ts';

// --------------------------------------------------------------------------
// Class helpers
// --------------------------------------------------------------------------

export const dropdownMenuContentClass = (): string =>
  'fixed z-50 max-h-[--available-height] min-w-[8rem] m-0 overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-e2';

export const dropdownMenuItemClass = (): string =>
  "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:hover:bg-destructive/10 data-[variant=destructive]:hover:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 dark:data-[variant=destructive]:hover:bg-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

export const dropdownMenuCheckboxItemClass = (): string =>
  "relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0";

export const dropdownMenuRadioItemClass = (): string =>
  "relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8";

export const dropdownMenuLabelClass = (): string =>
  'px-2 pt-2 pb-1.5 text-xs font-semibold text-muted-foreground data-[inset]:pl-8';

export const dropdownMenuSeparatorClass = (): string => '-mx-1 my-1 h-px bg-border';

export const dropdownMenuShortcutClass = (): string =>
  'ml-auto text-xs tracking-widest text-muted-foreground';

export const dropdownMenuSubTriggerClass = (): string =>
  "flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm select-none outline-hidden focus:bg-accent focus:text-accent-foreground hover:bg-accent hover:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&>svg:last-child]:ml-auto";

export const dropdownMenuSubContentClass = (): string =>
  'fixed z-50 min-w-[8rem] m-0 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-e2';

const CHEVRON_RIGHT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ml-auto size-4" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>';

// Checked-state indicators for a checkbox / radio item. Decorative: the state
// they draw is announced from aria-checked, so both are aria-hidden.
const CHECK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-4" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';

const RADIO_DOT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-2" aria-hidden="true"><circle cx="12" cy="12" r="12"></circle></svg>';

const SUB_CLOSE_DELAY = 200;

// Every role a focusable menu item can carry. A checkbox / radio item is NOT
// role="menuitem", so a bare [role="menuitem"] query silently skips it and the
// item drops out of arrow nav, typeahead, and the focus-first-item-on-open.
const MENU_ITEM = ':is([role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"])';
const ENABLED_MENU_ITEM = `${MENU_ITEM}:not([data-disabled])`;

// --------------------------------------------------------------------------
// <ui-dropdown-menu>
// --------------------------------------------------------------------------

export class UiDropdownMenu extends WebComponent({
  open: prop(Boolean, { reflect: true }),
}) {
  _typeBuffer = '';
  _typeBufferTimer: number | undefined;

  _docClickHandler = (e: MouseEvent): void => this._onDocClick(e);
  _docPointerDownHandler = (e: Event): void => this._onDocPointerDown(e);
  _keyHandler = (e: KeyboardEvent): void => this._onKeyDown(e);
  _resizeHandler = (): void => this._reposition();

  constructor() {
    super();
    this.open = false;
  }

  _disposeBeforeCache?: () => void;

  disconnectedCallback(): void {
    if (this.open) this._teardown();
    this._disposeBeforeCache?.();
    super.disconnectedCallback?.();
  }

  toggle(): void { this.open = !this.open; }
  show(): void { this.open = true; }
  hide(): void { this.open = false; }

  // APG Menu Button requires Escape, Tab, item activation, AND an outside-click
  // dismiss to close the menu without stranding focus. Without this, focus is
  // sitting on an item inside a popover="manual" panel, so hiding the panel
  // drops focus to <body> and a keyboard user loses their place entirely.
  //
  // The restore is GUARDED, because an outside click that deliberately moved
  // focus to another control must not have focus yanked back to the trigger.
  //
  // Focus moves BEFORE the panel hides. Hiding a popover whose descendant
  // holds focus makes the engine run its own focus fixup, and moving out
  // first means the trigger is the final focus rather than a target the
  // fixup then overrides.
  _closeAndRestoreFocus(): void {
    if (this._focusIsInside()) this._triggerControl()?.focus();
    this.hide();
  }

  _focusIsInside(): boolean {
    if (typeof document === 'undefined') return false;
    const active = document.activeElement;
    if (!active || active === document.body) return false;
    return this.contains(active);
  }

  render() {
    return html`<div data-slot="dropdown-menu" data-state=${this.open ? 'open' : 'closed'}>
      <slot></slot>
    </div>`;
  }

  updated(changedProperties: Map<string, unknown>): void {
    if (!changedProperties.has('open')) return;
    if (changedProperties.get('open') === undefined) return;
    // Wait one microtask for <ui-dropdown-menu-content>'s [popover] to commit.
    queueMicrotask(() => this._afterRender());
  }

  connectedCallback(): void {
    super.connectedCallback?.();
    // webjs projects slotted light-DOM children in a pass after the first
    // render, so the trigger button and the menu are not in place at
    // connect. Defer to the next frame, when the projection has run.
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => this._wireAria());
    }
    // Close (and tear down) before a back/forward snapshot so the menu does not
    // restore open (#766). Closing the root also hides any open submenu.
    this._disposeBeforeCache = onBeforeCache(() => { this.open = false; });
  }

  _afterRender(): void {
    const content = this._content();
    if (content) {
      this._syncContentPopover(content);
    }
    this._wireAria();
    if (this.open) this._setup();
    else this._teardown();
  }

  // The trigger wraps an author-supplied control (usually a <button>). Expose
  // the menu relationship on that focusable control: aria-haspopup announces
  // it opens a menu, aria-expanded tracks open state, aria-controls points at
  // the menu, and the menu is labelled back by the trigger. Done at runtime
  // because the menu is JS-driven (never shown without script).
  _triggerControl(): HTMLElement | null {
    const trigger = this.querySelector('ui-dropdown-menu-trigger');
    if (!trigger) return null;
    return (
      trigger.querySelector<HTMLElement>('button, [role="button"], a[href], [tabindex]') ??
      (trigger as HTMLElement)
    );
  }

  _menuEl(): HTMLElement | null {
    return this.querySelector('ui-dropdown-menu-content [role="menu"]');
  }

  _wireAria(): void {
    const control = this._triggerControl();
    if (!control) return;
    control.setAttribute('aria-haspopup', 'menu');
    control.setAttribute('aria-expanded', String(this.open));
    const menu = this._menuEl();
    if (!menu) return;
    const menuId = ensureId(menu, 'ui-menu');
    control.setAttribute('aria-controls', menuId);
    if (!menu.hasAttribute('aria-label') && !menu.hasAttribute('aria-labelledby')) {
      menu.setAttribute('aria-labelledby', ensureId(control, 'ui-menu-trigger'));
    }
    this._wireSubmenuAria();
  }

  // A SUBMENU is a role="menu" too, and APG asks for it to be labelled by the
  // menuitem that opens it, with that menuitem pointing back via aria-controls.
  // Only the root panel was wired, so every submenu shipped as an unnamed menu.
  _wireSubmenuAria(): void {
    this.querySelectorAll<HTMLElement>('ui-dropdown-menu-sub').forEach((sub) => {
      // NOT `:scope >`: the sub renders its own wrapper div with a <slot>, so the
      // trigger and content are grandchildren, not direct children. Match on the
      // nearest enclosing sub instead, which also keeps a NESTED submenu's nodes
      // from being wired to its outer sub.
      const owns = (el: Element | null): boolean =>
        !!el && el.closest('ui-dropdown-menu-sub') === sub;
      const trigger = Array.from(
        sub.querySelectorAll<HTMLElement>(`ui-dropdown-menu-sub-trigger ${MENU_ITEM}`),
      ).find((el) => owns(el.closest('ui-dropdown-menu-sub-trigger')));
      const panel = Array.from(
        sub.querySelectorAll<HTMLElement>('ui-dropdown-menu-sub-content [role="menu"]'),
      ).find((el) => owns(el.closest('ui-dropdown-menu-sub-content')));
      if (!trigger || !panel) return;
      trigger.setAttribute('aria-controls', ensureId(panel, 'ui-submenu'));
      if (!panel.hasAttribute('aria-label') && !panel.hasAttribute('aria-labelledby')) {
        panel.setAttribute('aria-labelledby', ensureId(trigger, 'ui-submenu-trigger'));
      }
    });
  }

  _content(): HTMLElement | null {
    return this.querySelector('ui-dropdown-menu-content [popover]');
  }

  _syncContentPopover(content: HTMLElement): void {
    const p = content as HTMLElement & {
      showPopover?: () => void;
      hidePopover?: () => void;
      matches: (s: string) => boolean;
    };
    if (typeof p.showPopover !== 'function') return;
    if (this.open && !p.matches(':popover-open')) p.showPopover();
    else if (!this.open && p.matches(':popover-open')) p.hidePopover();
  }

  _reposition(): void {
    const trigger = this.querySelector<HTMLElement>('ui-dropdown-menu-trigger');
    const content = this._content();
    const host = this.querySelector<HTMLElement>('ui-dropdown-menu-content');
    if (!trigger || !content || !host) return;
    positionFloating(trigger, content, {
      side: (host.getAttribute('side') ?? 'bottom') as PopoverSide,
      align: (host.getAttribute('align') ?? 'start') as PopoverAlign,
      sideOffset: Number(host.getAttribute('side-offset') ?? 4),
      alignOffset: Number(host.getAttribute('align-offset') ?? 0),
    });
  }

  _setup(): void {
    this._reposition();
    document.addEventListener('pointerdown', this._docPointerDownHandler, true);
    document.addEventListener('click', this._docClickHandler);
    document.addEventListener('keydown', this._keyHandler);
    window.addEventListener('resize', this._resizeHandler);
    window.addEventListener('scroll', this._resizeHandler, true);
    queueMicrotask(() => {
      const first = this.querySelector<HTMLElement>(
        `ui-dropdown-menu-item:not([data-disabled]) ${MENU_ITEM}`,
      );
      first?.focus();
    });
  }

  _teardown(): void {
    document.removeEventListener('pointerdown', this._docPointerDownHandler, true);
    document.removeEventListener('click', this._docClickHandler);
    document.removeEventListener('keydown', this._keyHandler);
    this._focusWasInsideAtPointerDown = false;
    window.removeEventListener('resize', this._resizeHandler);
    window.removeEventListener('scroll', this._resizeHandler, true);
    this.querySelectorAll<UiDropdownMenuSub>('ui-dropdown-menu-sub[open]').forEach(
      (sub) => sub.hide(),
    );
  }

  // Sampled on POINTERDOWN, before the browser moves focus for the click. By
  // the time the click handler runs, a click on a non-focusable area has often
  // already blurred the focused menu item to <body>, so a check made there
  // cannot tell "clicked away from everything" (focus should go back to the
  // trigger) from "clicked another control" (leave focus where the user put it).
  _focusWasInsideAtPointerDown = false;

  _onDocPointerDown(e: Event): void {
    if (!this.open) return;
    if (e.composedPath().some((n) => n === this)) return;
    this._focusWasInsideAtPointerDown = this._focusIsInside();
  }

  _onDocClick(e: MouseEvent): void {
    if (!this.open) return;
    if (e.composedPath().some((n) => n === this)) return;
    // An outside click dismisses the menu, and it is still a close of a
    // popover="manual" panel, so it owes the same focus care as Escape: leaving
    // focus on an item that is about to become display:none drops it to <body>.
    // Restore only when the click did not land focus somewhere itself.
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    const clickTookFocus = !!active && active !== document.body && !this.contains(active);
    if (this._focusWasInsideAtPointerDown && !clickTookFocus) {
      this._triggerControl()?.focus();
    }
    this._focusWasInsideAtPointerDown = false;
    this.hide();
  }

  _onKeyDown(e: KeyboardEvent): void {
    if (!this.open) return;

    // Active context = nearest content / sub-content panel owning focus.
    // Scoping arrow nav avoids walking into siblings of a different submenu.
    // Computed before Escape / Tab because both need to know which panel holds
    // focus, and neither may bail when focus is outside the menu entirely.
    const active = document.activeElement as HTMLElement | null;
    const context = active?.closest('[role="menu"]') as HTMLElement | null;

    if (e.key === 'Escape') {
      e.preventDefault();
      // APG: Escape closes the menu that CONTAINS focus and returns focus to
      // whatever opened it. Inside a submenu panel that is the submenu and its
      // sub-trigger, so the root menu stays open (the JSDoc's "close current
      // submenu first"). Focus on the sub-trigger itself is focus in the ROOT
      // panel, so that case closes the whole menu, which is why this reads the
      // panel rather than walking up to any open <ui-dropdown-menu-sub>.
      const subContent = context?.closest('ui-dropdown-menu-sub-content');
      const sub = subContent?.closest('ui-dropdown-menu-sub') as UiDropdownMenuSub | null;
      if (sub) {
        sub.querySelector<HTMLElement>(`ui-dropdown-menu-sub-trigger ${MENU_ITEM}`)?.focus();
        sub.hide();
        return;
      }
      this._closeAndRestoreFocus();
      return;
    }

    if (e.key === 'Tab') {
      // JSDoc contract: Tab closes the menu and proceeds with the normal tab
      // order, so the default is deliberately NOT prevented. Focus is restored
      // to the trigger first because the items are tabindex="-1" inside a
      // top-layer panel that is about to be display:none, so tabbing onward
      // from there has no sensible next element. Moving to the trigger (which
      // IS in the tab sequence) means the browser's own Tab then advances to
      // the element after it, which is what APG asks for.
      this._closeAndRestoreFocus();
      return;
    }

    if (!context) return;

    const items = Array.from(
      context.querySelectorAll<HTMLElement>(ENABLED_MENU_ITEM),
    ).filter((it) => it.closest('[role="menu"]') === context);
    if (items.length === 0) return;
    const idx = active ? items.indexOf(active) : -1;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(idx + 1) % items.length].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length].focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0].focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1].focus();
    } else if (e.key === 'ArrowRight') {
      // Open submenu owned by the focused sub-trigger and move focus into it.
      const subTrigger = active?.closest('ui-dropdown-menu-sub-trigger');
      if (subTrigger) {
        e.preventDefault();
        const sub = subTrigger.closest('ui-dropdown-menu-sub') as UiDropdownMenuSub | null;
        // The sub owns the open-then-focus sequencing: its panel is
        // popover="manual" and only becomes visible a microtask later, so
        // focusing from here races the reveal and loses (see the method).
        sub?.openAndFocusFirstItem();
      }
    } else if (e.key === 'ArrowLeft') {
      // Inside a sub-content: close the submenu and refocus its trigger.
      if (context.closest('ui-dropdown-menu-sub-content')) {
        e.preventDefault();
        const sub = context.closest('ui-dropdown-menu-sub') as UiDropdownMenuSub | null;
        const trigger = sub?.querySelector<HTMLElement>(
          `ui-dropdown-menu-sub-trigger ${MENU_ITEM}`,
        );
        trigger?.focus();
        sub?.hide();
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      // A menu item is a <div role="menuitem">, and a div gets NO native
      // activation, so Enter / Space have to be synthesized here. Without this
      // the keyboard cannot activate any item at all, and a checkable item,
      // whose ONLY state transition is activation, cannot be toggled.
      //
      // Activation applies to a MENU ITEM only. A control the author slotted
      // into the panel (a filter input, a plain button) is inside [role="menu"]
      // too, so preventing Space unconditionally would swallow it there with
      // nothing to handle it, and the user could not type a space into their own
      // input. Bail before touching the event when the focus is not an item.
      const subTrigger = active?.closest('ui-dropdown-menu-sub-trigger');
      const activeItem = active?.closest('ui-dropdown-menu-item') as UiDropdownMenuItem | null;
      if (!subTrigger && !activeItem) return;
      // Space while a typeahead search is in flight belongs to the SEARCH, or a
      // multi-word item is unreachable past its first word ("Status bar" could
      // never be disambiguated from "Status line"). Radix draws the same line.
      // Enter always activates.
      if (e.key === ' ' && this._typeBuffer) {
        this._typeahead(e, items);
        return;
      }
      // Space otherwise MUST be prevented, or it falls through to typeahead,
      // matches nothing, and scrolls the page underneath the open menu.
      e.preventDefault();
      if (subTrigger) {
        // Same as ArrowRight on a sub-trigger: open it and move focus in.
        if (!subTrigger.hasAttribute('data-disabled')) {
          const sub = subTrigger.closest('ui-dropdown-menu-sub') as UiDropdownMenuSub | null;
          sub?.openAndFocusFirstItem();
        }
        return;
      }
      if (activeItem && !activeItem.hasAttribute('data-disabled')) activeItem._select();
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      this._typeahead(e, items);
    }
  }

  _typeahead(e: KeyboardEvent, items: HTMLElement[]): void {
    this._typeBuffer = (this._typeBuffer + e.key).toLowerCase();
    clearTimeout(this._typeBufferTimer);
    this._typeBufferTimer = window.setTimeout(() => { this._typeBuffer = ''; }, 500);
    const buffer = this._typeBuffer;
    const match = items.find((it) => {
      const text = (it.getAttribute('text-value') ?? it.textContent ?? '').trim().toLowerCase();
      return text.startsWith(buffer);
    });
    if (match) {
      e.preventDefault();
      match.focus();
    }
  }
}
UiDropdownMenu.register('ui-dropdown-menu');

// --------------------------------------------------------------------------
// <ui-dropdown-menu-trigger>
// --------------------------------------------------------------------------

export class UiDropdownMenuTrigger extends WebComponent {
  render() {
    return html`<div
      data-slot="dropdown-menu-trigger"
      @click=${this._onClick}
    ><slot></slot></div>`;
  }

  _onClick = (): void => (this.closest('ui-dropdown-menu') as UiDropdownMenu | null)?.toggle();
}
UiDropdownMenuTrigger.register('ui-dropdown-menu-trigger');

// --------------------------------------------------------------------------
// <ui-dropdown-menu-content>
// --------------------------------------------------------------------------

export class UiDropdownMenuContent extends WebComponent {
  render() {
    return html`<div
      data-slot="dropdown-menu-content"
      role="menu"
      aria-orientation="vertical"
      popover="manual"
      class=${dropdownMenuContentClass()}
    ><slot></slot></div>`;
  }
}
UiDropdownMenuContent.register('ui-dropdown-menu-content');

// --------------------------------------------------------------------------
// <ui-dropdown-menu-item>
// --------------------------------------------------------------------------

export class UiDropdownMenuItem extends WebComponent({
  variant: prop<'default' | 'destructive'>(String, { reflect: true }),
  inset: Boolean,
  // `type` is read from the authored attribute and never written back: an
  // unreflected default keeps a plain item's markup free of a type="" that
  // means nothing. `checked` reflects so the state is readable and settable
  // as an attribute, the same contract <ui-toggle>'s `pressed` has.
  type: prop<'' | 'checkbox' | 'radio'>(String),
  checked: prop(Boolean, { reflect: true }),
  value: prop(String, { reflect: true }),
}) {
  // Keyboard / pointer highlight state for the own-rendered menuitem. A
  // local signal bound with ?data-highlighted keeps the highlight in the
  // declarative template instead of an imperative setAttribute on
  // e.currentTarget (the lit-idiomatic form).
  #highlighted = signal(false);

  constructor() {
    super();
    this.variant = 'default';
    this.inset = false;
    this.type = '';
    this.checked = false;
    this.value = '';
  }

  render() {
    // `data-disabled` on the host is the historical disabled marker (focus
    // skips it, the click / pointer handlers bail on it). Mirror it onto the
    // inner menuitem as both data-disabled (CSS) and aria-disabled, so the
    // state also reaches assistive tech.
    const disabled = typeof this.hasAttribute === 'function' && this.hasAttribute('data-disabled');
    const checkbox = this.type === 'checkbox';
    const radio = this.type === 'radio';
    // The role is what tells a screen reader this is a checkable control at
    // all, and aria-checked is what carries the state. Neither belongs on a
    // plain item, where aria-checked is not an allowed attribute.
    //
    // Hence TWO templates rather than one with conditional holes: a null hole
    // does NOT omit an attribute on the server (the server renderer
    // stringifies the value), so a single template would ship every plain item
    // as `role="menuitem" aria-checked="" data-state=""`, carrying the exact
    // disallowed attribute this branch exists to keep off it, and disagreeing
    // with the hydrated DOM where the client renderer removes it. The two
    // shapes differ by the indicator anyway.
    if (checkbox || radio) {
      return html`<div
        data-slot=${`dropdown-menu-${this.type}-item`}
        role=${checkbox ? 'menuitemcheckbox' : 'menuitemradio'}
        tabindex="-1"
        data-variant=${this.variant}
        ?data-inset=${this.inset}
        ?data-disabled=${disabled}
        aria-disabled=${disabled ? 'true' : 'false'}
        aria-checked=${String(this.checked)}
        data-state=${this.checked ? 'checked' : 'unchecked'}
        ?data-highlighted=${this.#highlighted.get()}
        class=${checkbox ? dropdownMenuCheckboxItemClass() : dropdownMenuRadioItemClass()}
        @click=${this._onClick}
        @pointerenter=${this._onPointerEnter}
        @focus=${this._onFocus}
        @blur=${this._onBlur}
      ><span
        class="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center"
      >${this.checked ? unsafeHTML(radio ? RADIO_DOT_SVG : CHECK_SVG) : ''}</span><slot></slot></div>`;
    }
    return html`<div
      data-slot="dropdown-menu-item"
      role="menuitem"
      tabindex="-1"
      data-variant=${this.variant}
      ?data-inset=${this.inset}
      ?data-disabled=${disabled}
      aria-disabled=${disabled ? 'true' : 'false'}
      ?data-highlighted=${this.#highlighted.get()}
      class=${dropdownMenuItemClass()}
      @click=${this._onClick}
      @pointerenter=${this._onPointerEnter}
      @focus=${this._onFocus}
      @blur=${this._onBlur}
    ><slot></slot></div>`;
  }

  _onClick = (e: Event): void => {
    const el = e.currentTarget as HTMLElement;
    if (el.hasAttribute('data-disabled')) return;
    this._select();
  };

  // Activation: flip checkbox / radio state, announce the selection, then
  // close. The event is cancelable, so a listener calling preventDefault()
  // keeps the menu open, which is the parity shape for Radix's
  // onSelect(e => e.preventDefault()) that a multi-select menu relies on.
  _select(): void {
    if (this.type === 'checkbox') this.checked = !this.checked;
    else if (this.type === 'radio') this._selectRadio();
    const proceed = this.dispatchEvent(
      new CustomEvent('ui-item-select', {
        detail: { value: this.value, item: this, type: this.type, checked: this.checked },
        bubbles: true,
        cancelable: true,
      }),
    );
    if (!proceed) return;
    (this.closest('ui-dropdown-menu') as UiDropdownMenu | null)?._closeAndRestoreFocus();
  }

  // The radio set is the nearest <ui-dropdown-menu-group>, which is the APG
  // grouping element for menuitemradio, falling back to the panel so an
  // ungrouped set still behaves like one set rather than N independent items.
  _radioScope(): Element | null {
    if (typeof this.closest !== 'function') return null;
    return (
      this.closest('ui-dropdown-menu-group') ??
      this.closest('ui-dropdown-menu-sub-content') ??
      this.closest('ui-dropdown-menu-content')
    );
  }

  _selectRadio(): void {
    const scope = this._radioScope();
    if (!scope) {
      this.checked = true;
      return;
    }
    // Filter on the PROPERTY, not a [type="radio"] attribute selector: `type`
    // is unreflected, so an item configured through the property alone would
    // be invisible to an attribute query and survive as a second checked item.
    // The scope re-check keeps a nested group's items out of this set.
    Array.from(scope.querySelectorAll<UiDropdownMenuItem>('ui-dropdown-menu-item'))
      .filter((it) => it.type === 'radio' && it._radioScope() === scope)
      .forEach((it) => {
        it.checked = it === this;
      });
  }

  _onPointerEnter = (e: Event): void => {
    const el = e.currentTarget as HTMLElement;
    if (el.hasAttribute('data-disabled')) return;
    el.focus();
  };

  _onFocus = (): void => {
    this.#highlighted.set(true);
  };

  _onBlur = (): void => {
    this.#highlighted.set(false);
  };
}
UiDropdownMenuItem.register('ui-dropdown-menu-item');

// --------------------------------------------------------------------------
// <ui-dropdown-menu-label>
// --------------------------------------------------------------------------

export class UiDropdownMenuLabel extends WebComponent({ inset: Boolean }) {
  constructor() {
    super();
    this.inset = false;
  }

  render() {
    return html`<div
      data-slot="dropdown-menu-label"
      ?data-inset=${this.inset}
      class=${dropdownMenuLabelClass()}
    ><slot></slot></div>`;
  }
}
UiDropdownMenuLabel.register('ui-dropdown-menu-label');

// --------------------------------------------------------------------------
// <ui-dropdown-menu-separator>
// --------------------------------------------------------------------------

export class UiDropdownMenuSeparator extends WebComponent {
  render() {
    return html`<div
      data-slot="dropdown-menu-separator"
      role="separator"
      class=${dropdownMenuSeparatorClass()}
    ></div>`;
  }
}
UiDropdownMenuSeparator.register('ui-dropdown-menu-separator');

// --------------------------------------------------------------------------
// <ui-dropdown-menu-shortcut>
// --------------------------------------------------------------------------

export class UiDropdownMenuShortcut extends WebComponent {
  render() {
    return html`<span
      data-slot="dropdown-menu-shortcut"
      class=${dropdownMenuShortcutClass()}
    ><slot></slot></span>`;
  }
}
UiDropdownMenuShortcut.register('ui-dropdown-menu-shortcut');

// --------------------------------------------------------------------------
// <ui-dropdown-menu-group>
// --------------------------------------------------------------------------

export class UiDropdownMenuGroup extends WebComponent {
  // role="group", NOT role="radiogroup". radiogroup is the grouping role for
  // role="radio"; the grouping role ARIA specifies for menuitemradio is plain
  // group, so a radio set inside this element is already correctly grouped.
  render() {
    // The group carries the name of the set ("Sort by", "Panel position"), and
    // the name has to be on the element that holds role="group" to be exposed.
    // Forward it off the host so an author writes it where the tag is.
    //
    // Branched, not held in a null hole: a null hole does NOT omit an attribute
    // on the server, so an unnamed group would ship
    // `role="group" aria-label="" aria-labelledby=""`, an empty IDREF list and
    // an empty name on an element that simply has no name.
    const attr = (n: string): string | null =>
      typeof this.getAttribute === 'function' ? this.getAttribute(n) : null;
    const labelledBy = attr('aria-labelledby');
    const label = attr('aria-label');
    if (labelledBy) {
      return html`<div
        data-slot="dropdown-menu-group"
        role="group"
        aria-labelledby=${labelledBy}
      ><slot></slot></div>`;
    }
    if (label) {
      return html`<div
        data-slot="dropdown-menu-group"
        role="group"
        aria-label=${label}
      ><slot></slot></div>`;
    }
    return html`<div
      data-slot="dropdown-menu-group"
      role="group"
    ><slot></slot></div>`;
  }
}
UiDropdownMenuGroup.register('ui-dropdown-menu-group');

// --------------------------------------------------------------------------
// Submenu: Sub / SubTrigger / SubContent
// --------------------------------------------------------------------------

export class UiDropdownMenuSub extends WebComponent({
  open: prop(Boolean, { reflect: true }),
}) {
  _closeTimer: number | undefined;

  constructor() {
    super();
    this.open = false;
  }

  disconnectedCallback(): void {
    this._cancelClose();
    super.disconnectedCallback?.();
  }

  show(): void { this._cancelClose(); this.open = true; }
  hide(): void { this._cancelClose(); this.open = false; }
  toggle(): void { if (this.open) this.hide(); else this.show(); }

  // ArrowRight on a sub-trigger must open the submenu AND move focus to its
  // first item (APG, and what this component's JSDoc promises). The focus
  // cannot simply be queued next to show(): the panel is popover="manual" and
  // only becomes visible in _afterRender one microtask later, and focus() on a
  // still-display:none element is silently a no-op that nothing retries. So
  // record the intent and consume it once the panel is genuinely up.
  _focusFirstOnOpen = false;

  openAndFocusFirstItem(): void {
    this._focusFirstOnOpen = true;
    this.show();
    // Hover already opened it, so there is no open-change to ride on and
    // _afterRender will not run. The panel is up, so consume the intent now.
    if (this._panelIsOpen()) this._consumeFocusFirst();
  }

  _panelIsOpen(): boolean {
    const panel = this.querySelector<HTMLElement & { showPopover?: () => void }>(
      'ui-dropdown-menu-sub-content [popover]',
    );
    // Gate on showPopover, not just on matches, like the two sibling call sites.
    // `:popover-open` is an unknown pseudo-class where the Popover API is
    // absent, so matches() THROWS SyntaxError there. This runs synchronously
    // from the document keydown handler, so the throw would escape _onKeyDown
    // and take out all submenu keyboard handling on such an engine.
    if (!panel || typeof panel.showPopover !== 'function') return false;
    return typeof panel.matches === 'function' && panel.matches(':popover-open');
  }

  _consumeFocusFirst(): void {
    if (!this._focusFirstOnOpen) return;
    this._focusFirstOnOpen = false;
    this.querySelector<HTMLElement>(
      `ui-dropdown-menu-sub-content ${ENABLED_MENU_ITEM}`,
    )?.focus();
  }

  render() {
    return html`<div
      data-slot="dropdown-menu-sub"
      data-state=${this.open ? 'open' : 'closed'}
      @pointerenter=${this._cancelCloseHandler}
      @pointerleave=${this._scheduleCloseHandler}
    ><slot></slot></div>`;
  }

  updated(changedProperties: Map<string, unknown>): void {
    if (!changedProperties.has('open')) return;
    if (changedProperties.get('open') === undefined) return;
    queueMicrotask(() => this._afterRender());
  }

  _afterRender(): void {
    const subContent = this.querySelector<HTMLElement>('ui-dropdown-menu-sub-content [popover]');
    if (subContent) {
      const p = subContent as HTMLElement & {
        showPopover?: () => void;
        hidePopover?: () => void;
        matches: (s: string) => boolean;
      };
      if (typeof p.showPopover === 'function') {
        if (this.open && !p.matches(':popover-open')) p.showPopover();
        else if (!this.open && p.matches(':popover-open')) p.hidePopover();
      }
    }
    if (this.open) {
      this._position();
      this._consumeFocusFirst();
    } else {
      // Closed before the intent was consumed (a hover-close raced the key).
      // Dropping it keeps a later hover-open from stealing focus into the panel.
      this._focusFirstOnOpen = false;
    }
  }

  _cancelCloseHandler = (): void => this._cancelClose();
  // Hover-close is a mouse affordance. On touch, lifting the finger fires
  // pointerleave; without this guard a tap-opened submenu would close itself
  // ~200ms after the tap. On touch the submenu stays open until tapped again.
  _scheduleCloseHandler = (e: Event): void => {
    if ((e as PointerEvent).pointerType === 'touch') return;
    this._scheduleClose();
  };

  _scheduleClose(): void {
    this._cancelClose();
    this._closeTimer = window.setTimeout(() => this.hide(), SUB_CLOSE_DELAY);
  }

  _cancelClose(): void {
    if (this._closeTimer !== undefined) {
      clearTimeout(this._closeTimer);
      this._closeTimer = undefined;
    }
  }

  _position(): void {
    const trigger = this.querySelector<HTMLElement>(
      'ui-dropdown-menu-sub-trigger [role="menuitem"]',
    );
    const content = this.querySelector<HTMLElement>(
      'ui-dropdown-menu-sub-content [popover]',
    );
    const contentHost = this.querySelector<HTMLElement>('ui-dropdown-menu-sub-content');
    if (!trigger || !content || !contentHost) return;
    positionFloating(trigger, content, {
      side: (contentHost.getAttribute('side') ?? 'right') as PopoverSide,
      align: (contentHost.getAttribute('align') ?? 'start') as PopoverAlign,
      sideOffset: Number(contentHost.getAttribute('side-offset') ?? -4),
      alignOffset: Number(contentHost.getAttribute('align-offset') ?? 0),
    });
  }
}
UiDropdownMenuSub.register('ui-dropdown-menu-sub');

export class UiDropdownMenuSubTrigger extends WebComponent({ inset: Boolean }) {
  constructor() {
    super();
    this.inset = false;
  }

  // SSR-safe: linkedom doesn't implement closest() on custom elements.
  _sub(): UiDropdownMenuSub | null {
    if (typeof this.closest !== 'function') return null;
    return this.closest('ui-dropdown-menu-sub') as UiDropdownMenuSub | null;
  }

  render() {
    const open = !!this._sub()?.open;
    const disabled = typeof this.hasAttribute === 'function' && this.hasAttribute('data-disabled');
    return html`<div
      data-slot="dropdown-menu-sub-trigger"
      role="menuitem"
      tabindex="-1"
      aria-haspopup="menu"
      aria-expanded=${String(open)}
      aria-disabled=${disabled ? 'true' : 'false'}
      data-state=${open ? 'open' : 'closed'}
      ?data-inset=${this.inset}
      ?data-disabled=${disabled}
      class=${dropdownMenuSubTriggerClass()}
      @click=${this._onClick}
      @pointerenter=${this._onPointerEnter}
    ><slot></slot>${unsafeHTML(CHEVRON_RIGHT_SVG)}</div>`;
  }

  _onClick = (e: Event): void => {
    const el = e.currentTarget as HTMLElement;
    if (el.hasAttribute('data-disabled')) return;
    this._sub()?.toggle();
  };

  _onPointerEnter = (e: Event): void => {
    // Hover-open is a mouse affordance. On touch there is no hover: a tap
    // fires pointerenter on finger-down, which would open the submenu only for
    // the following click to toggle it shut. On touch, @click is the opener.
    if ((e as PointerEvent).pointerType === 'touch') return;
    const el = e.currentTarget as HTMLElement;
    if (el.hasAttribute('data-disabled')) return;
    el.focus();
    this._sub()?.show();
  };
}
UiDropdownMenuSubTrigger.register('ui-dropdown-menu-sub-trigger');

export class UiDropdownMenuSubContent extends WebComponent {
  render() {
    return html`<div
      data-slot="dropdown-menu-sub-content"
      role="menu"
      aria-orientation="vertical"
      popover="manual"
      class=${dropdownMenuSubContentClass()}
    ><slot></slot></div>`;
  }
}
UiDropdownMenuSubContent.register('ui-dropdown-menu-sub-content');
