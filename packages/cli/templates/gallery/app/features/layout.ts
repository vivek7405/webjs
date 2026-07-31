import { html } from '@webjsdev/core';
import type { LayoutProps } from '@webjsdev/core';
import { backLink } from '#lib/utils/ui.ts';
import '#modules/gallery/components/gallery-nav.ts';

// A subtle, hover-revealed scrollbar for the sidebar (macOS overlay feel): the
// track + thumb are transparent while idle (no bar), and fade in on hover /
// keyboard focus, then fade out again. A layout may interpolate CSS into a
// <style> (it never hydrates, unlike a component), so this is legitimate here.
const SIDENAV_CSS = `
  .gallery-sidenav { scrollbar-width: thin; scrollbar-color: transparent transparent; transition: scrollbar-color .2s ease; }
  .gallery-sidenav:hover, .gallery-sidenav:focus-within { scrollbar-color: color-mix(in oklch, var(--foreground) 22%, transparent) transparent; }
  .gallery-sidenav::-webkit-scrollbar { width: 8px; }
  .gallery-sidenav::-webkit-scrollbar-track { background: transparent; }
  .gallery-sidenav::-webkit-scrollbar-thumb { background-color: transparent; border-radius: 999px; border: 2px solid transparent; background-clip: padding-box; transition: background-color .2s ease; }
  .gallery-sidenav:hover::-webkit-scrollbar-thumb, .gallery-sidenav:focus-within::-webkit-scrollbar-thumb { background-color: color-mix(in oklch, var(--foreground) 22%, transparent); }
  .gallery-sidenav::-webkit-scrollbar-thumb:hover { background-color: color-mix(in oklch, var(--foreground) 40%, transparent); }
`;

// Section rhythm: ONE uniform gap between every top-level block of a demo
// (heading, lede, paragraph, component, list, anything), so spacing stays
// consistent with NO per-element margins. This is the single place that controls
// demo spacing. A flex column with `gap` does it WITHOUT touching each child's
// own display: a `grid`/`flex` child (like the forms card) keeps its layout, a
// shadow-DOM host (inline by default) is blockified as a flex item so it honours
// the gap, a display:contents <webjs-suspense> is replaced by its children (which
// become the flex items and get the gap), and a display:none streaming
// <script>/<template> is not an item at all (no phantom gap).
const STACK_CSS = `
  .demo-stack {
    --section-gap: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: var(--section-gap);
  }
  /* Zero any BLOCK-axis margins so ONLY the flex gap spaces sections. Block
     axis only: this style is unlayered so it beats Tailwind's layered
     utilities, and a full margin: 0 would also kill mx-auto (an auth card's
     horizontal centering). */
  .demo-stack > * { margin-block: 0; }
`;

// Shared layout for every gallery feature demo under /features/*. A docs-style
// two-column shell: a grouped sidebar (the <gallery-nav> component, which tracks
// the active demo across soft navigation) plus the demo content. On mobile the
// sidebar is hidden, so a slim back link keeps a demo from being a dead end.
// Nested layouts (like the auth dashboard's sub-nav) render inside ${children}.
// A non-root layout, so it never writes the document shell (the framework does).
// LayoutProps types every argument a layout receives, so `url` is known to be
// an absolute URL string (the framework passes url.toString()) and needs no
// defensive widening or runtime typeof check.
export default function FeaturesLayout({ children, url }: LayoutProps) {
  const path = new URL(url).pathname;
  return html`
    <style>${SIDENAV_CSS}${STACK_CSS}</style>
    <div class="lg:hidden mb-6">${backLink('/', html`&larr; Gallery`)}</div>
    <div class="grid lg:grid-cols-[190px_1fr] gap-8 lg:gap-12">
      <!-- The sidebar caps at the viewport minus the root chrome (the h-14 navbar
           = 3.5rem plus the root <main>'s py-8 = 4rem, so 7.5rem) and scrolls
           internally, so a short demo never forces a page scrollbar. -->
      <aside class="hidden lg:flex lg:flex-col sticky top-6 self-start max-h-[calc(100dvh-7.5rem)] text-sm">
        <!-- Pinned header: stays put while the demo list below scrolls. -->
        <a href="/" class="shrink-0 block px-3 py-1.5 mb-4 rounded-lg no-underline text-muted-foreground hover:text-foreground transition-colors">&larr; Gallery</a>
        <div class="gallery-sidenav min-h-0 overflow-y-auto overflow-x-hidden -mr-2 pr-2">
          <gallery-nav current=${path}></gallery-nav>
        </div>
      </aside>
      <div class="min-w-0 demo-stack">${children}</div>
    </div>
  `;
}
