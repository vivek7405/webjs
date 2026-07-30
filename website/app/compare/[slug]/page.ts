import { html, unsafeHTML, notFound } from '@webjsdev/core';
import { getComparison } from '#modules/compare/queries/get-comparison.server.ts';
import { renderPostBody } from '#modules/blog/utils/render-post.ts';
import { parseFaq, faqJsonLd } from '#lib/faq.ts';
import { NEW_TAB } from '#lib/links.ts';

/**
 * /compare/[slug]
 *
 * Thin route adapter. File-reading and frontmatter parsing live in
 * `modules/compare/`. The markdown body is rendered with the blog's
 * `renderPostBody` (same typography, no need for a second renderer).
 *
 * `generateMetadata` gives each comparison its own title / description /
 * og:* tags, a canonical URL at `/compare/<slug>`, and JSON-LD
 * (`TechArticle` + `BreadcrumbList` + optional `FAQPage`, the last built
 * from a `## FAQ` section in the body), which is what makes these pages
 * rank for "WebJs vs <framework>" queries and feed AI answer engines.
 */

const SITE_URL = 'https://webjs.dev';

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const c = await getComparison(params.slug);
  if (!c) return { title: 'Comparison not found · WebJs' };

  const canonical = `${SITE_URL}/compare/${c.slug}`;
  const faq = faqJsonLd(parseFaq(c.body));

  const jsonLd: Record<string, unknown>[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: c.title,
      description: c.description,
      author: { '@type': 'Person', name: c.author },
      publisher: { '@type': 'Organization', name: 'WebJs', url: SITE_URL },
      datePublished: c.date || undefined,
      mainEntityOfPage: canonical,
      url: canonical,
      image: `${SITE_URL}/public/og.png`,
      keywords: [`WebJs vs ${c.competitor}`, ...c.tags].join(', '),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Compare', item: `${SITE_URL}/compare` },
        { '@type': 'ListItem', position: 2, name: `WebJs vs ${c.competitor}`, item: canonical },
      ],
    },
  ];
  if (faq) jsonLd.push(faq);

  return {
    title: `${c.title} · WebJs`,
    description: c.description,
    openGraph: {
      title: c.title,
      description: c.description,
      type: 'article',
      url: canonical,
      publishedTime: c.date,
      authors: [c.author],
      tags: c.tags,
    },
    twitter: { card: 'summary_large_image' },
    jsonLd,
  };
}

export default async function ComparePage({ params }: { params: { slug: string } }) {
  const c = await getComparison(params.slug);
  if (!c) notFound();

  return html`
    <main id="main" tabindex="-1" class="max-w-reading mx-auto px-6 py-16 focus:outline-none">
      <nav class="mb-12">
        <a href="/compare" class="font-mono text-xs text-fg-subtle no-underline hover:text-fg tracking-wide">← All comparisons</a>
      </nav>

      <header class="mb-16">
        <p class="font-mono text-xs uppercase tracking-[0.14em] text-accent font-semibold mb-5">WebJs vs ${c.competitor}</p>
        <h1 class="font-serif text-[clamp(36px,6vw,56px)] leading-[1.05] tracking-tight text-fg m-0 mb-6">${c.title}</h1>
        <p class="text-fg-muted text-lg leading-[1.55] m-0 font-serif italic">${c.tagline}</p>
        ${c.link
          ? html`<p class="mt-5 m-0">
              <a href=${c.link} target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 font-mono text-sm text-accent underline underline-offset-4 decoration-accent/40 hover:decoration-accent transition-colors">
                Visit the ${c.competitor} site
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M7 7h10v10"/></svg>${NEW_TAB}
              </a>
            </p>`
          : ''}
      </header>

      <article class="mt-4">${unsafeHTML(renderPostBody(c.body))}</article>

      <footer class="mt-[104px] pt-9 border-t border-border flex flex-wrap gap-x-6 gap-y-3">
        <a href="/compare" class="font-mono text-xs text-fg-subtle no-underline hover:text-fg tracking-wide">← All comparisons</a>
        <a href="/blog" class="font-mono text-xs text-fg-subtle no-underline hover:text-fg tracking-wide">Read the blog →</a>
      </footer>
    </main>
  `;
}
