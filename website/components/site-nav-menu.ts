import { WebComponent, prop, html, createRef, ref } from '@webjsdev/core';
import { live } from '@webjsdev/core/directives';
import { escapeBelongsToField } from '#lib/escape-target.ts';

/**
 * `<site-nav-menu>`: the header's mobile navigation menu.
 *
 * Wraps a native `<details>`, and that choice is the whole progressive
 * enhancement story. With JavaScript off the summary still opens and closes the
 * panel, because that is what `<details>` does. This component adds only the
 * three dismissals a bare `<details>` has no opinion about: a click outside it,
 * a click on one of its links, and Escape.
 *
 * So the component never drives the open state on the way IN. It ABSORBS what
 * the browser already did, through `@toggle`, and only writes the state on the
 * way out when something should dismiss the menu. Taking the interaction over
 * (preventDefault on the summary, drive `open` from a click handler) would work
 * with JS and break without it, for no gain.
 *
 * Two consequences of letting the browser drive, both load-bearing:
 *
 *   - `toggle` is fired ASYNCHRONOUSLY, so there is a window after a summary
 *     click where the details is open and `this.open` is still false. Nothing
 *     renders in that window in practice, but it is why a test cannot assert
 *     the component's state on the microtask right after the click.
 *   - the browser mutating `open` behind the renderer leaves the renderer's
 *     cached value stale, so a later write of the value it last rendered gets
 *     skipped as a no-op and the menu never closes. `live()` is the directive
 *     for exactly that, comparing against the DOM rather than the cache.
 *
 * The links are slotted, so the header keeps its NAV data in app/layout.ts and
 * this file keeps the chrome and the behaviour.
 */
export class SiteNavMenu extends WebComponent({
  /**
   * Reflected so the host carries the state for anything that wants to select
   * on it. The ICON swap deliberately keys off `details[open]` instead (see
   * app/layout.ts), because the host attribute only exists once this component
   * has hydrated, and the icons have to be right with JS off too.
   */
  open: prop(Boolean, { reflect: true }),
  /** aria-label for the toggle, e.g. "Toggle navigation". */
  label: String,
}) {
  private _onDocClick = (e: MouseEvent) => this.handleDocClick(e);
  private _onKeydown = (e: KeyboardEvent) => this.handleKeydown(e);
  private _onNavigate = () => { this.open = false; };

  /** The summary, for focus restoration after an Escape dismiss. */
  private _summaryRef = createRef<HTMLElement>();

  constructor() {
    super();
    // SSR runs the constructor but not connectedCallback, so a default set
    // anywhere later would leave the first paint reading `undefined`.
    this.open = false;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('click', this._onDocClick);
    // BUBBLE phase, deliberately. <docs-drawer> also closes on Escape and has
    // to win when both are open, so it listens in the CAPTURE phase and calls
    // preventDefault. Capture always runs before bubble whatever order the two
    // elements registered in, so checking defaultPrevented here is enough to
    // keep one Escape from closing both surfaces, and neither component has to
    // know the other exists.
    document.addEventListener('keydown', this._onKeydown);
    // A link click already closes this via handleDocClick, but that is only the
    // commonest way to navigate. A programmatic navigate(), and Back or Forward,
    // produce no click at all, and this element lives in the ROOT layout, so it
    // is the one thing on the page guaranteed to survive every client-router
    // swap: without this it stays open over whatever page it lands on.
    //
    // One listener covers all of them. The router's popstate handler routes
    // through performNavigation, which dispatches webjs:navigate
    // (@webjsdev/core/src/router-client.js), so subscribing to popstate as well
    // would only fire this twice per back navigation.
    document.addEventListener('webjs:navigate', this._onNavigate);
  }

  disconnectedCallback() {
    document.removeEventListener('click', this._onDocClick);
    document.removeEventListener('keydown', this._onKeydown);
    document.removeEventListener('webjs:navigate', this._onNavigate);
    super.disconnectedCallback();
  }

  /**
   * A click anywhere outside this element dismisses it. `this.contains` is a
   * read of the component's OWN subtree, which is the part that makes this a
   * local concern: an outside click is by definition a document-level event, so
   * the listener has to be on the document, but the decision it makes is about
   * this element alone.
   *
   * A click INSIDE is left entirely alone so the summary toggles natively; the
   * link case below is the one exception.
   */
  private handleDocClick(e: MouseEvent) {
    if (!this.open) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (!this.contains(target)) { this.open = false; return; }
    // A link inside the panel navigates, so the menu should not still be
    // hanging open over the page it lands on.
    if (target.closest('a')) this.open = false;
  }

  private handleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !this.open) return;
    // Another surface already consumed this Escape (the docs drawer).
    if (e.defaultPrevented) return;
    // The same deferral rule the drawer applies, from the one shared module.
    // Both surfaces have to agree: if only one defers to the field, the reader
    // clears their search box and loses this menu in the same press.
    if (escapeBelongsToField(e.target)) return;
    this.open = false;
    this._summaryRef.value?.focus();
  }

  render() {
    return html`
      <!-- The breakpoint hiding lives on the HOST (see app/layout.ts), not
           here. A light-DOM host defaults to display:block, so hiding only the
           details would leave this element as a zero-width flex item in the
           header's gap-2.5 row, and the gap would still be drawn: a strip of
           dead space beside the theme toggle on every desktop page. -->
      <details
        class="mobile-menu relative"
        ?open=${live(this.open)}
        @toggle=${(e: Event) => { this.open = (e.target as HTMLDetailsElement).open; }}
      >
        <summary
          class="cursor-pointer w-9 h-9 inline-flex items-center justify-center rounded-lg text-fg-muted hover:bg-[var(--hover-surface)] hover:text-fg"
          ${ref(this._summaryRef)}
          aria-label=${this.label}
        >
          <svg class="open-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/></svg>
          <svg class="close-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </summary>
        <nav class="absolute right-0 top-[calc(100%+10px)] min-w-52 flex flex-col gap-0.5 bg-bg-elev border border-border rounded-xl shadow-[var(--shadow)] p-2 z-50" aria-label="Mobile">
          <slot></slot>
        </nav>
      </details>
    `;
  }
}

SiteNavMenu.register('site-nav-menu');
