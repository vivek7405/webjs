import { html } from '@webjsdev/core';
import { READING, BADGE } from '#lib/design/recipes.ts';
import { pageHeader } from '#lib/ui/page-header.ts';
import { listPosts } from '#modules/blog/queries/list-posts.server.ts';

/**
 * /blog
 *
 * Thin route adapter. All the file-reading and frontmatter-parsing
 * lives in `modules/blog/queries/list-posts.server.ts`. This page
 * just renders the result.
 */

export const metadata = {
  title: 'Blog · WebJs',
  description: 'Long-form notes from building webjs: the design decisions, the trade-offs, the things that did not work, and what the framework looks like in production.',
};

export default async function Blog() {
  const posts = await listPosts();
  return html`
    <main id="main" tabindex="-1" class="${READING} py-12 focus:outline-none">
      ${pageHeader('Notes from building webjs', 'Posts on the design decisions, the trade-offs, the things that did not work, and what the framework looks like in production.')}

      ${posts.length === 0
        ? html`<p class="text-fg-subtle italic">No posts yet.</p>`
        : posts.map((p) => html`
            <article class="border border-border rounded-xl bg-bg-elev p-5 sm:p-6 mb-5 shadow-sm transition-colors hover:border-border-strong">
              <a href=${'/blog/' + p.slug} class="block no-underline text-fg">
                <header class="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
                  <time class="font-mono text-xs text-fg-subtle tracking-tight">${p.date.slice(0, 10)}</time>
                  ${p.tags.length > 0
                    ? p.tags.map((t) => html`<span class=${BADGE}>${t}</span>`)
                    : ''}
                </header>
                <h2 class="font-serif text-section leading-[1.15] tracking-tight text-fg m-0 mb-2">${p.title}</h2>
                <p class="text-fg text-sm leading-relaxed m-0">${p.description}</p>
              </a>
            </article>
          `)}
    </main>
  `;
}
