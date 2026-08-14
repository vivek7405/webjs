/**
 * Tabs: sectioned content with keyboard navigation. Tier-2. The parent
 * <ui-tabs> owns `value` + `orientation`; triggers and panels read from
 * it via `closest('ui-tabs')` and re-render when value changes.
 *
 * APG pattern: https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
 *
 * shadcn parity:
 *   Tabs           → <ui-tabs value orientation>
 *   TabsList       → <ui-tabs-list variant>
 *   TabsTrigger    → <ui-tabs-trigger value>
 *   TabsContent    → <ui-tabs-content value>
 *
 * Attributes on <ui-tabs>:
 *   `value`:       string (reflected, controlled). Active tab value.
 *   `orientation`: "horizontal" (default) | "vertical".
 *
 * Attributes on <ui-tabs-list>:
 *   `variant`: "default" (default, pill-on-muted) | "underline".
 *
 * Attributes on <ui-tabs-trigger> / <ui-tabs-content>:
 *   `value`: string. Identifier this trigger / panel pair shares.
 *
 * Events:
 *   `ui-value-change` on <ui-tabs>: `{ detail: { value } }` after a change.
 *
 * Keyboard (on focused trigger):
 *   ArrowRight / ArrowLeft   next / previous (horizontal)
 *   ArrowDown / ArrowUp      next / previous (vertical)
 *   Home / End               first / last
 *   Enter / Space            activate (native button activation)
 *
 * A11y (owned by the element, nothing to supply beyond trigger names):
 *   The element wires the whole APG Tabs pattern: the list is a
 *   `role="tablist"` reporting `aria-orientation`, each trigger is a
 *   `role="tab"` cross-linked to its panel with `aria-controls` while the panel
 *   points back with `aria-labelledby`, ids stay unique across groups on one
 *   page, and an inactive panel is both `hidden` and `inert`. Arrow / Home / End
 *   move focus AND selection (APG automatic activation) via a roving tabindex,
 *   so the tablist is a single Tab stop and nav stays inside its own group when
 *   tabs are nested. Do not hand-add any of these; the element already has.
 *   What you DO supply: a name for each trigger. A trigger's name comes from its
 *   own content, so an icon-only tab needs an `aria-label` on the
 *   `<ui-tabs-trigger>` and an `aria-hidden="true"` icon inside it.
 *   Keep the panel's content after the tablist in the DOM, which the example
 *   shape already does, so reading order follows the tab that was activated.
 *
 * Design tokens used: --muted, --muted-foreground, --foreground, --background,
 * --input, --ring.
 *
 * @example
 * ```html
 * <ui-tabs value="account">
 *   <ui-tabs-list>
 *     <ui-tabs-trigger value="account">Account</ui-tabs-trigger>
 *     <ui-tabs-trigger value="password">Password</ui-tabs-trigger>
 *   </ui-tabs-list>
 *   <ui-tabs-content value="account">
 *     <p class="text-sm">Update your name and email here.</p>
 *   </ui-tabs-content>
 *   <ui-tabs-content value="password">
 *     <p class="text-sm">Change your password here.</p>
 *   </ui-tabs-content>
 * </ui-tabs>
 * ```
 */
import { WebComponent, html, prop } from '@webjsdev/core';
import { cn, ensureId } from '../lib/utils.ts';

// A tab `value` becomes part of an id, so reduce it to id-safe characters.
const idSafe = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, '-');

// --------------------------------------------------------------------------
// Class helpers
// --------------------------------------------------------------------------

const TABS_BASE = 'group/tabs flex gap-2 data-[orientation=horizontal]:flex-col';

const TABS_LIST_BASE =
  'group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-[orientation=horizontal]/tabs:h-9 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col data-[variant=underline]:rounded-none';

const TABS_LIST_VARIANTS = {
  default: 'bg-muted',
  underline: 'gap-1 bg-transparent',
} as const;

export type TabsListVariant = keyof typeof TABS_LIST_VARIANTS;

/** Optional helper exposing the tabs-list class for advanced overrides. */
export function tabsListClass(opts: { variant?: TabsListVariant } = {}): string {
  const variant = opts.variant ?? 'default';
  return cn(TABS_LIST_BASE, TABS_LIST_VARIANTS[variant]);
}

// The trigger is rendered as a native <button role="tab">, which gives
// us cursor-pointer + Enter/Space activation + focus for free. The class
// here is essentially shadcn's tabs.tsx trigger output.
const TABS_TRIGGER_CLASS = [
  "relative inline-flex h-[calc(100%-1px)] flex-1 cursor-pointer select-none items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 group-data-[variant=default]/tabs-list:data-[state=active]:shadow-e1 group-data-[variant=underline]/tabs-list:data-[state=active]:shadow-none dark:text-muted-foreground dark:hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  // These mirror shadcn's tabs.tsx (modulo variant=line → variant=underline).
  // Light-mode active state uses bg-background + shadow only; dark mode
  // additionally borders. Adding light-mode border made the underline
  // variant look like outline and made default look like two buttons.
  'group-data-[variant=underline]/tabs-list:bg-transparent group-data-[variant=underline]/tabs-list:data-[state=active]:bg-transparent dark:group-data-[variant=underline]/tabs-list:data-[state=active]:border-transparent dark:group-data-[variant=underline]/tabs-list:data-[state=active]:bg-transparent',
  'data-[state=active]:bg-background data-[state=active]:text-foreground dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 dark:data-[state=active]:text-foreground',
  'after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=underline]/tabs-list:data-[state=active]:after:opacity-100',
].join(' ');

const TABS_CONTENT_CLASS = 'flex-1 outline-none';

// --------------------------------------------------------------------------
// <ui-tabs> owns active `value` + `orientation`. Children read its state
// via closest('ui-tabs'); when value changes, the parent fires a
// `tabs-value-change-internal` event that descendants listen for via
// the bubbling event on their own host. Each descendant then calls
// requestUpdate() to re-render against the new parent value.
// --------------------------------------------------------------------------

export class UiTabs extends WebComponent({
  value: prop(String, { reflect: true }),
  orientation: prop<'horizontal' | 'vertical'>(String, { reflect: true }),
}) {
  constructor() {
    super();
    this.value = '';
    this.orientation = 'horizontal';
  }

  // Assign the scope id BEFORE render so it is serialized onto this host's
  // opening tag at SSR (willUpdate now runs server-side). Without this, the id
  // was minted lazily during a CHILD trigger's render, AFTER this host's tag
  // was already serialized without an id, so the host shipped no id; on
  // hydration the client re-minted a DIFFERENT counter id and the trigger /
  // panel ids mismatched SSR vs client, breaking hydration (#730).
  willUpdate(): void {
    ensureId(this, 'ui-tabs');
  }

  // Stable per-instance scope so a trigger and its panel agree on the
  // shared id stem (`<scope>-trigger-<value>` / `<scope>-panel-<value>`)
  // even when several tab sets reuse the same `value` names on one page.
  get scopeId(): string {
    return ensureId(this, 'ui-tabs');
  }

  // Builds the trigger / panel id pair a child derives from its `value`.
  idsFor(value: string): { trigger: string; panel: string } {
    const v = idSafe(value);
    return { trigger: `${this.scopeId}-trigger-${v}`, panel: `${this.scopeId}-panel-${v}` };
  }

  render() {
    return html`<div
      data-slot="tabs"
      data-orientation=${this.orientation}
      class=${TABS_BASE}
    ><slot></slot></div>`;
  }

  updated(changedProperties: Map<string, unknown>): void {
    if (!changedProperties.has('value')) return;
    const prev = (changedProperties.get('value') ?? '') as string;
    // Skip the initial undefined -> '' (or '' -> '') no-op set; only
    // dispatch + broadcast on real value transitions.
    if (prev === '' && this.value === '') return;
    queueMicrotask(() => {
      this.dispatchEvent(
        new CustomEvent('ui-value-change', { detail: { value: this.value }, bubbles: true }),
      );
      this._broadcast();
    });
  }

  _broadcast(): void {
    this.querySelectorAll<WebComponent>(
      'ui-tabs-list, ui-tabs-trigger, ui-tabs-content',
    ).forEach((el) => el.requestUpdate?.());
  }
}
UiTabs.register('ui-tabs');

// --------------------------------------------------------------------------
// <ui-tabs-list>
// --------------------------------------------------------------------------

export class UiTabsList extends WebComponent({
  variant: prop<TabsListVariant>(String, { reflect: true }),
}) {
  constructor() {
    super();
    this.variant = 'default';
  }

  get _tabs(): UiTabs | null {
    if (typeof this.closest !== 'function') return null;
    return this.closest('ui-tabs') as UiTabs | null;
  }

  render() {
    const orientation = this._tabs?.orientation ?? 'horizontal';
    return html`<div
      data-slot="tabs-list"
      role="tablist"
      aria-orientation=${orientation}
      data-variant=${this.variant}
      class=${tabsListClass({ variant: this.variant })}
    ><slot></slot></div>`;
  }
}
UiTabsList.register('ui-tabs-list');

// --------------------------------------------------------------------------
// <ui-tabs-trigger value="...">
// --------------------------------------------------------------------------

export class UiTabsTrigger extends WebComponent({
  value: prop(String, { reflect: true }),
}) {
  constructor() {
    super();
    this.value = '';
  }

  // render() runs server-side too. webjs resolves closest() at SSR against
  // the enclosing-element ancestor chain, so the active tab is marked in the
  // first paint (no hydration flash). The typeof guard stays defensive.
  get _tabs(): UiTabs | null {
    if (typeof this.closest !== 'function') return null;
    return this.closest('ui-tabs') as UiTabs | null;
  }

  render() {
    const tabs = this._tabs;
    const active = !!tabs && tabs.value === this.value && this.value !== '';
    const ids = tabs && this.value ? tabs.idsFor(this.value) : null;
    return html`<button
      type="button"
      role="tab"
      data-slot="tabs-trigger"
      id=${ids ? ids.trigger : ''}
      aria-controls=${ids ? ids.panel : ''}
      data-state=${active ? 'active' : 'inactive'}
      aria-selected=${String(active)}
      tabindex=${active ? '0' : '-1'}
      class=${TABS_TRIGGER_CLASS}
      @click=${this._onClick}
      @keydown=${this._onKeyDown}
    ><slot></slot></button>`;
  }

  _onClick = (): void => {
    if (this.value) this._tabs?.setAttribute('value', this.value);
  };

  _onKeyDown = (e: KeyboardEvent): void => {
    const tabs = this._tabs;
    if (!tabs) return;
    const orientation = tabs.orientation;
    // Scope to triggers belonging to THIS group: querySelectorAll crosses into
    // a nested <ui-tabs> inside a panel, and arrow nav at the boundary would
    // jump into the inner group and set this group's value to an inner-only
    // value (hiding every panel). Same scoping dropdown-menu applies to items.
    const triggers = Array.from(tabs.querySelectorAll<UiTabsTrigger>('ui-tabs-trigger')).filter(
      (t) => t._tabs === tabs,
    );
    const idx = triggers.indexOf(this);
    const nextKey = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
    const prevKey = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';

    let target: UiTabsTrigger | null = null;
    if (e.key === nextKey) target = triggers[(idx + 1) % triggers.length] ?? null;
    else if (e.key === prevKey) target = triggers[(idx - 1 + triggers.length) % triggers.length] ?? null;
    else if (e.key === 'Home') target = triggers[0] ?? null;
    else if (e.key === 'End') target = triggers[triggers.length - 1] ?? null;
    // Enter/Space already handled natively by <button>; no preventDefault needed.

    if (target) {
      e.preventDefault();
      const v = target.value;
      if (v) tabs.setAttribute('value', v);
      // Focus the inner <button role="tab">, NOT the <ui-tabs-trigger> host.
      // The host carries no tabindex so it is not focusable; calling focus()
      // on it is a no-op that leaves the focus ring stranded on the previous
      // trigger while a different panel shows. The roving tabindex lives on
      // the inner button, so that is what APG focus-follows-selection targets.
      const btn = target.querySelector<HTMLButtonElement>('[role="tab"]');
      (btn ?? target).focus();
    }
  };
}
UiTabsTrigger.register('ui-tabs-trigger');

// --------------------------------------------------------------------------
// <ui-tabs-content value="...">
// --------------------------------------------------------------------------

export class UiTabsContent extends WebComponent({
  value: prop(String, { reflect: true }),
}) {
  constructor() {
    super();
    this.value = '';
  }

  get _tabs(): UiTabs | null {
    if (typeof this.closest !== 'function') return null;
    return this.closest('ui-tabs') as UiTabs | null;
  }

  render() {
    const tabs = this._tabs;
    const active = !!tabs && tabs.value === this.value && this.value !== '';
    const ids = tabs && this.value ? tabs.idsFor(this.value) : null;
    // The host needs to be hidden when inactive so its rendered <section>
    // is removed from layout (light DOM has no :host CSS to scope this).
    // Use the native `hidden` IDL property rather than imperative
    // setAttribute, so it reads as a property assignment. `inert` on the
    // host additionally pulls an inactive panel (and anything focusable
    // inside it) out of the tab order and the accessibility tree.
    this.hidden = !active;
    this.inert = !active;
    return html`<section
      data-slot="tabs-content"
      role="tabpanel"
      id=${ids ? ids.panel : ''}
      aria-labelledby=${ids ? ids.trigger : ''}
      tabindex="0"
      data-state=${active ? 'active' : 'inactive'}
      class=${TABS_CONTENT_CLASS}
    ><slot></slot></section>`;
  }
}
UiTabsContent.register('ui-tabs-content');
