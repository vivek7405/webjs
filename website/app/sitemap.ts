import { sitemap } from '@webjsdev/server';
import { listComparisons } from '#modules/compare/queries/list-comparisons.server.ts';
import { listArticles } from '#modules/articles/queries/list-articles.server.ts';
import { listPosts } from '#modules/blog/queries/list-posts.server.ts';

/**
 * /sitemap.xml
 *
 * Serialized from the live content queries so newly added comparison,
 * article, and blog markdown is discoverable without touching this file.
 * The compare pages, the evergreen `/articles` explainers, and the blog
 * posts are the reason this exists: each is a canonical page we want
 * search engines to crawl and index.
 *
 * `SITE_URL` falls back to the production origin; override it per
 * deployment the same way the header/footer links are configured.
 */
const SITE_URL = ((globalThis as any).process?.env?.SITE_URL || 'https://webjs.dev').replace(/\/$/, '');

export default async function Sitemap() {
  const [comparisons, articles, posts] = await Promise.all([listComparisons(), listArticles(), listPosts()]);

  // `/what-is-webjs` is a primary page, not a hub, so it carries a priority
  // just under the home page. It is the canonical answer to the flat
  // "what is webjs" query, which is contested by several unrelated projects
  // that happen to share the name.
  const PRIORITY: Record<string, number> = { '/': 1.0, '/what-is-webjs': 0.9 };

  const staticRoutes = ['/', '/what-is-webjs', '/blog', '/articles', '/compare', '/why', '/changelog'].map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: 'weekly' as const,
    priority: PRIORITY[path] ?? 0.7,
  }));

  const compareRoutes = comparisons.map((c) => ({
    url: `${SITE_URL}/compare/${c.slug}`,
    lastModified: c.date || undefined,
    changeFrequency: 'monthly' as const,
    priority: 0.8,
  }));

  const articleRoutes = articles.map((a) => ({
    url: `${SITE_URL}/articles/${a.slug}`,
    lastModified: a.date || undefined,
    changeFrequency: 'monthly' as const,
    priority: 0.8,
  }));

  const blogRoutes = posts.map((p) => ({
    url: `${SITE_URL}/blog/${p.slug}`,
    lastModified: p.date || undefined,
    changeFrequency: 'monthly' as const,
    priority: 0.6,
  }));

  return sitemap([...staticRoutes, ...compareRoutes, ...articleRoutes, ...blogRoutes]);
}
