import { html } from '@webjsdev/core';
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
    <main id="main" tabindex="-1" class="max-w-[840px] mx-auto px-6 py-12 focus:outline-none">
      <header class="mb-10">
        <p class="font-mono text-[11px] uppercase tracking-[0.15em] text-accent font-semibold mb-2">Compare</p>
        <h1 class="font-serif text-[clamp(28px,4vw,40px)] leading-[1.05] tracking-tight text-fg mb-3">How WebJs compares</h1>
        <p class="text-fg-muted text-[15px] leading-relaxed max-w-[640px]">
          Honest head-to-head write-ups: where WebJs agrees with each framework, where it genuinely differs, and who should pick which. No trashing the alternative, and each one says where the other tool is the better call.
        </p>
      </header>

      ${comparisons.length === 0
        ? html`<p class="text-fg-subtle italic">No comparisons yet.</p>`
        : comparisons.map((c) => html`
            <article class="border border-border rounded-xl bg-bg-elev p-5 sm:p-6 mb-5 shadow-sm transition-colors hover:border-border-strong">
              <a href=${'/compare/' + c.slug} class="block no-underline text-fg">
                <header class="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
                  <span class="font-mono text-[11.5px] uppercase tracking-[0.12em] text-fg-subtle">WebJs vs ${c.competitor}</span>
                </header>
                <h2 class="font-serif text-[clamp(20px,3vw,26px)] leading-[1.15] tracking-tight text-fg m-0 mb-2">${c.tagline}</h2>
                <p class="text-fg-muted text-[14.5px] leading-relaxed m-0">${c.description}</p>
              </a>
            </article>
          `)}
    </main>
  `;
}
