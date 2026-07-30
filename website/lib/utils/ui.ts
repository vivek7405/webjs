import { html } from '@webjsdev/core';
import { NEW_TAB } from '#lib/links.ts';
import { BTN_PRIMARY, BTN_GHOST, INSTALL, PANEL_CTA, SECTION, WIDE, EYEBROW } from '#lib/design.ts';

/**
 * Shared SSR-time page furniture.
 *
 * This is the split AGENTS.md asks for: "when a class bundle repeats, extract
 * it into a lib/utils/ui.ts helper returning an html fragment (SSR-time), NOT
 * a CSS class". lib/design.ts keeps the VOCABULARY (the class recipes and the
 * scale), and this file assembles it into whole pieces of page.
 *
 * These are deliberately NOT in components/. That folder means one custom
 * element per file, registered with a tag, shipped to the browser and
 * hydrated. Nothing here is interactive: it renders at SSR and disappears, so
 * making it an element would ship JavaScript to register a tag that does
 * nothing. A display-only component would be elided by the framework anyway.
 *
 * Unrelated to lib/ui/, which is the gitignored mirror of the @webjsdev/ui
 * registry written by scripts/copy-registry.mjs.
 */

/**
 * The header at the top of a long-form hub or index page.
 *
 * This existed three times, byte for byte apart from its words, on /blog,
 * /articles, and /compare. Each copy also carried an uppercase mono eyebrow
 * over the title, the device that was removed from every other page, so the
 * three pages that shared a header were also the three still carrying a
 * pattern the rest of the site had dropped. One function makes that class of
 * drift impossible: there is nowhere left for a fourth variant to appear.
 */
export function pageHeader(title: string, lede: unknown, eyebrow?: string) {
  return html`
    <header class="mb-10">
      ${eyebrow ? html`<p class=${EYEBROW}>${eyebrow}</p>` : ''}
      <h1 class="font-serif text-hub leading-[1.05] tracking-tight text-fg mb-3">${title}</h1>
      <p class="text-fg-muted text-sm leading-relaxed max-w-2xl">${lede}</p>
    </header>
  `;
}

/**
 * The closing call to action, composed rather than assembled per page.
 *
 * Three pages built this out of the same parts by hand, which is how the panel,
 * the install bar, and the two buttons drifted out of step with each other.
 * Passing the words in leaves nothing per-page to get wrong.
 *
 * `install` is opt-in because /why-webjs closes on the docs link alone, without
 * the command.
 */
export function ctaPanel(opts: {
  title: string;
  lede: string;
  install?: boolean;
  primary: { href: string; label: string };
  secondary?: { href: string; label: string; ext?: boolean };
}) {
  return html`
    <section class="${SECTION} text-center" id="get-started">
      <div class="${WIDE}">
        <div class="max-w-3xl mx-auto p-8 md:p-12 lg:p-16 ${PANEL_CTA}">
          <h2 class="font-display font-extrabold text-h2 leading-[1.1] tracking-[-0.03em] mt-0 mb-3">${opts.title}</h2>
          <p class="text-fg-muted mx-auto mb-8 max-w-[52ch]">${opts.lede}</p>
          ${opts.install === false ? '' : html`
            <div class=${INSTALL}>
              <span class="text-accent select-none" aria-hidden="true">$</span><copy-cmd>npm create webjs@latest my-app</copy-cmd>
            </div>
          `}
          <div class="flex gap-3 justify-center flex-wrap mt-7">
            <a class=${BTN_PRIMARY} href=${opts.primary.href}>
              ${opts.primary.label}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </a>
            ${opts.secondary ? html`
              <a class=${BTN_GHOST} href=${opts.secondary.href}
                 target=${opts.secondary.ext ? '_blank' : '_self'}
                 rel=${opts.secondary.ext ? 'noopener noreferrer' : ''}>${opts.secondary.label}${opts.secondary.ext ? NEW_TAB : ''}</a>
            ` : ''}
          </div>
        </div>
      </div>
    </section>
  `;
}
