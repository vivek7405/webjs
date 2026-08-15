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
 * A11y (owned by the element, but SUPPLY A TITLE):
 *   On open the element names and describes the panel from the
 *   `data-slot="dialog-title"` / `dialog-description` nodes, falling back to
 *   the first heading / paragraph. An `aria-label` or `aria-labelledby` you put
 *   on `<ui-dialog-content>` is forwarded onto the panel and wins over both.
 *   A modal MUST have an accessible name, so with no title node and no name of
 *   your own the panel falls back to a generic `aria-label="Dialog"`. That is a
 *   floor to make an unnamed modal impossible, NOT a substitute: give the
 *   dialog a real title, since "Dialog" tells a screen reader user nothing
 *   about what they have been interrupted with.
 *   `role="dialog"` and the name both sit on the NATIVE `<dialog>`, not on the
 *   inner content div, so exactly one dialog-family node is exposed in the
 *   accessibility tree. There is no `aria-modal`: a `showModal()`-opened
 *   native dialog is already exposed as modal by the platform.
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
// The description is independent of the NAME, so it is wired on every path,
// including the two authored-name early returns below. An author who names the
// dialog still gets their description node described.
function wireDialogDescription(host: Element, panel: Element): void {
  const authored = host.getAttribute('aria-describedby');
  if (authored) {
    panel.setAttribute('aria-describedby', authored);
    return;
  }
  // Clear the previous open's value before resolving again. The panel keeps its
  // attributes between opens, so a guard that skips when the attribute is
  // already present can never re-resolve: remove the description node and
  // re-open, and the stale aria-describedby survives pointing at a dead IDREF.
  panel.removeAttribute('aria-describedby');
  const desc =
    host.querySelector('[data-slot="dialog-description"]') ?? host.querySelector('p');
  if (desc) {
    panel.setAttribute('aria-describedby', ensureId(desc as HTMLElement, 'ui-dialog-desc'));
  }
}

export function wireDialogLabels(host: Element, panelSelector: string): void {
  const panel = host.querySelector(panelSelector);
  if (!panel) return;
  // A name the author put on <ui-dialog-content> is where they naturally write
  // it, but role="dialog" lives on the native <dialog>, so forward it there.
  //
  // This RETURNS once an authored name is forwarded, rather than falling
  // through to the title wiring below. Falling through would set
  // aria-labelledby from the title alongside the forwarded aria-label, and
  // aria-labelledby beats aria-label per accname, so the title would silently
  // win over the name the author asked for.
  const authoredLabelledBy = host.getAttribute('aria-labelledby');
  if (authoredLabelledBy) {
    panel.setAttribute('aria-labelledby', authoredLabelledBy);
    wireDialogDescription(host, panel);
    return;
  }
  const authoredLabel = host.getAttribute('aria-label');
  if (authoredLabel) {
    panel.setAttribute('aria-label', authoredLabel);
    // An authored name replaces the title as the NAME, so any stale
    // aria-labelledby from an earlier open must go, or it would win over it.
    panel.removeAttribute('aria-labelledby');
    wireDialogDescription(host, panel);
    return;
  }
  // Same re-resolve rule: clear what a previous open wrote, or a removed title
  // node leaves a stale aria-labelledby that points at a dead IDREF AND
  // suppresses the floor below, which exists to prevent exactly that state.
  panel.removeAttribute('aria-labelledby');
  const title =
    host.querySelector('[data-slot="dialog-title"]') ?? host.querySelector('h1, h2, h3');
  if (title) {
    panel.setAttribute('aria-labelledby', ensureId(title as HTMLElement, 'ui-dialog-title'));
  }
  wireDialogDescription(host, panel);
  // APG: a modal MUST have an accessible name. Everything above supplies one
  // only when the author gave the dialog a title node or named it directly, so
  // a title-less dialog shipped unnamed and was announced as a bare "dialog".
  // This generic name is a floor, not a substitute for a real title: it makes
  // an unnamed modal impossible, and a supplied title always wins over it.
  if (!panel.hasAttribute('aria-labelledby') && !panel.hasAttribute('aria-label')) {
    panel.setAttribute('aria-label', 'Dialog');
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
// Page scroll lock, refcounted so nested dialogs release safely in ANY order.
// Native <dialog> does not lock scrolling, it only inert-ifies the background.
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
// --------------------------------------------------------------------------

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
  _scrollLocked?: boolean;

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
    wireDialogLabels(this, 'dialog[data-slot="dialog-native"]');
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
      role="dialog"
      class=${NATIVE_DIALOG_CLASS}
      ${ref(this.#dialog)}
      @close=${this._onNativeClose}
      @click=${this._onNativeBackdropClick}
    ><div
      data-slot="dialog-content"
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
