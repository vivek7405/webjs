import { html } from '@webjsdev/core';
import { BTN_PRIMARY, BTN_GHOST, INSTALL, PANEL_CTA, SECTION, WIDE } from '#lib/design/recipes.ts';
import { NEW_TAB } from '#lib/links.ts';

/**
 * A composed page fragment (the lib/ui convention): an SSR-time function
 * returning html. It renders and disappears. Nothing here registers a custom
 * element. Interactive elements live in components/.
 */

/**
 * The closing call to action, composed rather than assembled per page.
 *
 * Three pages built this out of the same parts by hand, which is how the panel,
 * the install bar, and the two buttons drifted out of step with each other.
 * Passing the words in leaves nothing per-page to get wrong.
 *
 * The install bar renders by default; pass `install: false` for a closing
 * panel without the command.
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
