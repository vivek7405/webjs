import { html } from '@webjsdev/core';
import { READING } from '#lib/design/recipes.ts';
import { pageHeader } from '#lib/ui/page-header.ts';
import { listComparisons } from '#modules/compare/queries/list-comparisons.server.ts';

/**
 * /compare
 *
 * Thin route adapter. The file-reading and frontmatter parsing live in
 * `modules/compare/queries/list-comparisons.server.ts`. This page maps
 * the result to cards. Each card links to `/compare/<slug>`, the
 * long-form head-to-head, which is where the SEO value sits.
 */

export const metadata = {
  title: 'WebJs compared: vs Next.js, Lit, Remix, Astro, Rails · WebJs',
  description: 'Honest, head-to-head comparisons of WebJs with Next.js, Lit, Remix, Astro, and Rails. Where they agree, where they genuinely differ, and who should pick which.',
};

export default async function Compare() {
  const comparisons = await listComparisons();
  return html`
    <main id="main" tabindex="-1" class="${READING} py-12 focus:outline-none">
      ${pageHeader('How WebJs compares', 'Honest head-to-head write-ups: where WebJs agrees with each framework, where it genuinely differs, and who should pick which. No trashing the alternative, and each one says where the other tool is the better call.')}

      ${comparisons.length === 0
        ? html`<p class="text-fg-subtle italic">No comparisons yet.</p>`
        : comparisons.map((c) => html`
            <article class="border border-border rounded-xl bg-bg-elev p-5 sm:p-6 mb-5 shadow-sm transition-colors hover:border-border-strong">
              <a href=${'/compare/' + c.slug} class="block no-underline text-fg">
                <header class="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
                  <span class="font-mono text-xs uppercase tracking-widest text-fg-subtle">WebJs vs ${c.competitor}</span>
                </header>
                <h2 class="font-serif text-section leading-[1.15] tracking-tight text-fg m-0 mb-2">${c.tagline}</h2>
                <p class="text-fg text-sm leading-relaxed m-0">${c.description}</p>
              </a>
            </article>
          `)}
    </main>
  `;
}
