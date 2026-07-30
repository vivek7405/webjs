import { html } from '@webjsdev/core';
import { EYEBROW } from '#lib/design/recipes.ts';

/**
 * A composed page fragment (the lib/ui convention): an SSR-time function
 * returning html. It renders and disappears. Nothing here registers a custom
 * element. Interactive elements live in components/.
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
