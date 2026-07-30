import { html } from '@webjsdev/core';
import { READING, pageHeader, BADGE } from '#lib/design.ts';
import { listArticles } from '#modules/articles/queries/list-articles.server.ts';

/**
 * /articles
 *
 * The articles hub: evergreen, keyword-targeted explainers on the web
 * platform ideas WebJs is built on (what a web components framework is,
 * building with no build step, server-rendering custom elements, and so
 * on). Distinct from `/blog`, which is dated WebJs design notes; these
 * are timeless reference, so the cards surface tags and NO dates.
 *
 * Thin route adapter over `modules/articles/queries/list-articles.server.ts`.
 * Each card links to `/articles/<slug>`, the long-form explainer where the
 * SEO value sits. Reached from the footer (Resources), not the header nav.
 */

export const metadata = {
  title: 'Articles: web components, no-build, and the web platform · WebJs',
  description: 'Plain-English explainers on the ideas behind WebJs: what a web components framework is, building a full-stack app with no build step, server-rendering web components, and running TypeScript without a build.',
};

export default async function Articles() {
  const articles = await listArticles();
  return html`
    <main id="main" tabindex="-1" class="max-w-210 mx-auto px-6 py-12 focus:outline-none">
      ${pageHeader('Explainers for the web platform', 'Evergreen explainers on how the web platform works and the ideas WebJs is built on: web components, building with no build step, server-side rendering, and running TypeScript straight from the runtime. Reference reading, not release notes.', 'Articles')}

      ${articles.length === 0
        ? html`<p class="text-fg-subtle italic">No articles yet.</p>`
        : articles.map((a) => html`
            <article class="border border-border rounded-xl bg-bg-elev p-5 sm:p-6 mb-5 shadow-sm transition-colors hover:border-border-strong">
              <a href=${'/articles/' + a.slug} class="block no-underline text-fg">
                ${a.tags.length > 0
                  ? html`<header class="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-3">
                      ${a.tags.map((t) => html`<span class=${BADGE}>${t}</span>`)}
                    </header>`
                  : ''}
                <h2 class="font-serif text-[clamp(20px,3vw,26px)] leading-[1.15] tracking-tight text-fg m-0 mb-2">${a.title}</h2>
                <p class="text-fg-muted text-sm leading-relaxed m-0">${a.description || a.tagline}</p>
              </a>
            </article>
          `)}
    </main>
  `;
}
