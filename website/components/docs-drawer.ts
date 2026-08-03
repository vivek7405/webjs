import { WebComponent, prop, html, createRef, ref } from '@webjsdev/core';
import { lockScroll, unlockScroll } from '#lib/scroll-lock.ts';

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
 * `aria-expanded` is now a hole bound to `this.open`, so it cannot drift from
 * the state. There is no second place holding it and nothing to keep in sync.
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
   * The toggle button, bound through the ref directive rather than looked up
   * with a selector. render() already owns this element, so a ref keeps the
   * reference flowing out of the template instead of re-finding it by class on
   * every Escape, and it cannot silently return null if the markup moves. Same
   * reasoning as the command line in components/copy-cmd.ts.
   */
  private _toggleRef = createRef<HTMLButtonElement>();

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
    document.addEventListener('webjs:navigate', this._onNavigate);
    window.addEventListener('popstate', this._onNavigate);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKeydown, true);
    document.removeEventListener('webjs:navigate', this._onNavigate);
    window.removeEventListener('popstate', this._onNavigate);
    // Release the page scroll if this element is torn out while open (a
    // client-router swap away from the docs). Without this the lock's refcount
    // never returns to zero and the whole site is left unscrollable.
    if (this.open) unlockScroll();
    super.disconnectedCallback();
  }

  private handleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !this.open) return;
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
   * class in this template and is driven from the update cycle instead. It is
   * only meaningful at the drawer breakpoint: on a wide viewport the sidebar is
   * an ordinary sticky column and locking the page would be a bug.
   */
  updated(changed: Map<string, unknown>) {
    if (!changed.has('open')) return;
    if (!window.matchMedia(DRAWER_MEDIA).matches) return;
    if (this.open) lockScroll();
    else unlockScroll();
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
