import { html, unsafeHTML, notFound } from '@webjsdev/core';
import { getArticle } from '#modules/articles/queries/get-article.server.ts';
import { renderPostBody } from '#modules/blog/utils/render-post.ts';
import { parseFaq, faqJsonLd } from '#lib/faq.ts';

/**
 * /articles/[slug]
 *
 * Thin route adapter over `modules/articles/`. The markdown body is
 * rendered with the blog's `renderPostBody` (same typography), and the
 * `## FAQ` at the end of the body is BOTH rendered (as normal `##`/`###`
 * markdown) and parsed into a `FAQPage` JSON-LD block, so the structured
 * data always matches what a visitor sees.
 *
 * `generateMetadata` gives each article its own title / description / og:*
 * tags, a canonical URL at `/articles/<slug>`, and JSON-LD (`TechArticle`
 * + `BreadcrumbList` + optional `FAQPage`), which is what makes these
 * pages eligible for rich results and AI-answer-engine extraction.
 *
 * Deliberately mirrors `app/compare/[slug]/page.ts`. Articles are the
 * evergreen SEO explainers; `/blog` is dated WebJs design notes.
 */

const SITE_URL = 'https://webjs.dev';

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const a = await getArticle(params.slug);
  if (!a) return { title: 'Article not found · WebJs' };

  const canonical = `${SITE_URL}/articles/${a.slug}`;
  const faq = faqJsonLd(parseFaq(a.body));

  const jsonLd: Record<string, unknown>[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: a.title,
      description: a.description,
      author: { '@type': 'Person', name: a.author },
      publisher: { '@type': 'Organization', name: 'WebJs', url: SITE_URL },
      datePublished: a.date || undefined,
      mainEntityOfPage: canonical,
      url: canonical,
      image: `${SITE_URL}/public/og.png`,
      keywords: a.keyword,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Articles', item: `${SITE_URL}/articles` },
        { '@type': 'ListItem', position: 2, name: a.title, item: canonical },
      ],
    },
  ];
  if (faq) jsonLd.push(faq);

  return {
    title: `${a.title} · WebJs`,
    description: a.description,
    openGraph: {
      title: a.title,
      description: a.description,
      type: 'article',
      url: canonical,
      publishedTime: a.date,
      authors: [a.author],
      tags: a.tags,
    },
    twitter: { card: 'summary_large_image' },
    jsonLd,
  };
}

export default async function ArticlePage({ params }: { params: { slug: string } }) {
  const a = await getArticle(params.slug);
  if (!a) notFound();

  return html`
    <main id="main" tabindex="-1" class="max-w-3xl mx-auto px-6 py-16 focus:outline-none">
      <nav class="mb-12">
        <a href="/articles" class="font-mono text-xs text-fg-subtle no-underline hover:text-fg tracking-wide">← All articles</a>
      </nav>

      <header class="mb-16">
        <h1 class="font-serif text-[clamp(36px,6vw,56px)] leading-[1.05] tracking-tight text-fg m-0 mb-6">${a.title}</h1>
        <p class="text-fg-muted text-lg leading-[1.55] m-0 font-serif italic">${a.tagline}</p>
      </header>

      <article class="mt-4">${unsafeHTML(renderPostBody(a.body))}</article>

      <footer class="mt-[104px] pt-9 border-t border-border flex flex-wrap gap-x-6 gap-y-3">
        <a href="/articles" class="font-mono text-xs text-fg-subtle no-underline hover:text-fg tracking-wide">← All articles</a>
        <a href="/compare" class="font-mono text-xs text-fg-subtle no-underline hover:text-fg tracking-wide">Compare WebJs →</a>
      </footer>
    </main>
  `;
}
