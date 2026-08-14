/**
 * AlertDialog: modal requiring explicit Cancel / Action confirmation.
 * Tier-2. Variant of Dialog with `role="alertdialog"`, no
 * Escape-to-close, no overlay-click-to-close. Built on the native
 * `<dialog>` element.
 *
 * APG pattern: https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/
 *
 * Composition follows dialog.ts: `<ui-alert-dialog-content>` owns the
 * native `<dialog>` (its render() emits the `<dialog>` wrapper around
 * its slotted content); the parent tracks open state and drives
 * showModal() / close() on the content child. Every <slot> is a default
 * slot, so SSR doesn't need to route children by name (which wouldn't
 * work because slot="..." set in connectedCallback never runs
 * server-side).
 *
 * shadcn parity:
 *   AlertDialog              → <ui-alert-dialog open>
 *   AlertDialogTrigger       → <ui-alert-dialog-trigger>
 *   AlertDialogContent       → <ui-alert-dialog-content size>
 *   AlertDialogHeader        → <div class=${alertDialogHeaderClass()}>
 *   AlertDialogTitle         → <h2 class=${alertDialogTitleClass()}>
 *   AlertDialogDescription   → <p class=${alertDialogDescriptionClass()}>
 *   AlertDialogFooter        → <div class=${alertDialogFooterClass()}>
 *   AlertDialogAction        → <ui-alert-dialog-action variant size>
 *   AlertDialogCancel        → <ui-alert-dialog-cancel variant size>
 *
 * Attributes on <ui-alert-dialog>:
 *   `open`:  boolean (reflected). Presence shows the dialog.
 *
 * Attributes on <ui-alert-dialog-content>:
 *   `size`:  "default" (default) | "sm". The sm size flips the footer to
 *           a 2-column grid with full-width buttons.
 *
 * Attributes on <ui-alert-dialog-action> / <ui-alert-dialog-cancel>:
 *   `variant`: ButtonVariant. Action defaults to "default", cancel to "outline".
 *   `size`:    ButtonSize. Defaults to "default".
 *
 * Events: none dispatched at present (no `ui-open-change`); observe the
 * reflected `open` attribute on `<ui-alert-dialog>`.
 *
 * Programmatic API on <ui-alert-dialog>: `.show()` · `.hide()`.
 *
 * Keyboard: Escape is blocked (alert dialogs require explicit choice);
 * Tab cycles trapped within the dialog (native focus trap).
 *
 * A11y (owned by the element, but SUPPLY A TITLE):
 *   On open the element names and describes the panel from the
 *   `data-slot="alert-dialog-title"` / `alert-dialog-description` nodes,
 *   falling back to the first heading / paragraph. An `aria-label` or
 *   `aria-labelledby` you put on `<ui-alert-dialog-content>` is forwarded onto
 *   the panel and wins over both.
 *   A modal MUST have an accessible name, so with no title node and no name of
 *   your own the panel falls back to a generic `aria-label="Alert dialog"`.
 *   Treat that as a bug in your markup rather than a feature: this dialog
 *   interrupts the user to demand an explicit choice and blocks Escape, so
 *   naming it "Alert dialog" tells them nothing about what they are deciding.
 *
 * Design tokens used: --background, --border, --muted-foreground.
 *
 * Scroll lock (#1144): opening the dialog locks body scroll, which hides the
 * page scrollbar and would widen the viewport. The lock reserves the scrollbar
 * gutter so the width never changes and a `position: fixed` header stays put.
 * Where the engine ignores `scrollbar-gutter` (WebKit today) it publishes the
 * leftover width on <html> as `--wj-scrollbar-compensation`, so a fixed header
 * opts in with `border-right: var(--wj-scrollbar-compensation, 0px) solid transparent`
 * (a transparent border composes with existing padding, and a background paints
 * across it, so a header keeps its own chrome full bleed).
 *
 * @example
 * ```html
 * <ui-alert-dialog>
 *   <ui-alert-dialog-trigger>
 *     <button class=${buttonClass({ variant: 'destructive' })}>Delete</button>
 *   </ui-alert-dialog-trigger>
 *   <ui-alert-dialog-content>
 *     <div class=${alertDialogHeaderClass()}>
 *       <h2 data-slot="alert-dialog-title" class=${alertDialogTitleClass()}>Delete account?</h2>
 *       <p data-slot="alert-dialog-description" class=${alertDialogDescriptionClass()}>This cannot be undone.</p>
 *     </div>
 *     <div class=${alertDialogFooterClass()}>
 *       <ui-alert-dialog-cancel>Cancel</ui-alert-dialog-cancel>
 *       <ui-alert-dialog-action variant="destructive">Delete</ui-alert-dialog-action>
 *     </div>
 *   </ui-alert-dialog-content>
 * </ui-alert-dialog>
 * ```
 */
import { WebComponent, html, prop } from '@webjsdev/core';
import { ref, createRef } from '@webjsdev/core/directives';
import { ensureId } from '../lib/utils.ts';
import { onBeforeCache } from '../lib/dom.ts';
import { buttonClass, type ButtonVariant, type ButtonSize } from './button.ts';

export const alertDialogContentClass = (): string =>
  'group/alert-dialog-content fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadcn-lg shadow-e3 duration-200 data-[size=sm]:max-w-xs data-[size=default]:sm:max-w-lg';

export const alertDialogHeaderClass = (): string =>
  'grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-left';

export const alertDialogFooterClass = (): string =>
  'flex flex-col-reverse gap-2 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 sm:flex-row sm:justify-end';

export const alertDialogTitleClass = (): string => 'text-lg font-semibold';

export const alertDialogDescriptionClass = (): string => 'text-sm text-muted-foreground';

// Pre-hydration paint fallback (see dialog.ts for the long version).
const STYLES = `
ui-alert-dialog:not([open]) ui-alert-dialog-content { display: none !important; }
ui-alert-dialog-content { display: grid; }
`;

// Fills the viewport (fixed inset-0), NOT 0x0 (#730): WebKit makes a
// top-layer <dialog> the containing block for its position:fixed descendants,
// so a 0x0 host collapsed the fixed content panel to 0x0 (invisible on iOS).
const NATIVE_DIALOG_CLASS = 'fixed inset-0 border-0 bg-transparent p-0 m-0 max-w-none max-h-none overflow-visible text-inherit backdrop:bg-black/50';

function installStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('ui-alert-dialog-styles')) return;
  const style = document.createElement('style');
  style.id = 'ui-alert-dialog-styles';
  style.textContent = STYLES;
  document.head.appendChild(style);
}

// Page scroll lock, refcounted so nested dialogs release safely in ANY order.
// Kept in lockstep with dialog.ts (not imported) so `webjs ui add alert-dialog`
// doesn't pull in the full dialog component.
//
// Hiding the page scrollbar widens the viewport by the scrollbar's width, so
// anything laid out against the viewport moves. Padding the page holds in-flow
// content still, but a `position: fixed` header lays out against the initial
// containing block, never against any padding box, so padding alone leaves it
// sliding right by half the scrollbar width. Two mechanisms fix it:
//
//   1. Reserve the scrollbar gutter for the duration of the lock, so the
//      viewport width never changes and NOTHING moves, in flow or fixed. This
//      needs no cooperation from the page. Measured honoured on Chromium.
//   2. Where the engine ignores it (measured on WebKit), fall back to
//      padding <html> and publish the leftover width as
//      `--wj-scrollbar-compensation` on it, so a fixed element can opt in with
//      `border-right: var(--wj-scrollbar-compensation, 0px) solid transparent`.
//
// Everything below is MEASURED rather than assumed, because engines disagree
// about both scrollbar geometry and gutter support. When mechanism 1 works the
// measured residual is zero, so no padding is applied and the custom property is
// never set: the two mechanisms cannot double-compensate.
//
// The lock's state is DOCUMENT level, so it is keyed on globalThis rather than
// module scope. dialog.ts and alert-dialog.ts ship as separate copies (so
// `webjs ui add alert-dialog` stays self contained), and two independent
// counters mutating the same <html> can only be released safely in LIFO order.
// They are not: `disconnectedCallback` fires in tree order and the #766
// before-cache close runs in registration order, so a confirm inside a dialog
// releases OUTER first, and the inner unlock would then re-apply the values it
// captured with nothing left to clear them, leaving <html> padded for good. One
// shared counter makes release order irrelevant.
interface ScrollLockState {
  count: number;
  overflow: string;
  rootPaddingRight: string;
  scrollbarGutter: string;
  compensation: string;
}

const SCROLLBAR_COMPENSATION = '--wj-scrollbar-compensation';

function scrollLockState(): ScrollLockState {
  // The key follows the framework's global-key prefix (see `__webjsSonnerBus` in
  // sonner.ts, the same pattern for the same reason), and the cast is typed
  // rather than a string-keyed bag, so a change to the shape is a type error in
  // both copies instead of a silent undefined at runtime.
  const store = globalThis as unknown as { __webjsScrollLock?: ScrollLockState };
  let state = store.__webjsScrollLock;
  if (!state) {
    state = { count: 0, overflow: '', rootPaddingRight: '', scrollbarGutter: '', compensation: '' };
    store.__webjsScrollLock = state;
  }
  return state;
}

function lockScroll(): void {
  const state = scrollLockState();
  if (state.count === 0) {
    const root = document.documentElement;
    const body = document.body;
    const rootStyle = getComputedStyle(root);

    state.overflow = body.style.overflow;
    state.rootPaddingRight = root.style.paddingRight;
    state.scrollbarGutter = root.style.scrollbarGutter;
    state.compensation = root.style.getPropertyValue(SCROLLBAR_COMPENSATION);

    // <html> is an in-flow block filling the initial containing block, so its
    // border box IS the viewport width, and it is re-laid-out synchronously.
    // A `position: fixed` probe is NOT a substitute: WebKit keeps reporting its
    // old box until the next rendering update, so it reads a zero delta and the
    // compensation below never fires.
    const widthBefore = root.getBoundingClientRect().width;
    const padBefore = parseFloat(rootStyle.paddingRight) || 0;
    // An engine with no `scrollbar-gutter` at all reads back undefined, which
    // must be treated as "the page has not chosen" so the gutter is still
    // attempted (setting an unsupported property is a harmless no-op, and the
    // measured residual below is what actually decides the fallback).
    const chosenGutter = rootStyle.scrollbarGutter || 'auto';

    // Reserve the gutter, but only when the page has not already made its own
    // choice. An app running `stable both-edges` keeps both gutters through the
    // lock, and overwriting that with the single-edge value would drop one and
    // introduce the very shift this exists to prevent.
    if (chosenGutter === 'auto' && window.innerWidth > root.clientWidth) {
      root.style.scrollbarGutter = 'stable';
    }
    body.style.overflow = 'hidden';

    const grew = root.getBoundingClientRect().width - widthBefore;
    if (grew > 0) {
      // Padding the ROOT holds in-flow content still whatever the body's own
      // width is (a `max-width` body does not widen with the viewport, so
      // padding the body would miss it), and it leaves the page's own body
      // padding untouched.
      root.style.paddingRight = `${padBefore + grew}px`;
      // A fixed box lays out against the viewport, so no padding here can reach
      // it. Publish what it moved by and let it opt in.
      root.style.setProperty(SCROLLBAR_COMPENSATION, `${grew}px`);
    }
  }
  state.count++;
}

function unlockScroll(): void {
  const state = scrollLockState();
  // An unlock with no matching lock is a no-op, NOT the last release: clamping to
  // zero and restoring would replay a stale snapshot onto whatever the page owns
  // now. Belt-and-braces as things stand, because _teardown() only unlocks what
  // its own element locked, so no path through the components can reach here with
  // a zero count. It is kept because the cost is one comparison and the failure
  // it prevents is silent.
  if (state.count === 0) return;
  state.count--;
  if (state.count === 0) {
    const root = document.documentElement;
    document.body.style.overflow = state.overflow;
    root.style.paddingRight = state.rootPaddingRight;
    root.style.scrollbarGutter = state.scrollbarGutter;
    // Restored rather than removed, so a value the PAGE set before any dialog
    // opened survives the lock.
    if (state.compensation) root.style.setProperty(SCROLLBAR_COMPENSATION, state.compensation);
    else root.style.removeProperty(SCROLLBAR_COMPENSATION);
  }
}

// --------------------------------------------------------------------------
// <ui-alert-dialog>
// Owns the open state. Defers the actual <dialog> element to the child
// <ui-alert-dialog-content>, so no named slot is needed (which avoids
// the SSR slot-routing problem). Drives showModal() / close() on the
// content child via prop transitions.
// --------------------------------------------------------------------------

export class UiAlertDialog extends WebComponent({
  open: prop(Boolean, { reflect: true }),
}) {
  constructor() {
    super();
    this.open = false;
  }

  _disposeBeforeCache?: () => void;
  _scrollLocked?: boolean;

  connectedCallback(): void {
    installStyles();
    // Legacy <ui-alert-dialog-overlay> isn't supported anymore; the native
    // ::backdrop pseudo replaces it. Strip it if a stale doc uses it.
    this.querySelector<HTMLElement>(':scope > ui-alert-dialog-overlay')?.remove();
    super.connectedCallback?.();
    // Close before a back/forward snapshot: a modal restored half-open (the
    // `open` attr without the native showModal top-layer state) is broken (#766).
    this._disposeBeforeCache = onBeforeCache(() => { this.open = false; });
  }

  disconnectedCallback(): void {
    if (this.open) this._teardown();
    this._disposeBeforeCache?.();
    super.disconnectedCallback?.();
  }

  show(): void { this.open = true; }
  hide(): void { this.open = false; }

  // Back-compat getter alongside the reactive `open` prop.
  get isOpen(): boolean { return this.open; }

  render() {
    return html`<div data-slot="alert-dialog" data-state=${this.open ? 'open' : 'closed'}>
      <slot></slot>
    </div>`;
  }

  updated(changedProperties: Map<string, unknown>): void {
    if (!changedProperties.has('open')) return;
    // Skip the constructor's initial open=false set so we don't fire
    // teardown for the closed-on-mount state.
    if (changedProperties.get('open') === undefined) return;
    // Defer one microtask so the content child has rendered its inner
    // native <dialog>; that's where showModal() / close() act.
    queueMicrotask(() => {
      if (this.open) this._setup();
      else this._teardown();
    });
  }

  get _content(): UiAlertDialogContent | null {
    return this.querySelector('ui-alert-dialog-content') as UiAlertDialogContent | null;
  }

  _setup(): void {
    // A detached element must not lock: `updated()` defers this to a microtask,
    // and a removal in between already ran _teardown() as a no-op, so locking
    // here would never be released (nothing disconnects twice).
    if (!this.isConnected) return;
    const content = this._content;
    if (!content) return;
    // Idempotent, because the count is an integer and the flag is a boolean. A
    // coalesced hide() then show() in one task produces ONE update whose
    // changedProperties still reports open, so _setup() can run twice with no
    // _teardown() between; double-counting there would leave the page locked for
    // the rest of the session.
    if (!this._scrollLocked) {
      lockScroll();
      this._scrollLocked = true;
    }
    content.showModal();
  }

  _teardown(): void {
    // Release only what THIS element locked. _setup() returns before locking
    // when there is no content child, so an unconditional unlock here would
    // consume ANOTHER open dialog's count and restore the page out from under
    // it, dropping its compensation while it is still open.
    if (this._scrollLocked) {
      this._scrollLocked = false;
      unlockScroll();
    }
    this._content?.close();
  }
}
UiAlertDialog.register('ui-alert-dialog');

// --------------------------------------------------------------------------
// <ui-alert-dialog-trigger>
// --------------------------------------------------------------------------

export class UiAlertDialogTrigger extends WebComponent {
  render() {
    return html`<div
      data-slot="alert-dialog-trigger"
      @click=${this._onClick}
    ><slot></slot></div>`;
  }

  _onClick = (): void => (this.closest('ui-alert-dialog') as UiAlertDialog | null)?.show();
}
UiAlertDialogTrigger.register('ui-alert-dialog-trigger');

// --------------------------------------------------------------------------
// <ui-alert-dialog-content>
// Owns the native <dialog> element. Renders a <dialog> wrapper around its
// slotted children. Exposes showModal() / close() so the parent
// <ui-alert-dialog> can drive the open state imperatively without a
// named slot. Escape-to-close is blocked here (alert dialogs require an
// explicit choice via Cancel / Action).
// --------------------------------------------------------------------------

export class UiAlertDialogContent extends WebComponent({
  size: prop<'default' | 'sm'>(String, { reflect: true }),
}) {
  // ref to the own-rendered native <dialog>. render() creates it, so a
  // ref() binding is the lit-idiomatic handle (no querySelector against
  // a string selector into the component's own output).
  #dialog = createRef<HTMLDialogElement>();

  constructor() {
    super();
    this.size = 'default';
  }

  // Query the native <dialog> rather than the #dialog ref: the ref's `.value`
  // came back null on iOS WebKit (the binding did not populate through SSR
  // hydration), so showModal() never ran (#730). querySelector is robust on
  // every engine.
  _native(): HTMLDialogElement | null {
    return this.querySelector<HTMLDialogElement>('dialog[data-slot="alert-dialog-native"]');
  }

  showModal(): void {
    this._wireLabels();
    const native = this._native();
    if (native && !native.open) native.showModal();
  }

  // Wire the alertdialog's accessible name + description to its title /
  // description nodes at open time (an alert dialog only ever appears via
  // showModal(), so there is no SSR id-stability concern). The title is
  // data-slot="alert-dialog-title" (falling back to the first heading); the
  // description is data-slot="alert-dialog-description" (falling back to the
  // first paragraph). Author-set ARIA always wins. Inlined rather than shared
  // with dialog.ts so `webjs ui add alert-dialog` stays self-contained.
  // The description is independent of the NAME, so it is wired on every path,
  // including the two authored-name early returns.
  _wireDescription(panel: Element): void {
    const authored = this.getAttribute('aria-describedby');
    if (authored) {
      panel.setAttribute('aria-describedby', authored);
      return;
    }
    const desc =
      this.querySelector('[data-slot="alert-dialog-description"]') ?? this.querySelector('p');
    if (desc && !panel.hasAttribute('aria-describedby')) {
      panel.setAttribute('aria-describedby', ensureId(desc as HTMLElement, 'ui-alert-desc'));
    }
  }

  _wireLabels(): void {
    const panel = this.querySelector('[data-slot="alert-dialog-content"]');
    if (!panel) return;
    // A name the author put on <ui-alert-dialog-content> is where they
    // naturally write it, but role="alertdialog" lives on the inner panel.
    //
    // Each authored-name branch RETURNS rather than falling through to the
    // title wiring. Falling through would set aria-labelledby from the title
    // alongside the forwarded aria-label, and aria-labelledby beats aria-label
    // per accname, so the title would silently win over the author's name.
    const authoredLabelledBy = this.getAttribute('aria-labelledby');
    if (authoredLabelledBy) {
      panel.setAttribute('aria-labelledby', authoredLabelledBy);
      this._wireDescription(panel);
      return;
    }
    const authoredLabel = this.getAttribute('aria-label');
    if (authoredLabel) {
      panel.setAttribute('aria-label', authoredLabel);
      // An authored name replaces the title as the NAME, so a stale
      // aria-labelledby from an earlier open must go or it would win over it.
      panel.removeAttribute('aria-labelledby');
      this._wireDescription(panel);
      return;
    }
    const title =
      this.querySelector('[data-slot="alert-dialog-title"]') ?? this.querySelector('h1, h2, h3');
    if (title && !panel.hasAttribute('aria-labelledby')) {
      panel.setAttribute('aria-labelledby', ensureId(title as HTMLElement, 'ui-alert-title'));
    }
    this._wireDescription(panel);
    // APG: a modal MUST have an accessible name, and this one interrupts the
    // user to demand a decision, so an unnamed one is worse here than
    // anywhere. A floor, not a substitute for a real title; a title wins.
    if (!panel.hasAttribute('aria-labelledby') && !panel.hasAttribute('aria-label')) {
      panel.setAttribute('aria-label', 'Alert dialog');
    }
  }

  close(): void {
    const native = this._native();
    if (native?.open) native.close();
  }

  render() {
    const parentOpen = !!this._parent()?.open;
    return html`<dialog
      data-slot="alert-dialog-native"
      class=${NATIVE_DIALOG_CLASS}
      ${ref(this.#dialog)}
      @cancel=${this._onNativeCancel}
      @close=${this._onNativeClose}
    ><div
      data-slot="alert-dialog-content"
      role="alertdialog"
      aria-modal="true"
      tabindex="-1"
      data-size=${this.size}
      data-state=${parentOpen ? 'open' : 'closed'}
      class=${alertDialogContentClass()}
    ><slot></slot></div></dialog>`;
  }

  // Block native Escape-to-close. Alert dialogs require an explicit
  // Cancel / Action choice.
  _onNativeCancel = (e: Event): void => e.preventDefault();
  _onNativeClose = (): void => {
    const p = this._parent();
    if (p?.open) p.open = false;
  };

  // SSR-safe: linkedom doesn't implement closest() on custom elements.
  _parent(): UiAlertDialog | null {
    if (typeof this.closest !== 'function') return null;
    return this.closest('ui-alert-dialog') as UiAlertDialog | null;
  }
}
UiAlertDialogContent.register('ui-alert-dialog-content');

// --------------------------------------------------------------------------
// <ui-alert-dialog-cancel> + <ui-alert-dialog-action>
// shadcn's <AlertDialogAction> and <AlertDialogCancel> ARE button-styled
// elements with forwarded `variant` and `size` props. Each renders its
// own native <button> with @click handler; the user's label text or
// inline icon SVG projects through a slot inside that button.
//
// Authoring is bare text / icons, not a wrapped <button>:
//
//   <ui-alert-dialog-cancel>Cancel</ui-alert-dialog-cancel>
//   <ui-alert-dialog-action variant="destructive">Delete</ui-alert-dialog-action>
//
// (A legacy wrap-a-button form used to be supported by sniffing for an
// authored <button> in connectedCallback. SSR rendered the wrong branch
// because connectedCallback never fires server-side, producing invalid
// nested-<button> HTML that the parser flattened into siblings -- the
// "buttons have no text" symptom. Removed in favour of one canonical
// authoring shape that works in both SSR and CSR.)
//
// The extra `group-data-[size=sm]/alert-dialog-content:w-full` class
// makes the inner button stretch when the parent's footer flips to
// `grid grid-cols-2` (size=sm); otherwise the inline-flex button is
// content-width and sits at the start of its grid cell.
// --------------------------------------------------------------------------

const ALERT_DIALOG_ACTION_GRID_STRETCH = 'group-data-[size=sm]/alert-dialog-content:w-full';

export class UiAlertDialogCancel extends WebComponent({
  variant: prop<ButtonVariant>(String, { reflect: true }),
  size: prop<ButtonSize>(String, { reflect: true }),
}) {
  constructor() {
    super();
    this.variant = 'outline';
    this.size = 'default';
  }

  render() {
    return html`<button
      type="button"
      data-slot="alert-dialog-cancel"
      class="${buttonClass({ variant: this.variant, size: this.size })} ${ALERT_DIALOG_ACTION_GRID_STRETCH}"
      @click=${this._onClick}
    ><slot></slot></button>`;
  }

  _onClick = (): void => (this.closest('ui-alert-dialog') as UiAlertDialog | null)?.hide();
}
UiAlertDialogCancel.register('ui-alert-dialog-cancel');

export class UiAlertDialogAction extends WebComponent({
  variant: prop<ButtonVariant>(String, { reflect: true }),
  size: prop<ButtonSize>(String, { reflect: true }),
}) {
  constructor() {
    super();
    this.variant = 'default';
    this.size = 'default';
  }

  render() {
    return html`<button
      type="button"
      data-slot="alert-dialog-action"
      class="${buttonClass({ variant: this.variant, size: this.size })} ${ALERT_DIALOG_ACTION_GRID_STRETCH}"
      @click=${this._onClick}
    ><slot></slot></button>`;
  }

  _onClick = (): void => (this.closest('ui-alert-dialog') as UiAlertDialog | null)?.hide();
}
UiAlertDialogAction.register('ui-alert-dialog-action');
