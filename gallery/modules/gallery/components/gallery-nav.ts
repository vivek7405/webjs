// The gallery's left sidebar: a grouped index of every demo, with the current
// one highlighted (docs-site style). WHY a component and not plain layout markup:
// the features layout is PRESERVED across a soft navigation (only the page
// content swaps), so a server-rendered "active" highlight would go stale. This
// component listens for the router's `webjs:navigate` event and re-derives the
// active item from location.pathname, so the highlight follows soft-nav. SSR is
// still correct: `render()` reads the `current` prop (the pathname the layout
// passes) for the first paint, and the client takes over from location after.
// The document LISTENER below is the legitimate case, not a reach across the
// app: the router has no element to dispatch from, and the handler reads only
// location.pathname and writes only this module's own signal, so it queries
// nothing outside itself. Querying the document for another file's markup is
// the shape to avoid.
import { WebComponent, prop, html, signal } from '@webjsdev/core';
import { FEATURE_GROUPS } from '#modules/gallery/nav.ts';

// Module-scope so the value survives re-renders; set on the client only (SSR
// reads the `current` prop instead, so it never touches location during render).
const activePath = signal('');

export class GalleryNav extends WebComponent({ current: prop(String) }) {
  #onNav = () => activePath.set(location.pathname);

  connectedCallback() {
    super.connectedCallback();
    this.#onNav(); // seed from the real URL on hydrate
    document.addEventListener('webjs:navigate', this.#onNav); // soft-nav (link + navigate())
    window.addEventListener('popstate', this.#onNav); // back / forward
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('webjs:navigate', this.#onNav);
    window.removeEventListener('popstate', this.#onNav);
  }

  render() {
    // activePath is '' at SSR (and before hydrate), so fall back to the prop.
    const active = activePath.get() || this.current;
    const link = (href: string, title: string) => {
      // Highlight the demo whose route we are on, INCLUDING its subroutes
      // (/features/auth/dashboard highlights Auth). The trailing slash keeps
      // /features/stream from matching /features/streaming.
      const on = active === href || active.startsWith(href + '/');
      const cls = 'block px-3 py-1.5 rounded-lg no-underline transition-colors ' +
        (on ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:bg-accent hover:text-foreground');
      return html`<a href=${href} aria-current=${on ? 'page' : 'false'} class=${cls}>${title}</a>`;
    };
    return html`
      ${FEATURE_GROUPS.map((g) => html`
        <div class="mb-5">
          <div class="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">${g.label}</div>
          <nav class="flex flex-col gap-0.5">${g.items.map((i) => link(i.href, i.title))}</nav>
        </div>
      `)}
    `;
  }
}
GalleryNav.register('gallery-nav');
