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
 * Design tokens used: --background, --border, --muted-foreground.
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
  'group/alert-dialog-content fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadcn-lg shadow-lg duration-200 data-[size=sm]:max-w-xs data-[size=default]:sm:max-w-lg';

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

// Body scroll lock. Refcounted so nested dialogs unlock in order. Kept in
// lockstep with dialog.ts (not imported) so `webjs ui add alert-dialog`
// doesn't pull in the full dialog component.
//
// Hiding the page scrollbar widens the viewport by the scrollbar's width, so
// anything laid out against the viewport moves. Padding the body holds in-flow
// content still, but a `position: fixed` header lays out against the initial
// containing block, never against the body's padding box, so padding alone
// leaves it sliding right by half the scrollbar width. Two mechanisms fix it:
//
//   1. Reserve the scrollbar gutter for the duration of the lock, so the
//      viewport width never changes and NOTHING moves, in flow or fixed. This
//      needs no cooperation from the page. Chromium and Firefox honour it.
//   2. Where the engine ignores `scrollbar-gutter` (WebKit today), fall back to
//      padding the body and publish the leftover width as
//      `--wj-scrollbar-compensation` on <html>, so a fixed element can opt in
//      with `padding-right: var(--wj-scrollbar-compensation, 0px)`.
//
// Everything below is MEASURED rather than assumed, because engines disagree
// about both scrollbar geometry and gutter support. When mechanism 1 works the
// measured residual is zero, so the body is never padded and the custom
// property is never set: the two mechanisms cannot double-compensate.
const SCROLLBAR_COMPENSATION = '--wj-scrollbar-compensation';

let scrollLockCount = 0;
let savedOverflow = '';
let savedPaddingRight = '';
let savedScrollbarGutter = '';

function lockScroll(): void {
  if (scrollLockCount === 0) {
    const root = document.documentElement;
    const body = document.body;
    savedOverflow = body.style.overflow;
    savedPaddingRight = body.style.paddingRight;
    savedScrollbarGutter = root.style.scrollbarGutter;

    const widthBefore = body.getBoundingClientRect().width;
    // Only a CLASSIC scrollbar takes layout width and therefore needs a gutter.
    // Overlay scrollbars (macOS default, touch) take none, and reserving a
    // gutter for them would shrink the page instead of holding it still.
    if (window.innerWidth > root.clientWidth) root.style.scrollbarGutter = 'stable';
    body.style.overflow = 'hidden';

    const grew = body.getBoundingClientRect().width - widthBefore;
    if (grew > 0) {
      body.style.paddingRight = `${grew}px`;
      root.style.setProperty(SCROLLBAR_COMPENSATION, `${grew}px`);
    }
  }
  scrollLockCount++;
}

function unlockScroll(): void {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.overflow = savedOverflow;
    document.body.style.paddingRight = savedPaddingRight;
    document.documentElement.style.scrollbarGutter = savedScrollbarGutter;
    document.documentElement.style.removeProperty(SCROLLBAR_COMPENSATION);
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
    const content = this._content;
    if (!content) return;
    lockScroll();
    content.showModal();
  }

  _teardown(): void {
    unlockScroll();
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
  _wireLabels(): void {
    const panel = this.querySelector('[data-slot="alert-dialog-content"]');
    if (!panel) return;
    const title =
      this.querySelector('[data-slot="alert-dialog-title"]') ?? this.querySelector('h1, h2, h3');
    const desc =
      this.querySelector('[data-slot="alert-dialog-description"]') ?? this.querySelector('p');
    if (title && !panel.hasAttribute('aria-labelledby')) {
      panel.setAttribute('aria-labelledby', ensureId(title as HTMLElement, 'ui-alert-title'));
    }
    if (desc && !panel.hasAttribute('aria-describedby')) {
      panel.setAttribute('aria-describedby', ensureId(desc as HTMLElement, 'ui-alert-desc'));
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
