/**
 * HoverCard: popover-like panel triggered by hover with configurable
 * open / close delays. Tier-2. The content uses the native Popover API
 * in `popover="manual"` mode for top-layer rendering; the custom
 * element owns the hover-with-linger state machine and JS positioning.
 *
 * shadcn parity:
 *   HoverCard          → <ui-hover-card open-delay close-delay>
 *   HoverCardTrigger   → <ui-hover-card-trigger>
 *   HoverCardContent   → <ui-hover-card-content side align side-offset align-offset>
 *
 * Attributes on <ui-hover-card>:
 *   `open`:        boolean (reflected). Open state.
 *   `open-delay`:  ms, default 700. Hover delay before opening.
 *   `close-delay`: ms, default 300. Linger delay before closing once
 *                  cursor leaves trigger + content.
 *
 * Attributes on <ui-hover-card-content>:
 *   `side`:         "top" | "right" | "bottom" (default) | "left".
 *   `align`:        "center" (default) | "start" | "end".
 *   `side-offset`:  number, default 4. Pixels between trigger and content.
 *   `align-offset`: number, default 0. Pixels of cross-axis shift.
 *
 * Events: none dispatched at present; observe the reflected `open`
 * attribute from CSS or JS.
 *
 * Programmatic API on <ui-hover-card>: `.show()` · `.hide()`.
 *
 * Keyboard:
 *   Tab      from the trigger into the card, whose content stays open while it
 *            holds focus, so links and buttons inside it are reachable
 *   Escape   dismiss the card, returning focus to the trigger when the card
 *            held it
 *
 * A11y (owned by the element, mostly nothing to supply):
 *   The trigger opens on focus as well as hover and carries `aria-haspopup` /
 *   `aria-expanded` / `aria-controls`. The panel is a `role="dialog"`, which
 *   REQUIRES an accessible name, so the element always gives it one, from the
 *   first of: an `aria-label` / `aria-labelledby` you put on
 *   `<ui-hover-card-content>`, a `[data-slot="hover-card-title"]` or heading
 *   inside the card, or the trigger itself (the card is about whatever the
 *   trigger names). Escape dismisses it and hands focus back when the card had
 *   it, and the content keeps itself open while focus is inside.
 *   What you DO supply: a name for the trigger control if it is icon-only, and
 *   ideally a title node in the card so its name describes the card rather
 *   than falling back to the trigger's text.
 *   Touch: the hover and focus linger paths are gated to pointer devices, so on
 *   a no-hover device the card is tap-toggled and dismissed by an outside tap
 *   (#745). Do not remove that gate to "fix" keyboard behaviour.
 *
 * Design tokens used: --popover, --popover-foreground, --border.
 *
 * @example
 * ```html
 * <ui-hover-card open-delay="700" close-delay="300">
 *   <ui-hover-card-trigger>
 *     <a href="/user/vivek">@vivek</a>
 *   </ui-hover-card-trigger>
 *   <ui-hover-card-content>
 *     <div class="flex gap-3">
 *       <img class="size-10 rounded-full" src="/avatars/vivek.jpg" alt="Vivek Khandelwal">
 *       <div>
 *         <div class="text-sm font-semibold" data-slot="hover-card-title">Vivek Khandelwal</div>
 *         <p class="text-sm text-muted-foreground">Builds the platform, not against it.</p>
 *         <a class="text-sm underline" href="/user/vivek/posts">Read the posts</a>
 *       </div>
 *     </div>
 *   </ui-hover-card-content>
 * </ui-hover-card>
 * ```
 */
import { WebComponent, html, prop } from '@webjsdev/core';
import { ensureId } from '../lib/utils.ts';
import { onBeforeCache } from '../lib/dom.ts';
import { positionFloating, type PopoverSide, type PopoverAlign } from './popover.ts';

// `fixed m-0` opts out of the UA `[popover]` auto-centering margin so
// JS-computed top/left from positionFloating lands correctly. shadcn's
// visual layer sits on top. UA `[popover]:not(:popover-open) {
// display: none }` handles closed-state hiding.
export const hoverCardContentClass = (): string =>
  'fixed z-50 w-64 m-0 rounded-md border bg-popover p-4 text-popover-foreground shadow-e2 outline-hidden';

// --------------------------------------------------------------------------
// <ui-hover-card>
// --------------------------------------------------------------------------

export class UiHoverCard extends WebComponent({
  open: prop(Boolean, { reflect: true }),
  // `openDelay` / `closeDelay` ride the `open-delay` / `close-delay`
  // attributes (shadcn parity), read as typed props.
  openDelay: Number,
  closeDelay: Number,
}) {
  _showTimer: number | undefined;
  _hideTimer: number | undefined;

  _keyHandler = (e: KeyboardEvent): void => this._onKeyDown(e);

  constructor() {
    super();
    this.open = false;
    this.openDelay = 700;
    this.closeDelay = 300;
  }

  _disposeBeforeCache?: () => void;

  connectedCallback(): void {
    super.connectedCallback?.();
    // webjs projects slotted light-DOM children after the first render, so
    // the trigger control is not in place at connect. Defer to the next
    // frame, when the projection has run.
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => this._wireAria());
    }
    // Close before the page is cached for back/forward so a restored snapshot
    // does not come back frozen open (#766).
    this._disposeBeforeCache = onBeforeCache(() => { this.open = false; });
  }

  disconnectedCallback(): void {
    this._unbindEscape();
    this._disposeBeforeCache?.();
    super.disconnectedCallback?.();
  }

  // A hover card can hold interactive content and cover what is under it, so a
  // keyboard user needs a way out that is not "tab through the whole card".
  // Bound only WHILE OPEN so a closed card cannot swallow Escape.
  _onKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || !this.open) return;
    e.preventDefault();
    this._dismiss();
  }

  // Immediate, unlike hide()'s close-delay linger, since a dismissal is
  // deliberate. Focus moves out BEFORE the panel hides: the content is
  // popover="manual", so hiding it while a descendant holds focus drops focus
  // to <body> and the user loses their place on the page.
  _suppressReopen = false;

  _dismiss(): void {
    clearTimeout(this._showTimer);
    clearTimeout(this._hideTimer);
    this._closeReleasingFocus();
  }

  _focusIsInContent(): boolean {
    if (typeof document === 'undefined') return false;
    const content = this.querySelector('ui-hover-card-content');
    const active = document.activeElement;
    return !!content && !!active && content.contains(active);
  }

  _bindEscape(): void {
    if (typeof document === 'undefined') return;
    document.addEventListener('keydown', this._keyHandler);
  }

  _unbindEscape(): void {
    if (typeof document === 'undefined') return;
    document.removeEventListener('keydown', this._keyHandler);
  }

  // The trigger also opens on focus (see the @focusin handler), so it is
  // keyboard-reachable: expose the popup relationship on the focusable
  // control. aria-expanded is refreshed on every open transition.
  _control(): HTMLElement | null {
    const t = this.querySelector('ui-hover-card-trigger');
    if (!t) return null;
    return (
      t.querySelector<HTMLElement>('a[href], button, [tabindex], [role="button"]') ??
      (t as HTMLElement)
    );
  }

  _wireAria(): void {
    const control = this._control();
    if (!control) return;
    control.setAttribute('aria-haspopup', 'dialog');
    control.setAttribute('aria-expanded', String(this.open));
    const content = this.querySelector<HTMLElement>('ui-hover-card-content [role="dialog"]');
    if (!content) return;
    control.setAttribute('aria-controls', ensureId(content, 'ui-hovercard'));
    this._nameContent(content, control);
  }

  // role="dialog" REQUIRES an accessible name. Without one a screen reader
  // announces a bare "dialog" with no hint of what it holds, which is an ARIA
  // defect rather than a missing nicety. Three sources, most specific first:
  //   1. what the author put on <ui-hover-card-content>, which always wins
  //   2. a title node inside the card (the dialog.ts idiom)
  //   3. the trigger, since the card is ABOUT whatever the trigger names
  //      ("@vivek" names that user's card). Same fallback the dropdown menu
  //      already uses to label its panel back to its trigger.
  // Source 3 is what makes the name unconditional: there is no shape of this
  // component that can end up with an unnamed dialog role.
  _nameContent(content: HTMLElement, control: HTMLElement): void {
    const host = this.querySelector('ui-hover-card-content');
    // aria-labelledby is checked FIRST because it beats aria-label per accname,
    // matching dialog / alert-dialog / toggle. Checking aria-label first would
    // name this panel by the attribute that loses everywhere else, so an author
    // writing both would get a different name here than in a dialog.
    const authoredLabelledBy = host?.getAttribute('aria-labelledby');
    if (authoredLabelledBy) {
      content.setAttribute('aria-labelledby', authoredLabelledBy);
      return;
    }
    const authoredLabel = host?.getAttribute('aria-label');
    if (authoredLabel) {
      content.setAttribute('aria-label', authoredLabel);
      // This method re-runs on every open change, and the fallback below writes
      // aria-labelledby unconditionally. So a card named from its title on an
      // earlier pass still carries that reference, and it would outrank the
      // author's aria-label. Drop it, as dialog / alert-dialog do.
      content.removeAttribute('aria-labelledby');
      return;
    }
    // Already named by an earlier pass (this runs again on every open change).
    if (content.hasAttribute('aria-label') || content.hasAttribute('aria-labelledby')) return;
    const title = content.querySelector<HTMLElement>(
      '[data-slot="hover-card-title"], h1, h2, h3, h4, h5, h6',
    );
    content.setAttribute(
      'aria-labelledby',
      title
        ? ensureId(title, 'ui-hovercard-title')
        : ensureId(control, 'ui-hovercard-trigger'),
    );
  }

  // Back-compat getter.
  get isOpen(): boolean { return this.open; }

  show(): void {
    // A keyboard dismissal has to stick: _dismiss() moves focus to the trigger,
    // and that focusin lands right back here, which would reopen the card and
    // make Escape look broken. The guard is released once the transfer flushes.
    if (this._suppressReopen) return;
    clearTimeout(this._hideTimer);
    this._showTimer = window.setTimeout(() => { this.open = true; }, this.openDelay);
  }

  hide(): void {
    clearTimeout(this._showTimer);
    // Clear the PENDING hide before scheduling the next one. Overwriting the
    // handle alone orphans the old timer, which then fires on its own and
    // closes the card after a later show() thought it had cancelled the close.
    // Reachable whenever two leave paths fire without a show() between them,
    // and the focus linger below doubles how many of those paths exist.
    clearTimeout(this._hideTimer);
    this._hideTimer = window.setTimeout(() => {
      // The card KEEPS ITSELF OPEN while focus is inside it. That is what makes
      // in-card content Tab-reachable and what both doc surfaces promise, and a
      // mouseleave can schedule this close while a keyboard user still holds
      // focus on an in-card link. Closing then would pull the card out from
      // under them, so leave it open: the content's own focusout schedules the
      // close once focus has actually left, and that pass takes this branch.
      if (this._focusIsInContent()) return;
      this.open = false;
    }, this.closeDelay);
  }

  // Every close of this popover="manual" panel owes the same focus care, not
  // just Escape. The focus linger added here makes in-card content Tab-
  // reachable, so a user CAN be holding focus on a link inside the card when a
  // mouseleave-scheduled close fires; hiding the panel then drops focus to
  // <body>. Guarded, so a close while focus is elsewhere leaves it alone.
  //
  // The reopen suppression is what makes this terminate. Moving focus to the
  // trigger fires the trigger's own focusin, which calls show() and would
  // reopen the card the close just closed. It is released on the next
  // macrotask, once that synchronous focus transfer has been refused, so a
  // genuinely new hover or a fresh Tab back in still opens the card.
  _closeReleasingFocus(): void {
    this._suppressReopen = true;
    if (this._focusIsInContent()) this._control()?.focus();
    this.open = false;
    setTimeout(() => { this._suppressReopen = false; }, 0);
  }

  // Touch open: there is no hover delay and no mouseleave to close it, so open
  // immediately and arm a one-shot outside-tap dismiss (a tap anywhere outside
  // this card closes it). Deferred a tick so the opening tap itself does not
  // immediately dismiss it.
  openByTouch(): void {
    clearTimeout(this._showTimer);
    clearTimeout(this._hideTimer);
    this.open = true;
    const onOutside = (ev: Event): void => {
      // Close on an outside tap; also self-remove if the card was already
      // closed by other means (a re-tap toggle), so the listener never lingers.
      if (!this.open || !this.contains(ev.target as Node)) {
        // Same focus care as every other close path: the card may hold focus.
        this._closeReleasingFocus();
        document.removeEventListener('pointerdown', onOutside, true);
      }
    };
    setTimeout(() => document.addEventListener('pointerdown', onOutside, true), 0);
  }

  render() {
    return html`<div
      data-slot="hover-card"
      data-state=${this.open ? 'open' : 'closed'}
    ><slot></slot></div>`;
  }

  updated(changedProperties: Map<string, unknown>): void {
    if (!changedProperties.has('open')) return;
    if (changedProperties.get('open') === undefined) return;
    // Bind synchronously rather than in the microtask below, which bails on
    // engines with no Popover API: Escape has to work regardless of that.
    if (this.open) this._bindEscape();
    else this._unbindEscape();
    // Wait one microtask for <ui-hover-card-content>'s inner [popover]
    // element to commit; we drive its showPopover() / hidePopover() and
    // refresh the trigger's aria-expanded.
    queueMicrotask(() => {
      this._wireAria();
      this._syncContent();
    });
  }

  _syncContent(): void {
    // Same nested-popover pattern as tooltip: <ui-hover-card-content>
    // renders an inner <div popover="manual">; the Popover API lives on
    // that inner div, not the host.
    const popover = this.querySelector<HTMLElement>('ui-hover-card-content [popover]');
    const host = this.querySelector<HTMLElement>('ui-hover-card-content');
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
    const trigger = this.querySelector<HTMLElement>('ui-hover-card-trigger');
    if (!trigger) return;
    positionFloating(trigger, popover, {
      side: (contentHost.getAttribute('side') ?? 'bottom') as PopoverSide,
      align: (contentHost.getAttribute('align') ?? 'center') as PopoverAlign,
      sideOffset: Number(contentHost.getAttribute('side-offset') ?? 4),
      alignOffset: Number(contentHost.getAttribute('align-offset') ?? 0),
    });
  }
}
UiHoverCard.register('ui-hover-card');

// --------------------------------------------------------------------------
// <ui-hover-card-trigger>
// --------------------------------------------------------------------------

export class UiHoverCardTrigger extends WebComponent {
  render() {
    return html`<div
      data-slot="hover-card-trigger"
      @mouseenter=${this._onEnter}
      @mouseleave=${this._onLeave}
      @focusin=${this._onEnter}
      @focusout=${this._onLeave}
      @click=${this._onClick}
    ><slot></slot></div>`;
  }

  // Hover/focus open + close are MOUSE affordances. On a no-hover (touch)
  // device, iOS Safari still fires SYNTHETIC mouseenter/mouseleave (and
  // focusin/focusout from the inner link) around a tap, which would otherwise
  // immediately re-close a tap-opened card. Gate the hover handlers to pointer
  // devices so on touch the card is driven only by the tap path (#745).
  _noHover = (): boolean => !!window.matchMedia?.('(hover: none)').matches;
  _onEnter = (): void => {
    if (this._noHover()) return;
    (this.closest('ui-hover-card') as UiHoverCard | null)?.show();
  };
  _onLeave = (): void => {
    if (this._noHover()) return;
    (this.closest('ui-hover-card') as UiHoverCard | null)?.hide();
  };

  // Touch path. A touch device has no `mouseenter`, so a tap would fall through
  // to the inner `<a href>` and navigate. On a no-hover device the trigger tap
  // TOGGLES the card and NEVER navigates (the real link is reachable inside the
  // opened card). It must ALWAYS preventDefault, including while open: the
  // client router pushState()s on any bubble-phase `<a>` click that is not
  // defaultPrevented, so a re-tap that fell through would push a history entry
  // every time and Back would need N presses (#745).
  _onClick = (e: Event): void => {
    if (!window.matchMedia?.('(hover: none)').matches) return;
    const card = this.closest('ui-hover-card') as UiHoverCard | null;
    if (!card) return;
    e.preventDefault();
    e.stopPropagation();
    if (card.open) card.open = false;
    else card.openByTouch();
  };
}
UiHoverCardTrigger.register('ui-hover-card-trigger');

// --------------------------------------------------------------------------
// <ui-hover-card-content>
// The mouseenter/mouseleave handlers keep the card open while the cursor
// is over the content itself (so it does not close during a brief
// mouseleave on the trigger if the user is moving toward the card).
// focusin/focusout mirror that linger for the KEYBOARD: the trigger closes
// the card on its own focusout, so without these, Tabbing from the trigger
// toward the card scheduled the close before focus could land inside, and
// the interactive content the JSDoc example shows was unreachable.
// --------------------------------------------------------------------------

export class UiHoverCardContent extends WebComponent {
  render() {
    return html`<div
      data-slot="hover-card-content"
      role="dialog"
      popover="manual"
      class=${hoverCardContentClass()}
      @mouseenter=${this._onEnter}
      @mouseleave=${this._onLeave}
      @focusin=${this._onEnter}
      @focusout=${this._onLeave}
    ><slot></slot></div>`;
  }

  // Hover/focus open + close are MOUSE affordances. On a no-hover (touch)
  // device, iOS Safari still fires SYNTHETIC mouseenter/mouseleave (and
  // focusin/focusout from the inner link) around a tap, which would otherwise
  // immediately re-close a tap-opened card. Gate the hover handlers to pointer
  // devices so on touch the card is driven only by the tap path (#745).
  _noHover = (): boolean => !!window.matchMedia?.('(hover: none)').matches;
  _onEnter = (): void => {
    if (this._noHover()) return;
    (this.closest('ui-hover-card') as UiHoverCard | null)?.show();
  };
  _onLeave = (): void => {
    if (this._noHover()) return;
    (this.closest('ui-hover-card') as UiHoverCard | null)?.hide();
  };
}
UiHoverCardContent.register('ui-hover-card-content');
