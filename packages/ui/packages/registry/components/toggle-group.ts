/**
 * ToggleGroup: group of toggles with single- or multiple-selection.
 * Tier-2; items coordinate active state across the group, so this is
 * a custom element (not a class helper). Items are styled via
 * `toggleClass()` from `./toggle.ts` so the visual matches a single
 * toggle exactly.
 *
 * shadcn parity:
 *   ToggleGroup (type: single | multiple)
 *               (variant: default | outline)
 *               (size:    default | sm | lg)
 *                                 → <ui-toggle-group type variant size value>
 *   ToggleGroupItem               → <ui-toggle-group-item value>
 *
 * Attributes on <ui-toggle-group>:
 *   `type`:        "single" (default) | "multiple".
 *   `value`:       string. Selected value(s). Single: a single value;
 *                  multiple: comma-separated values.
 *   `variant`:     "default" (default) | "outline".
 *   `size`:        "default" (default) | "sm" | "lg".
 *   `spacing`:     "0" (default, joined corners) | "default" (gapped).
 *   `orientation`: "horizontal" (default) | "vertical".
 *
 * Attributes on <ui-toggle-group-item>:
 *   `value`:    string. Identifier this item contributes when selected.
 *   `pressed`:  boolean (reflected). Mirrors the group's selection for this item.
 *   `disabled`: boolean (reflected). Refuses click + Enter / Space, is skipped by
 *               Arrow / Home / End, and never holds the group's tab stop.
 *
 * Events:
 *   `ui-value-change` on <ui-toggle-group>: `{ detail: { value } }` after selection changes.
 *
 * Keyboard: Arrow keys move focus between items (roving tabindex, so the
 * group is a single Tab stop), Home / End jump to the first / last item, and
 * Enter / Space toggles the focused item. A `disabled` item is skipped by all
 * of these.
 *
 * A11y (owned by the element, nothing to supply beyond item names):
 *   The group is a `role="group"` whose items carry `aria-pressed`, navigated by
 *   a roving tabindex so the whole group is one Tab stop. A `disabled` item
 *   reports `aria-disabled` and is skipped by navigation: since the group is a
 *   single tab stop, focus landing on a disabled item could not be tabbed past,
 *   so skipping it is what keeps the group usable rather than a nicety.
 *   Note `disabled` on the item is deliberately exposed as `aria-disabled`, not
 *   a `disabled` attribute. The item's host IS the button and it is a custom
 *   element, so a `disabled` attribute there is inert: no `:disabled` CSS, no
 *   click suppression, no removal from the tab order.
 *   What you DO supply: an `aria-label` on any icon-only item, as below.
 *
 * Design tokens used: inherited from toggleClass (--muted, --accent, --ring,
 * --input, --destructive).
 *
 * @example
 * ```html
 * <ui-toggle-group type="single" value="bold">
 *   <ui-toggle-group-item value="bold" aria-label="Bold"><b>B</b></ui-toggle-group-item>
 *   <ui-toggle-group-item value="italic" aria-label="Italic"><i>I</i></ui-toggle-group-item>
 *   <ui-toggle-group-item value="underline" aria-label="Underline"><u>U</u></ui-toggle-group-item>
 * </ui-toggle-group>
 *
 * <!-- Multiple selection, with a comma-separated value. -->
 * <ui-toggle-group type="multiple" value="bold,italic">
 *   <ui-toggle-group-item value="bold">B</ui-toggle-group-item>
 *   <ui-toggle-group-item value="italic">I</ui-toggle-group-item>
 * </ui-toggle-group>
 *
 * <!-- A disabled item: unclickable, and skipped by Arrow / Home / End. -->
 * <ui-toggle-group type="single" value="left">
 *   <ui-toggle-group-item value="left" aria-label="Align left">L</ui-toggle-group-item>
 *   <ui-toggle-group-item value="justify" aria-label="Justify" disabled>J</ui-toggle-group-item>
 *   <ui-toggle-group-item value="right" aria-label="Align right">R</ui-toggle-group-item>
 * </ui-toggle-group>
 * ```
 */
import { WebComponent, html, prop } from '@webjsdev/core';
import { cn } from '../lib/utils.ts';
import { toggleClass, type ToggleVariant, type ToggleSize } from './toggle.ts';

const ROOT_BASE =
  'group/toggle-group flex w-fit items-center rounded-md data-[spacing=default]:data-[variant=outline]:shadow-xs data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch';

// The `disabled:` variants inside toggleClass() key on the :disabled pseudo,
// which only ever matches a real form control. An item's host IS the button
// here (a custom element), so `disabled` on it is inert as far as CSS and the
// browser are concerned, and the disabled look has to come from the
// aria-disabled variant instead.
const ITEM_EXTRA =
  'w-auto min-w-0 shrink-0 px-3 focus:z-10 focus-visible:z-10 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[spacing=0]:rounded-none data-[spacing=0]:shadow-none data-[spacing=0]:first:rounded-l-md data-[spacing=0]:last:rounded-r-md data-[spacing=0]:data-[variant=outline]:border-l-0 data-[spacing=0]:data-[variant=outline]:first:border-l';

// --------------------------------------------------------------------------
// <ui-toggle-group>
// Renders a wrapping <div role="group"> with the @ui-toggle-item-click
// listener bound declaratively. Children project through the slot. Item
// state (data-state, aria-pressed) is reflected from updated() so the
// effect runs after the host's commit. A queueMicrotask defer inside
// gives the descendant <ui-toggle-group-item> components time to commit
// their own renders before we read / write their state.
// --------------------------------------------------------------------------

export class UiToggleGroup extends WebComponent({
  value: prop(String, { reflect: true }),
  type: prop<'single' | 'multiple'>(String, { reflect: true }),
  variant: prop<ToggleVariant>(String, { reflect: true }),
  size: prop<ToggleSize>(String, { reflect: true }),
  spacing: prop(String, { reflect: true }),
  orientation: prop<'horizontal' | 'vertical'>(String, { reflect: true }),
}) {
  constructor() {
    super();
    this.value = '';
    this.type = 'single';
    this.variant = 'default';
    this.size = 'default';
    this.spacing = '0';
    this.orientation = 'horizontal';
  }

  get _values(): Set<string> {
    const raw = this.value ?? '';
    return new Set(raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : []);
  }

  render() {
    const gap = this.spacing === '0' ? '' : 'gap-1';
    return html`<div
      data-slot="toggle-group"
      role="group"
      class=${cn(ROOT_BASE, gap)}
      data-variant=${this.variant}
      data-size=${this.size}
      data-spacing=${this.spacing}
      data-orientation=${this.orientation}
      @ui-toggle-item-click=${this._onItemClick}
    ><slot></slot></div>`;
  }

  updated(): void {
    // Reflect group state onto each <ui-toggle-group-item>. One microtask
    // gives the items time to commit their own renders first.
    queueMicrotask(() => this._reflectItems());
  }

  _items(): UiToggleGroupItem[] {
    return Array.from(this.querySelectorAll<UiToggleGroupItem>('ui-toggle-group-item'));
  }

  // Arrow / Home / End navigate among ENABLED items only. Landing focus on a
  // disabled item would strand the user on a control that refuses every
  // interaction, and since this group is a single tab stop they cannot simply
  // Tab past it.
  _enabledItems(): UiToggleGroupItem[] {
    return this._items().filter((i) => !i.disabled);
  }

  _reflectItems(): void {
    const values = this._values;
    const items = this._items();
    const current = items.find((el) => el.tabIndex === 0);
    items.forEach((item) => {
      const on = !!item.value && values.has(item.value);
      // Reflect both on the host (for CSS sibling selectors like
      // data-[spacing=0]:first:rounded-l-md that need to target the host
      // as a sibling of other items) and as a reactive prop so the
      // item's render() refreshes its inner styling.
      item.pressed = on;
    });
    this._roving(items, current);
  }

  // Roving tabindex (APG): exactly one item is in the tab order. Prefer the
  // currently-focused item, then whichever was tabbable, then the first
  // selected item, then the first item. Arrow keys move focus and shift the
  // single tabbable slot via `focusItem`.
  _roving(items: UiToggleGroupItem[], current?: UiToggleGroupItem): void {
    if (!items.length) return;
    // The tab stop must land on an ENABLED item: promoting a disabled one makes
    // the group's single Tab stop a dead end.
    const enabled = items.filter((i) => !i.disabled);
    if (!enabled.length) {
      items.forEach((item) => {
        item.tabIndex = -1;
      });
      return;
    }
    const values = this._values;
    const active =
      typeof document !== 'undefined' ? (document.activeElement as Element | null) : null;
    const focused = active ? enabled.find((i) => i === active) : undefined;
    const selected = enabled.find((i) => !!i.value && values.has(i.value));
    const held = current && !current.disabled ? current : undefined;
    const tabbable = focused ?? held ?? selected ?? enabled[0];
    items.forEach((item) => {
      item.tabIndex = item === tabbable ? 0 : -1;
    });
  }

  focusItem(item: UiToggleGroupItem): void {
    if (item.disabled) return;
    this._items().forEach((el) => {
      el.tabIndex = el === item ? 0 : -1;
    });
    item.focus();
  }

  _onItemClick = (e: Event): void => {
    const v = (e as CustomEvent).detail?.value as string | undefined;
    if (!v) return;
    const values = this._values;
    if (this.type === 'single') {
      values.clear();
      values.add(v);
    } else if (values.has(v)) {
      values.delete(v);
    } else {
      values.add(v);
    }
    const next = Array.from(values).join(',');
    this.value = this.type === 'single' ? (next.split(',')[0] ?? '') : next;
    this.dispatchEvent(
      new CustomEvent('ui-value-change', { detail: { value: this.value }, bubbles: true }),
    );
  };
}
UiToggleGroup.register('ui-toggle-group');

// --------------------------------------------------------------------------
// <ui-toggle-group-item>
// Renders a native <button> styled via toggleClass; emits a bubbling
// `ui-toggle-item-click` event with detail.value so the group can
// coordinate selection. Variant / size / spacing read from the group
// at render time (data-* attributes on the host carry them for
// Tailwind variant selectors on the joined-spacing rounded corners).
// --------------------------------------------------------------------------

export class UiToggleGroupItem extends WebComponent({
  value: prop(String, { reflect: true }),
  pressed: prop(Boolean, { reflect: true }),
  disabled: prop(Boolean, { reflect: true }),
}) {
  constructor() {
    super();
    this.value = '';
    this.pressed = false;
    this.disabled = false;
  }

  // render() runs server-side too. webjs resolves closest() at SSR against
  // the enclosing-element ancestor chain, so the pressed item is marked in
  // the first paint (no hydration flash). The typeof guard stays defensive.
  get _group(): UiToggleGroup | null {
    if (typeof this.closest !== 'function') return null;
    return this.closest('ui-toggle-group') as UiToggleGroup | null;
  }

  // Compound-component caveat: the host element carries the visual
  // class + data-* attributes (not an inner <button>) so CSS sibling
  // selectors like `data-[spacing=0]:first:rounded-l-md` match it as
  // a sibling of other items in the group. Light DOM has no :host CSS
  // and no way to bind host attributes from a render() template, so
  // ARIA + static markup attributes go in connectedCallback (set once)
  // and the parent-derived data-* + class string get refreshed in
  // render(). Click + keyboard listeners live on the host because the
  // click target IS the host (the styled element under the cursor).
  connectedCallback(): void {
    this.dataset.slot = 'toggle-group-item';
    this.role = 'button';
    // Roving tabindex: start outside the tab order. The group promotes
    // exactly one item to tabindex 0 in _reflectItems (runs after first
    // render); Arrow keys move focus and the tabbable slot from there.
    this.tabIndex = -1;
    this.addEventListener('click', this._onClick);
    this.addEventListener('keydown', this._onKeyDown);
    super.connectedCallback?.();
  }

  disconnectedCallback(): void {
    this.removeEventListener('click', this._onClick);
    this.removeEventListener('keydown', this._onKeyDown);
    super.disconnectedCallback?.();
  }

  render() {
    const group = this._group;
    const variant = (group?.variant ?? 'default') as ToggleVariant;
    const size = (group?.size ?? 'default') as ToggleSize;
    const spacing = group?.spacing ?? '0';
    this.dataset.variant = variant;
    this.dataset.size = size;
    this.dataset.spacing = spacing;
    this.dataset.state = this.pressed ? 'on' : 'off';
    // role and data-slot are set HERE as well as in connectedCallback, because
    // SSR runs render() but NOT connectedCallback. Without this the served item
    // carried aria-pressed / aria-disabled with no role at all, and neither is a
    // global ARIA attribute, so the first paint shipped attributes that are not
    // allowed on a generic-role element. (`this.role` is shimmed server-side too,
    // like the ariaPressed / dataset / className writes around it; setAttribute
    // is simply the more explicit spelling.)
    this.setAttribute('role', 'button');
    this.setAttribute('data-slot', 'toggle-group-item');
    this.ariaPressed = String(this.pressed);
    // aria-disabled rather than a `disabled` attribute: the host is a custom
    // element, so `disabled` would be inert (no CSS pseudo, no click blocking,
    // no removal from the tab order). aria-disabled is what actually reaches
    // assistive tech, and the group skips these in its roving tabindex.
    this.ariaDisabled = String(this.disabled);
    this.className = cn(toggleClass({ variant, size }), ITEM_EXTRA);
    return html`<slot></slot>`;
  }

  // Disabling the item that happens to hold the group's only tab stop would
  // leave the group unreachable by keyboard, and the group cannot see an item's
  // prop change on its own, so ask it to recompute which item is tabbable.
  updated(changedProperties: Map<string, unknown>): void {
    if (!changedProperties.has('disabled')) return;
    if (changedProperties.get('disabled') === undefined) return;
    queueMicrotask(() => this._group?._reflectItems());
  }

  _onClick = (): void => {
    if (this.disabled) return;
    if (!this.value) return;
    this.dispatchEvent(
      new CustomEvent('ui-toggle-item-click', { detail: { value: this.value }, bubbles: true }),
    );
  };

  _onKeyDown = (e: KeyboardEvent): void => {
    if (this.disabled) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      this._onClick();
      return;
    }
    const group = this._group;
    if (!group) return;
    const horizontal = group.orientation !== 'vertical';
    const nextKey = horizontal ? 'ArrowRight' : 'ArrowDown';
    const prevKey = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const items = group._enabledItems();
    const idx = items.indexOf(this);
    if (idx === -1) return;
    let target: UiToggleGroupItem | null = null;
    if (e.key === nextKey) target = items[(idx + 1) % items.length] ?? null;
    else if (e.key === prevKey) target = items[(idx - 1 + items.length) % items.length] ?? null;
    else if (e.key === 'Home') target = items[0] ?? null;
    else if (e.key === 'End') target = items[items.length - 1] ?? null;
    if (target) {
      e.preventDefault();
      group.focusItem(target);
    }
  };
}
UiToggleGroupItem.register('ui-toggle-group-item');
