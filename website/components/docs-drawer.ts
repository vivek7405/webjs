import { WebComponent, prop, html, createRef, ref } from '@webjsdev/core';
import { lockScroll, unlockScroll } from '#lib/scroll-lock.ts';
import { escapeBelongsToField, composedTarget } from '#lib/escape-target.ts';

/**
 * `<docs-drawer>`: the sidebar shell shared by /docs and /ui, and the mobile
 * drawer it collapses into under 900px.
 *
 * This owns the whole feature: the backdrop, the toggle button, the aside
 * column, the open state, and every listener that can close it. That is the
 * point of it existing. The behaviour used to live in a delegated listener in
 * the ROOT layout while the markup lived in lib/ui/docs-shell.ts, coupled only
 * by a `.docs-nav-toggle` class selector, and every bug the tests pin came out
 * of that split: a backdrop dismiss that left `aria-expanded` reading true
 * forever, an Escape that did not close, both nav surfaces open at once.
 *
 * `aria-expanded` is a hole bound to `this.open`, so no second place holds it
 * and the two cannot drift apart in normal operation. The one window where they
 * do differ is between a synchronous close and the render that commits the
 * hole, which matters solely because the back/forward snapshot is read inside
 * exactly that window. `_onBeforeCache` below is the whole reason that window
 * is worth knowing about.
 *
 * Layout note. The toggle renders inside <main>, not inside the <aside>, and
 * that is load-bearing rather than incidental: under 900px the aside is a
 * fixed, off-canvas, `visibility: hidden` panel, so a button rendered inside it
 * would be unreachable exactly when it is needed. Both still belong to this
 * component; only their positions in the template differ.
 *
 * Progressive enhancement: with JavaScript off the drawer cannot open, which
 * is exactly what the delegated-listener version did. The sidebar is still in
 * the DOM and still reads on a wide viewport. Making the drawer work without
 * JS is a real gap and is tracked separately.
 */

/** Under this width the sidebar becomes the drawer. Matches --breakpoint-wide. */
const DRAWER_MEDIA = '(max-width: 899.98px)';

export class DocsDrawer extends WebComponent({
  /**
   * Reflected, because the shell's CSS selects on `docs-drawer[open]`. That is
   * also why this is a reactive property rather than a signal: the attribute is
   * the styling contract, and reflection is what publishes it.
   */
  open: prop(Boolean, { reflect: true }),
  /** aria-label for the <aside>, e.g. "Documentation". */
  label: String,
  /** Visible text on the drawer toggle, e.g. "Documentation menu". */
  menuLabel: String,
  /** Class for the content wrapper. 'prose-docs' on /docs, '' on /ui. */
  contentClass: String,
}) {
  /**
   * Bound once so add and remove reference the same function object. A fresh
   * arrow per call would make removeEventListener a silent no-op, which is the
   * classic way a component leaks a document listener per navigation.
   */
  private _onKeydown = (e: KeyboardEvent) => this.handleKeydown(e);
  private _onNavigate = () => this.close();

  /**
   * Dismissal for the snapshot path, which has a stricter timing contract than
   * the others.
   *
   * The router dispatches webjs:before-cache and reads
   * documentElement.outerHTML in the SAME TASK, a couple of statements later
   * and with no await in between, so only a synchronous mutation is captured.
   * Closing sets the reflected host attribute at once, which the CSS selects
   * on, but every template hole is a render-time write committed a microtask
   * later. aria-expanded is such a hole, so without writing it directly the
   * snapshot would carry a closed drawer whose toggle still announces itself
   * as expanded, and a restored page would say so until the next render.
   */
  private _onBeforeCache = () => {
    this.close();
    this._toggleRef.value?.setAttribute('aria-expanded', 'false');
  };
  private _onMediaChange = () => this.syncScrollLock();

  /** The drawer-breakpoint query, observed so a rotate re-evaluates the lock. */
  private _mql: MediaQueryList | undefined;

  /**
   * The toggle button, bound through the ref directive rather than looked up
   * with a selector. render() already owns this element, so a ref keeps the
   * reference flowing out of the template instead of re-finding it by class on
   * every Escape, and it cannot silently return null if the markup moves. Same
   * reasoning as the command line in components/copy-cmd.ts.
   */
  private _toggleRef = createRef<HTMLButtonElement>();

  /**
   * Whether THIS element currently holds a scroll lock.
   *
   * The lock is only TAKEN at the drawer breakpoint, but it must be RELEASED
   * on the strength of having taken it, never on a re-reading of the viewport.
   * Gating the release on the media query too is a permanent leak: open the
   * drawer below 900px, rotate or resize past it, then close by any path, and
   * the release is skipped while the page stays `overflow: hidden` for good.
   * The refcount is shared with the UI kit's overlays, so a stranded count
   * pins their locks open as well.
   */
  private _holdsLock = false;

  constructor() {
    super();
    // Defaults belong in the constructor, since SSR runs it but not
    // connectedCallback. Without this `open` is undefined on the first paint,
    // and aria-expanded renders the string "undefined", which is not a valid
    // value for the attribute and tells a screen reader nothing.
    this.open = false;
  }

  connectedCallback() {
    super.connectedCallback();
    // Capture phase, deliberately. The header menu (<site-nav-menu>) also
    // closes on Escape, and the drawer has to win when both are open. That
    // component listens in the BUBBLE phase and bails on defaultPrevented, and
    // capture always precedes bubble regardless of which element registered
    // first, so the priority holds without either component importing or
    // knowing about the other. Registration order cannot be relied on here:
    // the root layout renders the menu, the docs layout renders this.
    document.addEventListener('keydown', this._onKeydown, true);
    // A soft navigation from /docs to / destroys this element, so the state
    // dies with it and needs no cleanup. A navigation from /docs/a to /docs/b
    // MORPHS the layout and keeps the element alive, which is the case this
    // listener exists for.
    //
    // popstate is NOT redundant with webjs:navigate, despite appearances.
    // On a back/forward with a snapshot cache HIT, performNavigation calls
    // applySwap (router-client.js:1225) and RETURNS a few lines later. The webjs:navigate
    // dispatch lives at the end of fetchAndApply (router-client.js:2349), which
    // on that path runs only as a fire-and-forget revalidation whose failure is
    // swallowed, which a newer navigation can supersede, and which is skipped
    // on a discard disposition. So the cached back is exactly the case where
    // webjs:navigate may arrive late or never. Both handlers are idempotent, so
    // the occasional double fire costs nothing.
    //
    // webjs:before-cache is the framework's hook for stripping transient state
    // BEFORE the snapshot is serialized. Without it the open attribute is baked
    // into the snapshot and a forward restore brings the surface back open.
    document.addEventListener('webjs:navigate', this._onNavigate);
    window.addEventListener('popstate', this._onNavigate);
    document.addEventListener('webjs:before-cache', this._onBeforeCache);
    // Crossing the breakpoint changes whether this drawer should be holding the
    // page scroll, and it fires no property update, so `updated()` alone would
    // never re-evaluate. A phone rotated to landscape with the drawer open is
    // the ordinary way to reach that state, not a corner case.
    this._mql = window.matchMedia(DRAWER_MEDIA);
    this._mql.addEventListener('change', this._onMediaChange);
    // Re-entering the document with `open` still reflected has to re-take the
    // lock. disconnectedCallback released it and cleared _holdsLock, so without
    // this a drawer that is moved or re-inserted comes back rendering open at a
    // narrow viewport with the page scrollable underneath it.
    this.syncScrollLock();
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKeydown, true);
    document.removeEventListener('webjs:navigate', this._onNavigate);
    window.removeEventListener('popstate', this._onNavigate);
    document.removeEventListener('webjs:before-cache', this._onBeforeCache);
    this._mql?.removeEventListener('change', this._onMediaChange);
    this._mql = undefined;
    // Release the page scroll if this element is torn out while holding it (a
    // client-router swap away from the docs). Keyed on _holdsLock rather than
    // on `open`, so a drawer that closed after the viewport widened past the
    // breakpoint is still released here rather than leaking.
    if (this._holdsLock) { unlockScroll(); this._holdsLock = false; }
    super.disconnectedCallback();
  }

  private handleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !this.open) return;
    // The docs render <doc-search> into this drawer's aside-top slot, and
    // Escape natively clears a non-empty search box, so the first press is
    // often meant for the field rather than for the drawer. Consuming it there
    // would swallow the clear, shut the drawer, and move focus.
    //
    // Deliberately WITHOUT preventDefault. Suppressing the default is exactly
    // what would cancel the native clear this branch exists to protect. The
    // header menu is kept from dismissing on the same press by applying the
    // SAME rule from #lib/escape-target.ts rather than by a defaultPrevented
    // flag, which is why that rule lives in a shared module instead of here.
    //
    // The rule is document-wide, not scoped to this element, so a non-empty
    // search box ANYWHERE holds the press, not only the <doc-search> in the
    // aside-top slot. That is a widening over the pre-refactor behaviour and it
    // is deliberate, and the reasoning is in the shared module.
    if (escapeBelongsToField(composedTarget(e))) return;
    this.close();
    // Tells <site-nav-menu> this Escape is spoken for, so one press does not
    // close both surfaces.
    e.preventDefault();
    // Focus returns to the control that opened this, not to whatever the header
    // menu would have focused.
    this._toggleRef.value?.focus();
  }

  /**
   * Any sidebar link dismisses the drawer. Delegated on the component's own
   * <nav> because the links are SLOTTED: they are authored by the layout, so
   * this template cannot bind a handler to each one. The `closest` read is
   * scoped to this element's own subtree, which is what keeps it a local
   * concern rather than the document-wide lookup this component replaced.
   * Whitespace inside the nav is not a link, so it does not close.
   */
  private onNavClick(e: Event) {
    const target = e.target;
    if (target instanceof Element && target.closest('a')) this.close();
  }

  private close() {
    if (this.open) this.open = false;
  }

  /**
   * The scroll lock is a DOCUMENT-level effect, so it cannot be expressed as a
   * class in this template and is driven from the update cycle instead.
   *
   * Taking the lock is gated on the drawer breakpoint, because on a wide
   * viewport the sidebar is an ordinary sticky column and locking the page
   * would be a bug. RELEASING it is gated on `_holdsLock` instead, never on the
   * media query, so a viewport that crosses the breakpoint while the drawer is
   * open cannot strand the lock.
   */
  updated(changed: Map<string, unknown>) {
    if (!changed.has('open')) return;
    this.syncScrollLock();
  }

  private syncScrollLock() {
    const wantLock = this.open && window.matchMedia(DRAWER_MEDIA).matches;
    if (wantLock === this._holdsLock) return;
    if (wantLock) lockScroll();
    else unlockScroll();
    this._holdsLock = wantLock;
  }

  render() {
    return html`
      <div
        class="docs-backdrop"
        aria-hidden="true"
        @click=${() => this.close()}
      ></div>

      <!-- Same container as the shared header (max-w-7xl mx-auto px-6), so the
           sidebar's left edge lines up with the wordmark above it and the
           content column lines up with every other page on the site. -->
      <div class="max-w-7xl mx-auto px-6 grid grid-cols-[248px_1fr] gap-10 min-h-screen max-wide:grid-cols-1 max-wide:gap-0">
        <aside
          id="docs-sidebar"
          class="docs-sidebar flex flex-col py-10 text-sm max-wide:px-5"
          aria-label=${this.label}
        >
          <slot name="aside-top"></slot>
          <!-- min-h-0 is what lets this shrink inside the flex column; without
               it the nav takes its content height and the column scrolls
               instead, taking anything pinned above it along. pr-3 keeps the
               scrollbar off the links. -->
          <nav class="docs-nav flex-1 min-h-0 overflow-y-auto pr-3" @click=${(e: Event) => this.onNavClick(e)}>
            <slot name="nav"></slot>
          </nav>
        </aside>

        <main id="main" tabindex="-1" class="min-w-0 max-w-3xl pt-10 pb-16 focus:outline-none">
          <button
            type="button"
            class="docs-nav-toggle hidden max-wide:inline-flex items-center gap-2 mb-6 px-3 py-2 rounded-lg border border-border bg-bg-elev text-fg-muted text-sm cursor-pointer transition-colors duration-150 hover:text-fg hover:border-border-strong"
            ${ref(this._toggleRef)}
            aria-controls="docs-sidebar"
            aria-expanded=${this.open ? 'true' : 'false'}
            @click=${() => { this.open = !this.open; }}
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
            ${this.menuLabel}
          </button>
          ${this.contentClass
            ? html`<div class=${this.contentClass}><slot></slot></div>`
            : html`<slot></slot>`}
        </main>
      </div>
    `;
  }
}

DocsDrawer.register('docs-drawer');
