import { sitemap } from '@webjsdev/server';
import { listComparisons } from '#modules/compare/queries/list-comparisons.server.ts';
import { listArticles } from '#modules/articles/queries/list-articles.server.ts';
import { listPosts } from '#modules/blog/queries/list-posts.server.ts';
import { getDocPages } from '#lib/docs-llms.server.ts';
import { loadRegistryIndex } from '#modules/ui/queries/registry.server.ts';

/**
 * /sitemap.xml
 *
 * Serialized from the live content queries so newly added comparison,
 * article, blog, and documentation content is discoverable without touching
 * this file. The compare pages, the evergreen `/articles` explainers, the
 * blog posts, and the docs are the reason this exists: each is a canonical
 * page we want search engines to crawl and index.
 *
 * The documentation is the largest body of indexable content the project
 * has, and it is enumerated here from the live pages on disk rather than a
 * hardcoded path list, so a new doc page is crawlable the moment it exists.
 *
 * `SITE_URL` falls back to the production origin; override it per
 * deployment the same way the header/footer links are configured.
 */
const SITE_URL = ((globalThis as any).process?.env?.SITE_URL || 'https://webjs.dev').replace(/\/$/, '');

export default async function Sitemap() {
  const [comparisons, articles, posts, docPages, registry] = await Promise.all([
    listComparisons(),
    listArticles(),
    listPosts(),
    getDocPages(),
    loadRegistryIndex(),
  ]);

  // `/what-is-webjs` is a primary page, not a hub, so it carries a priority
  // just under the home page. It is the canonical answer to the flat
  // "what is webjs" query, which is contested by several unrelated projects
  // that happen to share the name.
  const PRIORITY: Record<string, number> = { '/': 1.0, '/what-is-webjs': 0.9 };

  const staticRoutes = ['/', '/what-is-webjs', '/blog', '/articles', '/compare', '/why-webjs', '/changelog', '/ui'].map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: 'weekly' as const,
    priority: PRIORITY[path] ?? 0.7,
  }));

  // `/docs` itself is deliberately absent: it permanently redirects to
  // /docs/getting-started, and listing a redirect in a sitemap asks a crawler
  // to spend a fetch discovering that. The destination is listed instead.
  const docRoutes = docPages.map((p) => ({
    url: `${SITE_URL}${p.path}`,
    changeFrequency: 'weekly' as const,
    priority: p.slug === 'getting-started' ? 0.9 : 0.8,
  }));

  // One entry per component in the gallery, enumerated from the live registry
  // index rather than a hardcoded list, so a component added to
  // packages/ui/packages/registry is crawlable the moment it exists. Only
  // `registry:ui` items have a page; themes and lib items are registry
  // artifacts with nothing to render (and /ui/<theme> deliberately 404s).
  //
  // ui.webjs.dev served no sitemap at all, which is a large part of why moving
  // the gallery was cheap: there was almost nothing indexed to lose.
  const uiRoutes = registry
    .filter((item) => item.type === 'registry:ui')
    .map((item) => ({
      url: `${SITE_URL}/ui/${item.name}`,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
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

  return sitemap([...staticRoutes, ...docRoutes, ...uiRoutes, ...compareRoutes, ...articleRoutes, ...blogRoutes]);
}
