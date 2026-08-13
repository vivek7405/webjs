import { html } from '@webjsdev/core';
import { DOCS_START_PATH, UI_PATH, GALLERY_URL, GH_URL, DISCORD_URL, X_URL, BLUESKY_URL, NEW_TAB } from '#lib/links.ts';
import { brandLockup } from '#lib/design/brand.ts';

/**
 * A composed page fragment (the lib/ui convention): an SSR-time function
 * returning html. It renders and disappears. Nothing here registers a custom
 * element. Interactive elements live in components/.
 */

/**
 * The site-wide footer, rendered once by the root layout (app/layout.ts) so it
 * appears on every page, the same way the header/nav does.
 *
 * It lives here rather than inline in the layout so the chrome stays readable.
 * Pure SSR-time helper: it returns an `html` fragment and touches no client
 * globals, so importing it never ships a page to the browser.
 *
 * Anchor links point at `/#<id>` (not a bare `#<id>`) so a section anchor
 * resolves from any page, not only the home page.
 */
export function siteFooter() {
  return html`
    <footer class="mt-24 border-t border-border py-16 px-6 bg-bg-subtle/30">
      <div class="max-w-7xl mx-auto">
        <nav class="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12" aria-label="Footer">
          <div class="flex flex-col gap-3">
            <h4 class="text-xs font-bold uppercase tracking-wider text-fg">Product</h4>
            <a class="text-fg-muted hover:text-accent no-underline text-sm transition-colors" href=${DOCS_START_PATH}>Docs</a>
            <a class="text-fg-muted hover:text-accent no-underline text-sm transition-colors" href=${GALLERY_URL} target="_blank" rel="noopener noreferrer">Gallery${NEW_TAB}</a>
            <a class="text-fg-muted hover:text-accent no-underline text-sm transition-colors" href=${UI_PATH}>UI components</a>
            <a class="text-fg-muted hover:text-accent no-underline text-sm transition-colors" href="/#templates">Templates</a>
          </div>
          <div class="flex flex-col gap-3">
            <h4 class="text-xs font-bold uppercase tracking-wider text-fg">Resources</h4>
            <a class="text-fg-muted hover:text-accent no-underline text-sm transition-colors" href="/what-is-webjs">What is WebJs?</a>
            <a class="text-fg-muted hover:text-accent no-underline text-sm transition-colors" href="/why-webjs">Why WebJs</a>
            <a class="text-fg-muted hover:text-accent no-underline text-sm transition-colors" href="/brand">Brand</a>
            <a class="text-fg-muted hover:text-accent no-underline text-sm transition-colors" href="/blog">Blog</a>
            <a class="text-fg-muted hover:text-accent no-underline text-sm transition-colors" href="/articles">Articles</a>
            <a class="text-fg-muted hover:text-accent no-underline text-sm transition-colors" href="/changelog">Changelog</a>
            <a class="text-fg-muted hover:text-accent no-underline text-sm transition-colors" href=${GH_URL + '/releases'} target="_blank" rel="noopener noreferrer">Releases${NEW_TAB}</a>
          </div>
          <div class="flex flex-col gap-3">
            <h4 class="text-xs font-bold uppercase tracking-wider text-fg"><a class="no-underline text-fg hover:text-accent transition-colors" href="/compare">Compare</a></h4>
            <a class="text-fg-muted hover:text-accent no-underline text-sm transition-colors" href="/compare/webjs-vs-nextjs">Next.js</a>
            <a class="text-fg-muted hover:text-accent no-underline text-sm transition-colors" href="/compare/webjs-vs-lit">Lit</a>
            <a class="text-fg-muted hover:text-accent no-underline text-sm transition-colors" href="/compare/webjs-vs-remix">Remix 3</a>
            <a class="text-fg-muted hover:text-accent no-underline text-sm transition-colors" href="/compare/webjs-vs-astro">Astro</a>
            <a class="text-fg-muted hover:text-accent no-underline text-sm transition-colors" href="/compare/webjs-vs-rails">Rails</a>
          </div>
          <div class="flex flex-col gap-3">
            <h4 class="text-xs font-bold uppercase tracking-wider text-fg">Community</h4>
            <a class="text-fg-muted hover:text-accent no-underline text-sm transition-colors" href=${GH_URL} target="_blank" rel="noopener noreferrer">GitHub${NEW_TAB}</a>
            <a class="text-fg-muted hover:text-accent no-underline text-sm transition-colors" href=${GH_URL + '/discussions'} target="_blank" rel="noopener noreferrer">Discussions${NEW_TAB}</a>
            <a class="text-fg-muted hover:text-accent no-underline text-sm transition-colors" href=${DISCORD_URL} target="_blank" rel="noopener noreferrer">Discord${NEW_TAB}</a>
            <a class="text-fg-muted hover:text-accent no-underline text-sm transition-colors" href=${X_URL} target="_blank" rel="noopener noreferrer">X${NEW_TAB}</a>
            <a class="text-fg-muted hover:text-accent no-underline text-sm transition-colors" href=${BLUESKY_URL} target="_blank" rel="noopener noreferrer">Bluesky${NEW_TAB}</a>
          </div>
          <div class="flex flex-col gap-3">
            <a href="/" aria-label="WebJs home" class="no-underline text-fg inline-flex w-fit transition-opacity duration-150 hover:opacity-80">${brandLockup('ftr', { height: 26 })}</a>
            <p class="m-0 text-xs text-fg-muted leading-relaxed">A full-stack web components framework with no build step. Server-rendered, with its own source in your node_modules.</p>
          </div>
        </nav>
        <div class="pt-8 border-t border-border flex flex-col md:flex-row justify-between items-center gap-4 text-fg-subtle text-xs">
          <div><a class="no-underline hover:text-accent transition-colors" href=${GH_URL + '/blob/main/LICENSE'} target="_blank" rel="noopener noreferrer">MIT License${NEW_TAB}</a></div>
          <div class="flex items-center gap-1">Built with WebJs <svg class="heart" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg></div>
        </div>
      </div>
    </footer>
  `;
}
