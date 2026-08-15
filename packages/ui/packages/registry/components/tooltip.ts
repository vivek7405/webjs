/**
 * Tooltip: hover- / focus-triggered floating tip. Tier-2. The content
 * uses the native Popover API in `popover="manual"` mode for top-layer
 * rendering (no z-index wars); the custom element owns the
 * hover-with-delay state machine and JS positioning.
 *
 * shadcn parity:
 *   Tooltip               → <ui-tooltip delay-duration skip-delay-duration>
 *   TooltipTrigger        → <ui-tooltip-trigger>
 *   TooltipContent        → <ui-tooltip-content side align side-offset align-offset>
 *   TooltipProvider       → not needed; delay state is per-tooltip (and globally
 *                           shared via `skip-delay-duration` cooldown).
 *
 * Attributes on <ui-tooltip>:
 *   `open`:                boolean (reflected). Open state.
 *   `delay-duration`:      ms, default 700. Initial hover delay before opening.
 *   `skip-delay-duration`: ms, default 300. Window after a tooltip closes
 *                          during which the next tooltip skips its
 *                          `delay-duration` (so moving between adjacent
 *                          triggers feels instant).
 *
 * Attributes on <ui-tooltip-content>:
 *   `side`:         "top" (default) | "right" | "bottom" | "left".
 *   `align`:        "center" (default) | "start" | "end".
 *   `side-offset`:  number, default 4. Pixels between trigger and content.
 *   `align-offset`: number, default 0. Pixels of cross-axis shift.
 *
 * Events: none dispatched at present (hover state changes are local;
 * use the reflected `open` attribute to observe state from CSS).
 *
 * Programmatic API on <ui-tooltip>: `.show()` · `.hide()`.
 *
 * Keyboard:
 *   Escape   dismiss a showing tip, leaving focus on the trigger
 *
 * A11y (owned by the element, nothing to supply):
 *   The focusable trigger references the tip via `aria-describedby`, so a
 *   screen reader appends the tip to the trigger's own name, and the tip opens
 *   on focus as well as hover. Escape dismisses a showing tip without moving
 *   focus (APG requires the escape hatch, since a tip can cover the content
 *   underneath it). A CLOSED tooltip never consumes Escape, so it cannot
 *   swallow the key from a dialog it happens to sit inside.
 *   What you DO supply: an accessible name on the trigger control itself. The
 *   tip is a DESCRIPTION, not a name, so an icon-only trigger still needs its
 *   own `aria-label` as the example below shows.
 *
 * Design tokens used: --foreground, --background.
 *
 * @example
 * ```html
 * <ui-tooltip delay-duration="500" skip-delay-duration="300">
 *   <ui-tooltip-trigger>
 *     <button class=${buttonClass({ size: 'icon', variant: 'ghost' })} aria-label="Help">?</button>
 *   </ui-tooltip-trigger>
 *   <ui-tooltip-content side="top">Helpful tip</ui-tooltip-content>
 * </ui-tooltip>
 * ```
 */
import { WebComponent, html, prop } from '@webjsdev/core';
import { ensureId } from '../lib/utils.ts';
import { onBeforeCache } from '../lib/dom.ts';
import { positionFloating, type PopoverSide, type PopoverAlign } from './popover.ts';

// UA `[popover]` defaults paint a bordered, padded panel centered with
// `margin: auto`; the class string opts out via `m-0` + `border-0` and
// layers the shadcn look on top. `fixed` keeps JS-computed top/left in
// top layer. UA `[popover]:not(:popover-open) { display: none }` keeps
// the closed state hidden.
export const tooltipContentClass = (): string =>
  'fixed z-50 w-fit m-0 border-0 overflow-visible rounded-md bg-foreground px-3 py-1.5 text-xs text-balance text-background';

// Module-level "last close" timestamp, shared across every <ui-tooltip>
// on the page. When the next tooltip is hovered within
// `skip-delay-duration` ms of this stamp, it skips its delay-duration
// wait and opens immediately. Matches shadcn TooltipProvider.skipDelayDuration.
let lastTooltipHideAt = 0;

// --------------------------------------------------------------------------
// <ui-tooltip>
// --------------------------------------------------------------------------

export class UiTooltip extends WebComponent({
  open: prop(Boolean, { reflect: true }),
  // `delayDuration` / `skipDelayDuration` ride the `delay-duration` /
  // `skip-delay-duration` attributes (shadcn parity), read as typed props.
  delayDuration: Number,
  skipDelayDuration: Number,
}) {
  _showTimer: number | undefined;
  _hideTimer: number | undefined;

  _keyHandler = (e: KeyboardEvent): void => this._onKeyDown(e);

  constructor() {
    super();
    this.open = false;
    this.delayDuration = 700;
    this.skipDelayDuration = 300;
  }

  _disposeBeforeCache?: () => void;

  connectedCallback(): void {
    super.connectedCallback?.();
    // webjs projects slotted light-DOM children in a pass after the first
    // render, so the trigger's focusable control is not in place yet at
    // connect / firstUpdated. Defer to the next frame, by which point the
    // projection has run and both the control and the tip content exist.
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => this._wireAria());
    }
    // Close before a back/forward snapshot so it does not restore open (#766).
    this._disposeBeforeCache = onBeforeCache(() => { this.open = false; });
  }

  disconnectedCallback(): void {
    this._unbindEscape();
    this._disposeBeforeCache?.();
    super.disconnectedCallback?.();
  }

  // APG Tooltip requires an Escape escape-hatch: a tip can cover the content
  // underneath it, and a keyboard user who cannot dismiss it is stuck. Focus
  // is deliberately untouched, since the tip is not focusable and the trigger
  // should keep focus (moving it would lose the user's place).
  //
  // The listener is bound only WHILE OPEN, which is how a closed tooltip is
  // kept from consuming Escape that a dialog (or anything else) wants.
  _onKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || !this.open) return;
    e.preventDefault();
    this._dismiss();
  }

  // Immediate, unlike hide()'s 100ms hover-out grace: a dismissal is a
  // deliberate act, so it should not sit around waiting to be cancelled.
  _dismiss(): void {
    clearTimeout(this._showTimer);
    clearTimeout(this._hideTimer);
    this.open = false;
    lastTooltipHideAt = Date.now();
  }

  _bindEscape(): void {
    if (typeof document === 'undefined') return;
    document.addEventListener('keydown', this._keyHandler);
  }

  _unbindEscape(): void {
    if (typeof document === 'undefined') return;
    document.removeEventListener('keydown', this._keyHandler);
  }

  // APG tooltip wiring: the focusable trigger references the tip via
  // aria-describedby, so a screen reader appends the tip text to the
  // trigger's own name ("Help, button, Helpful tip"). The tip is JS-driven,
  // so doing this at runtime is correct.
  _wireAria(): void {
    const triggerHost = this.querySelector('ui-tooltip-trigger');
    const content = this.querySelector<HTMLElement>('ui-tooltip-content [role="tooltip"]');
    if (!triggerHost || !content) return;
    const control =
      triggerHost.querySelector<HTMLElement>('button, a[href], [tabindex], [role="button"]') ??
      (triggerHost as HTMLElement);
    const id = ensureId(content, 'ui-tooltip');
    const existing = control.getAttribute('aria-describedby');
    if (!existing) control.setAttribute('aria-describedby', id);
    else if (!existing.split(/\s+/).includes(id)) {
      control.setAttribute('aria-describedby', `${existing} ${id}`);
    }
  }

  // Back-compat getter for tests + external code that read `el.isOpen`
  // alongside the reactive `open` prop.
  get isOpen(): boolean { return this.open; }

  show(): void {
    clearTimeout(this._showTimer);
    clearTimeout(this._hideTimer);
    const delay = this.delayDuration;
    const skipDelay = this.skipDelayDuration;
    const sinceLastHide = Date.now() - lastTooltipHideAt;
    if (lastTooltipHideAt > 0 && sinceLastHide < skipDelay) {
      this.open = true;
      return;
    }
    this._showTimer = window.setTimeout(() => { this.open = true; }, delay);
  }

  hide(): void {
    clearTimeout(this._showTimer);
    // Clear the PENDING hide before scheduling the next one: overwriting the
    // handle alone orphans the old timer, which then fires on its own and
    // closes a tip a later show() had already reopened.
    clearTimeout(this._hideTimer);
    this._hideTimer = window.setTimeout(() => {
      this.open = false;
      lastTooltipHideAt = Date.now();
    }, 100);
  }

  render() {
    return html`<div
      data-slot="tooltip"
      data-state=${this.open ? 'open' : 'closed'}
    ><slot></slot></div>`;
  }

  updated(changedProperties: Map<string, unknown>): void {
    if (!changedProperties.has('open')) return;
    // Skip the constructor's initial open=false set.
    if (changedProperties.get('open') === undefined) return;
    // Bind synchronously rather than inside _syncContent, which bails early on
    // engines with no Popover API: Escape has to work regardless of that.
    if (this.open) this._bindEscape();
    else this._unbindEscape();
    // Defer one microtask so the content child's [popover] inner element
    // has committed; we drive its showPopover() / hidePopover() from here.
    queueMicrotask(() => this._syncContent());
  }

  _syncContent(): void {
    // <ui-tooltip-content> renders a `<div popover="manual">` inside its
    // slot output; the popover API lives on that inner div, not the
    // host. Query past the host to the actual popover element.
    const popover = this.querySelector<HTMLElement>('ui-tooltip-content [popover]');
    const host = this.querySelector<HTMLElement>('ui-tooltip-content');
    if (!popover || !popover.isConnected) return;
    const p = popover as HTMLElement & {
      showPopover?: () => void;
      hidePopover?: () => void;
      matches: (s: string) => boolean;
    };
    if (typeof p.showPopover !== 'function') return;
    if (this.open) {
      if (!p.matches(':popover-open')) p.showPopover();
      if (host) this._reposition(host, popover);
    } else if (p.matches(':popover-open')) {
      p.hidePopover();
    }
  }

  _reposition(contentHost: HTMLElement, popover: HTMLElement): void {
    const trigger = this.querySelector<HTMLElement>('ui-tooltip-trigger');
    if (!trigger) return;
    // Placement attributes live on the <ui-tooltip-content> host (the
    // public API surface); positioning targets the inner popover element.
    positionFloating(trigger, popover, {
      side: (contentHost.getAttribute('side') ?? 'top') as PopoverSide,
      align: (contentHost.getAttribute('align') ?? 'center') as PopoverAlign,
      sideOffset: Number(contentHost.getAttribute('side-offset') ?? 4),
      alignOffset: Number(contentHost.getAttribute('align-offset') ?? 0),
    });
  }
}
UiTooltip.register('ui-tooltip');

// --------------------------------------------------------------------------
// <ui-tooltip-trigger>
// Wraps the user's focusable element. Hover/focus handlers live on the
// rendered wrapper via declarative bindings; no manual addEventListener
// or disconnect cleanup is needed.
// --------------------------------------------------------------------------

export class UiTooltipTrigger extends WebComponent {
  render() {
    return html`<div
      data-slot="tooltip-trigger"
      @mouseenter=${this._onEnter}
      @mouseleave=${this._onLeave}
      @focusin=${this._onEnter}
      @focusout=${this._onLeave}
    ><slot></slot></div>`;
  }

  _onEnter = (): void => (this.closest('ui-tooltip') as UiTooltip | null)?.show();
  _onLeave = (): void => (this.closest('ui-tooltip') as UiTooltip | null)?.hide();
}
UiTooltipTrigger.register('ui-tooltip-trigger');

// --------------------------------------------------------------------------
// <ui-tooltip-content>
// Renders a `<div popover="manual" role="tooltip">` (the floating panel).
// The popover attribute is declarative on the inner element, so the
// browser registers it as a popover before the parent calls showPopover.
// --------------------------------------------------------------------------

export class UiTooltipContent extends WebComponent {
  render() {
    return html`<div
      data-slot="tooltip-content"
      role="tooltip"
      popover="manual"
      class=${tooltipContentClass()}
    ><slot></slot></div>`;
  }
}
UiTooltipContent.register('ui-tooltip-content');
