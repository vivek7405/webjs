import { html, unsafeHTML, notFound } from '@webjsdev/core';
import { getPost } from '#modules/blog/queries/get-post.server.ts';
import { renderPostBody } from '#modules/blog/utils/render-post.ts';

/**
 * /blog/[slug]
 *
 * Thin route adapter. File-reading, frontmatter parsing, and markdown
 * rendering live in `modules/blog/`. This page composes them.
 *
 * `generateMetadata` derives <head> from the post's frontmatter so
 * each post gets its own title / description / og:* tags for SEO,
 * a canonical URL per post at `/blog/<slug>`, and JSON-LD
 * (`BlogPosting` + `BreadcrumbList`) for rich results. Blog posts are
 * WebJs design notes and carry no `## FAQ` section; the evergreen SEO
 * explainers under `/articles` are where FAQ + FAQPage live.
 */

const SITE_URL = 'https://webjs.dev';

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const post = await getPost(params.slug);
  if (!post) return { title: 'Post not found · WebJs' };

  const canonical = `${SITE_URL}/blog/${post.slug}`;
  const jsonLd: Record<string, unknown>[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      description: post.description,
      author: { '@type': 'Person', name: post.author },
      publisher: { '@type': 'Organization', name: 'WebJs', url: SITE_URL },
      datePublished: post.date || undefined,
      mainEntityOfPage: canonical,
      url: canonical,
      image: `${SITE_URL}/public/og.png`,
      keywords: (post.tags || []).join(', '),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Blog', item: `${SITE_URL}/blog` },
        { '@type': 'ListItem', position: 2, name: post.title, item: canonical },
      ],
    },
  ];

  return {
    title: `${post.title} · WebJs Blog`,
    description: post.description,
    openGraph: {
      title: post.title,
      description: post.description,
      type: 'article',
      url: canonical,
      publishedTime: post.date,
      authors: [post.author],
      tags: post.tags,
    },
    twitter: { card: 'summary_large_image' },
    jsonLd,
  };
}

export default async function BlogPost({ params }: { params: { slug: string } }) {
  const post = await getPost(params.slug);
  if (!post) notFound();

  return html`
    <main id="main" tabindex="-1" class="max-w-[840px] mx-auto px-6 py-16 focus:outline-none">
      <nav class="mb-12">
        <a href="/blog" class="font-mono text-xs text-fg-subtle no-underline hover:text-fg tracking-wide">← All posts</a>
      </nav>

      <header class="mb-16">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2 mb-6">
          <time class="font-mono text-xs text-fg-subtle tracking-tight">${post.date.slice(0, 10)}</time>
          <span class="text-fg-subtle/40 text-xs">·</span>
          <span class="font-mono text-xs text-fg-subtle">By ${post.author}</span>
          ${post.tags.length > 0 ? html`<span class="text-fg-subtle/40 text-xs">·</span>` : ''}
          ${post.tags.map((t) => html`<span class="bg-fg-subtle/10 text-fg-subtle font-mono text-2xs uppercase tracking-[0.12em] px-2 py-0.5 rounded">${t}</span>`)}
        </div>
        <h1 class="font-serif text-[clamp(36px,6vw,56px)] leading-[1.05] tracking-tight text-fg m-0 mb-6">${post.title}</h1>
        <p class="text-fg-muted text-lg leading-[1.55] m-0 font-serif italic">${post.description}</p>
      </header>

      <article class="mt-4">${unsafeHTML(renderPostBody(post.body))}</article>

      <footer class="mt-[104px] pt-9 border-t border-border">
        <a href="/blog" class="font-mono text-xs text-fg-subtle no-underline hover:text-fg tracking-wide">← All posts</a>
      </footer>
    </main>
  `;
}
