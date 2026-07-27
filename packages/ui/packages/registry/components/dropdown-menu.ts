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
 *   `ui-item-select` bubbled by an item: `{ detail: { value, item } }` on activation.
 *
 * Programmatic API on <ui-dropdown-menu>: `.show()` · `.hide()` · `.toggle()`.
 *
 * Keyboard:
 *   ArrowUp / ArrowDown   move focus between items
 *   ArrowRight            on a sub-trigger: open submenu, focus first item
 *   ArrowLeft             inside a submenu: close it, refocus the sub-trigger
 *   Home / End            first / last item
 *   Enter / Space         activate focused item
 *   Escape                close menu (or close current submenu first)
 *   Tab                   close menu and proceed with normal tab order
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
  'fixed z-50 max-h-[--available-height] min-w-[8rem] m-0 overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md';

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
  'fixed z-50 min-w-[8rem] m-0 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg';

const CHEVRON_RIGHT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ml-auto size-4" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>';

const SUB_CLOSE_DELAY = 200;

// --------------------------------------------------------------------------
// <ui-dropdown-menu>
// --------------------------------------------------------------------------

export class UiDropdownMenu extends WebComponent({
  open: prop(Boolean, { reflect: true }),
}) {
  _typeBuffer = '';
  _typeBufferTimer: number | undefined;

  _docClickHandler = (e: MouseEvent): void => this._onDocClick(e);
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
    document.addEventListener('click', this._docClickHandler);
    document.addEventListener('keydown', this._keyHandler);
    window.addEventListener('resize', this._resizeHandler);
    window.addEventListener('scroll', this._resizeHandler, true);
    queueMicrotask(() => {
      const first = this.querySelector<HTMLElement>(
        'ui-dropdown-menu-item:not([data-disabled]) [role="menuitem"]',
      );
      first?.focus();
    });
  }

  _teardown(): void {
    document.removeEventListener('click', this._docClickHandler);
    document.removeEventListener('keydown', this._keyHandler);
    window.removeEventListener('resize', this._resizeHandler);
    window.removeEventListener('scroll', this._resizeHandler, true);
    this.querySelectorAll<UiDropdownMenuSub>('ui-dropdown-menu-sub[open]').forEach(
      (sub) => sub.hide(),
    );
  }

  _onDocClick(e: MouseEvent): void {
    if (!this.open) return;
    if (e.composedPath().some((n) => n === this)) return;
    this.hide();
  }

  _onKeyDown(e: KeyboardEvent): void {
    if (!this.open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.hide();
      return;
    }

    // Active context = nearest content / sub-content panel owning focus.
    // Scoping arrow nav avoids walking into siblings of a different submenu.
    const active = document.activeElement as HTMLElement | null;
    const context = active?.closest('[role="menu"]') as HTMLElement | null;
    if (!context) return;

    const items = Array.from(
      context.querySelectorAll<HTMLElement>('[role="menuitem"]:not([data-disabled])'),
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
        if (sub) {
          sub.show();
          queueMicrotask(() => {
            const firstSubItem = sub.querySelector<HTMLElement>(
              'ui-dropdown-menu-sub-content [role="menuitem"]:not([data-disabled])',
            );
            firstSubItem?.focus();
          });
        }
      }
    } else if (e.key === 'ArrowLeft') {
      // Inside a sub-content: close the submenu and refocus its trigger.
      if (context.closest('ui-dropdown-menu-sub-content')) {
        e.preventDefault();
        const sub = context.closest('ui-dropdown-menu-sub') as UiDropdownMenuSub | null;
        const trigger = sub?.querySelector<HTMLElement>(
          'ui-dropdown-menu-sub-trigger [role="menuitem"]',
        );
        sub?.hide();
        trigger?.focus();
      }
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
  }

  render() {
    // `data-disabled` on the host is the historical disabled marker (focus
    // skips it, the click / pointer handlers bail on it). Mirror it onto the
    // inner menuitem as both data-disabled (CSS) and aria-disabled, so the
    // state also reaches assistive tech.
    const disabled = typeof this.hasAttribute === 'function' && this.hasAttribute('data-disabled');
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
    (this.closest('ui-dropdown-menu') as UiDropdownMenu | null)?.hide();
  };

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
  render() {
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
    if (this.open) this._position();
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
