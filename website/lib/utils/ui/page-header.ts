import { html } from '@webjsdev/core';
import { EYEBROW } from '#lib/design.ts';

/**
 * One shared page fragment per file, mirroring the framework's own
 * "one function per file" rule for actions and queries.
 *
 * These render at SSR and disappear. They are NOT components/: that folder
 * means one custom element per file, registered with a tag and hydrated.
 *
 * Unrelated to lib/ui/, which is the gitignored mirror of the @webjsdev/ui
 * registry. The ignore patterns are rooted (/lib/ui/), so this directory is
 * tracked normally.
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
