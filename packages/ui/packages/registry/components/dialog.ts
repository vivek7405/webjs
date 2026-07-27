/**
 * Dialog: modal dialog built on the native `<dialog>` element. Tier-2.
 * The custom element is a thin decorator over `HTMLDialogElement.showModal()`,
 * which gives us top-layer rendering (no z-index wars), the `::backdrop`
 * pseudo, focus trap with initial-focus + restore-on-close, Escape-to-close
 * via the cancel event, and background-inert for free.
 *
 * Composition: `<ui-dialog-content>` owns the native `<dialog>` element
 * (its render() emits the `<dialog>` wrapper around its slotted content),
 * while `<ui-dialog>` just tracks open state and asks the content child
 * to `showModal()` / `close()`. Every <slot> is a default slot, which
 * avoids the SSR pitfall where slot="..." set in connectedCallback never
 * runs server-side (linkedom has no upgrade lifecycle).
 *
 * shadcn parity:
 *   Dialog             → <ui-dialog open>
 *   DialogTrigger      → <ui-dialog-trigger>
 *   DialogContent      → <ui-dialog-content show-close-button>
 *   DialogClose        → <ui-dialog-close>
 *   DialogHeader       → <div class=${dialogHeaderClass()}>
 *   DialogTitle        → <h2 class=${dialogTitleClass()}>
 *   DialogDescription  → <p class=${dialogDescriptionClass()}>
 *   DialogFooter       → <div class=${dialogFooterClass()}>
 *
 * Attributes on <ui-dialog>:
 *   `open`:  boolean (reflected). Presence shows the dialog.
 *
 * Attributes on <ui-dialog-content>:
 *   `show-close-button`: "false" suppresses the auto-injected top-right X
 *                        close button (default: shown).
 *
 * Events:
 *   `ui-open-change` on <ui-dialog>: `{ detail: { open } }` after a transition.
 *
 * Programmatic API on <ui-dialog>: `.show()` · `.hide()` · `.toggle()`.
 *
 * Keyboard: Escape closes (native `cancel` event); Tab cycles trapped
 * within the dialog (native focus trap).
 *
 * Design tokens used: --background, --border, --muted-foreground.
 *
 * @example
 * ```html
 * <ui-dialog>
 *   <ui-dialog-trigger>
 *     <button class=${buttonClass({ variant: 'outline' })}>Edit profile</button>
 *   </ui-dialog-trigger>
 *   <ui-dialog-content>
 *     <div class=${dialogHeaderClass()}>
 *       <h2 data-slot="dialog-title" class=${dialogTitleClass()}>Edit profile</h2>
 *       <p data-slot="dialog-description" class=${dialogDescriptionClass()}>Make changes and click save.</p>
 *     </div>
 *     <div class="grid gap-3">
 *       <label class=${labelClass()} for="dlg-name">Name</label>
 *       <input class=${inputClass()} id="dlg-name" placeholder="Your name">
 *     </div>
 *     <div class=${dialogFooterClass()}>
 *       <ui-dialog-close><button class=${buttonClass({ variant: 'outline' })}>Cancel</button></ui-dialog-close>
 *       <button class=${buttonClass()}>Save</button>
 *     </div>
 *   </ui-dialog-content>
 * </ui-dialog>
 *
 * <!-- Suppress the auto-injected top-right X close button. -->
 * <ui-dialog-content show-close-button="false">
 *   <div class=${dialogHeaderClass()}>
 *     <h2 data-slot="dialog-title" class=${dialogTitleClass()}>Quiet dialog</h2>
 *   </div>
 * </ui-dialog-content>
 * ```
 */
import { WebComponent, html, unsafeHTML, prop } from '@webjsdev/core';
import { ref, createRef } from '@webjsdev/core/directives';
import { ensureId } from '../lib/utils.ts';
import { onBeforeCache } from '../lib/dom.ts';
import { buttonClass } from './button.ts';

// Wires a dialog panel's accessible name + description to its title /
// description nodes. A dialog only ever appears via showModal() (JS), so
// resolving the relationship at open time is correct and avoids any
// SSR id-stability concern. The title is the element marked
// data-slot="dialog-title" (falling back to the first heading); the
// description is data-slot="dialog-description" (falling back to the first
// paragraph). Author-set aria-labelledby / aria-describedby always win.
export function wireDialogLabels(host: Element, panelSelector: string): void {
  const panel = host.querySelector(panelSelector);
  if (!panel) return;
  const title =
    host.querySelector('[data-slot="dialog-title"]') ?? host.querySelector('h1, h2, h3');
  const desc =
    host.querySelector('[data-slot="dialog-description"]') ?? host.querySelector('p');
  if (title && !panel.hasAttribute('aria-labelledby')) {
    panel.setAttribute('aria-labelledby', ensureId(title as HTMLElement, 'ui-dialog-title'));
  }
  if (desc && !panel.hasAttribute('aria-describedby')) {
    panel.setAttribute('aria-describedby', ensureId(desc as HTMLElement, 'ui-dialog-desc'));
  }
}

// --------------------------------------------------------------------------
// Class helpers for subparts.
// --------------------------------------------------------------------------

export const dialogHeaderClass = (): string =>
  'flex flex-col gap-2 text-center sm:text-left';

export const dialogTitleClass = (): string =>
  'text-lg leading-none font-semibold';

export const dialogDescriptionClass = (): string =>
  'text-sm text-muted-foreground';

export const dialogFooterClass = (): string =>
  'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end';

export const dialogContentClass = (): string =>
  'fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 outline-none sm:max-w-lg';

export const dialogCloseButtonClass = (): string =>
  "absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

const DIALOG_CLOSE_X_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"></path></svg>';

// --------------------------------------------------------------------------
// Pre-hydration paint fallback. Before the script upgrades the custom
// elements, <ui-dialog-content> sits in normal flow and would flash
// visible. The selector-based rules hide it until JS marks the host as
// `[open]`. Once upgraded, the native <dialog> wrapper takes over:
// closed `<dialog>` is UA `display: none`; opened via showModal() is
// `display: block` in the top layer.
// --------------------------------------------------------------------------

const STYLES = `
ui-dialog:not([open]) ui-dialog-content { display: none !important; }
ui-dialog[open] { display: contents; }
ui-dialog-content { display: grid; }
`;

// Clears the UA defaults on <dialog> so it becomes an invisible top-layer
// host. The visible box is rendered by <ui-dialog-content>. The
// backdrop: variant styles the ::backdrop pseudo-element.
//
// The host FILLS THE VIEWPORT (fixed inset-0) rather than collapsing to
// 0x0 (#730): WebKit makes a top-layer <dialog> the containing block for
// its position:fixed descendants, so a 0x0 host collapsed the fixed content
// panel (w-full) to 0x0 and the dialog was invisible on iOS (Blink resolves
// the same fixed panel against the viewport, so it worked on Android). A
// viewport-sized transparent host gives the panel a correct containing block
// on both engines; the panel still centers itself and the ::backdrop covers
// the screen.
const NATIVE_DIALOG_CLASS = 'fixed inset-0 border-0 bg-transparent p-0 m-0 max-w-none max-h-none overflow-visible text-inherit backdrop:bg-black/50';

function installStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('ui-dialog-styles')) return;
  const style = document.createElement('style');
  style.id = 'ui-dialog-styles';
  style.textContent = STYLES;
  document.head.appendChild(style);
}

// --------------------------------------------------------------------------
// Body scroll lock. Refcounted so nested dialogs unlock in order. Native
// <dialog> does not lock body scroll, only inert-ifies the background.
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
// --------------------------------------------------------------------------

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
// <ui-dialog>
// Owns the open state. Defers the actual <dialog> element to the child
// <ui-dialog-content> (so no named slot is needed, which avoids the
// SSR routing problem). On open transitions, asks the content child
// to showModal() / close() its inner <dialog>.
// --------------------------------------------------------------------------

export class UiDialog extends WebComponent({
  open: prop(Boolean, { reflect: true }),
}) {
  constructor() {
    super();
    this.open = false;
  }

  _disposeBeforeCache?: () => void;

  connectedCallback(): void {
    installStyles();
    // Legacy <ui-dialog-overlay> isn't supported anymore; the native
    // ::backdrop pseudo replaces it. Strip it if a stale doc uses it.
    this.querySelector<HTMLElement>(':scope > ui-dialog-overlay')?.remove();
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
  toggle(): void { this.open = !this.open; }

  // Back-compat getter alongside the reactive `open` prop.
  get isOpen(): boolean { return this.open; }

  render() {
    return html`<div data-slot="dialog" data-state=${this.open ? 'open' : 'closed'}>
      <slot></slot>
    </div>`;
  }

  updated(changedProperties: Map<string, unknown>): void {
    if (!changedProperties.has('open')) return;
    // Constructor sets open=false, which records a (undefined -> false)
    // transition in the first update. Skip it so the dialog doesn't
    // emit a teardown + ui-open-change for the initial state.
    if (changedProperties.get('open') === undefined) return;
    // Defer one microtask so the content child has committed its own
    // render (the native <dialog> element lives in the content's template).
    queueMicrotask(() => {
      if (this.open) this._setup();
      else this._teardown();
      this.dispatchEvent(
        new CustomEvent('ui-open-change', { detail: { open: this.open }, bubbles: true }),
      );
    });
  }

  get _content(): UiDialogContent | null {
    return this.querySelector('ui-dialog-content') as UiDialogContent | null;
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
UiDialog.register('ui-dialog');

// --------------------------------------------------------------------------
// <ui-dialog-trigger>
// --------------------------------------------------------------------------

export class UiDialogTrigger extends WebComponent {
  render() {
    return html`<div
      data-slot="dialog-trigger"
      @click=${this._onClick}
    ><slot></slot></div>`;
  }

  _onClick = (): void => {
    (this.closest('ui-dialog') as UiDialog | null)?.show();
  };
}
UiDialogTrigger.register('ui-dialog-trigger');

// --------------------------------------------------------------------------
// <ui-dialog-content>
// Auto-injects an X close button (top-right) unless show-close-button="false".
// --------------------------------------------------------------------------

// <ui-dialog-content> owns the native <dialog> element. Renders a native
// <dialog> wrapper around its slotted content, plus the auto-injected X
// close button. Exposes showModal() / close() so the parent <ui-dialog>
// can drive the open state imperatively without a named slot.

export class UiDialogContent extends WebComponent({
  showCloseButton: prop(String, { reflect: true, attribute: 'show-close-button' }),
}) {
  // ref to the own-rendered native <dialog>. render() creates it, so a
  // ref() binding is the lit-idiomatic handle (no querySelector against
  // a string selector into the component's own output).
  #dialog = createRef<HTMLDialogElement>();

  constructor() {
    super();
    this.showCloseButton = 'true';
  }

  // Resolve the native <dialog> by query, NOT the #dialog ref: on iOS WebKit
  // the ref's `.value` came back null (the ref binding did not populate through
  // SSR hydration), so showModal() was never called and the dialog never opened
  // (#730). A direct querySelector is robust on every engine, and matches what
  // the tooltip / popover components already do.
  _native(): HTMLDialogElement | null {
    return this.querySelector<HTMLDialogElement>('dialog[data-slot="dialog-native"]');
  }

  showModal(): void {
    wireDialogLabels(this, '[data-slot="dialog-content"]');
    const native = this._native();
    if (native && !native.open) native.showModal();
  }

  close(): void {
    const native = this._native();
    if (native?.open) native.close();
  }

  render() {
    const wantClose = this.showCloseButton !== 'false';
    const parentOpen = !!this._parent()?.open;
    return html`<dialog
      data-slot="dialog-native"
      class=${NATIVE_DIALOG_CLASS}
      ${ref(this.#dialog)}
      @close=${this._onNativeClose}
      @click=${this._onNativeBackdropClick}
    ><div
      data-slot="dialog-content"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      data-state=${parentOpen ? 'open' : 'closed'}
      class=${dialogContentClass()}
    >
      <slot></slot>
      ${wantClose
        ? html`<button
            type="button"
            aria-label="Close"
            data-slot="dialog-close"
            class=${dialogCloseButtonClass()}
            @click=${this._onAutoCloseClick}
          >${unsafeHTML(DIALOG_CLOSE_X_SVG)}</button>`
        : ''}
    </div></dialog>`;
  }

  _onAutoCloseClick = (): void => {
    this._parent()?.hide();
  };

  _onNativeClose = (): void => {
    const p = this._parent();
    if (p?.open) p.open = false;
  };

  // Backdrop-click closes the dialog: the click target on the backdrop is
  // the <dialog> element itself (the inner content panel catches its own
  // clicks).
  _onNativeBackdropClick = (e: MouseEvent): void => {
    if (e.target === e.currentTarget) this._parent()?.hide();
  };

  // SSR-safe: linkedom doesn't implement closest() on custom elements.
  _parent(): UiDialog | null {
    if (typeof this.closest !== 'function') return null;
    return this.closest('ui-dialog') as UiDialog | null;
  }
}
UiDialogContent.register('ui-dialog-content');

// --------------------------------------------------------------------------
// <ui-dialog-close>
// --------------------------------------------------------------------------

export class UiDialogClose extends WebComponent {
  render() {
    return html`<div
      data-slot="dialog-close"
      @click=${this._onClick}
    ><slot></slot></div>`;
  }

  _onClick = (): void => {
    (this.closest('ui-dialog') as UiDialog | null)?.hide();
  };
}
UiDialogClose.register('ui-dialog-close');

// --------------------------------------------------------------------------
// <ui-dialog-footer>
// --------------------------------------------------------------------------

export class UiDialogFooter extends WebComponent({
  showCloseButton: prop<string | null>(String, { attribute: 'show-close-button' }),
}) {
  constructor() {
    super();
    this.showCloseButton = null;
  }

  render() {
    const wantClose = this.showCloseButton !== null && this.showCloseButton !== 'false';
    return html`<div data-slot="dialog-footer" class=${dialogFooterClass()}>
      <slot></slot>
      ${wantClose
        ? html`<ui-dialog-close>
            <button class=${buttonClass({ variant: 'outline' })} type="button">Close</button>
          </ui-dialog-close>`
        : ''}
    </div>`;
  }
}
UiDialogFooter.register('ui-dialog-footer');
