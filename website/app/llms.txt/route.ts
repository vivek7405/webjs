import { listComparisons } from '#modules/compare/queries/list-comparisons.server.ts';
import { listArticles } from '#modules/articles/queries/list-articles.server.ts';
import { listPosts } from '#modules/blog/queries/list-posts.server.ts';
import { DOCS_URL, UI_URL, EXAMPLE_BLOG_URL, GH_URL } from '#lib/links.ts';

/**
 * GET /llms.txt
 *
 * A machine-readable overview of WebJs for LLMs and AI coding agents,
 * following the llmstxt.org convention (an H1 name, a `>` blockquote
 * summary, free-form detail, then `##` link sections, with a trailing
 * `## Optional` for links a shorter context may skip). On-brand for an
 * AI-first framework: the same agents the framework is built for get a
 * canonical, curated entry point instead of scraping the rendered HTML.
 *
 * A route handler (not a metadata route) because `/llms.txt` is not one
 * of the framework's metadata stems. It is server-only, so it imports the
 * content queries directly and lists every live article + comparison, the
 * blog hub plus recent posts, and the key project entry points (repo, the
 * agent-facing AGENTS.md contract, docs, UI kit, demo).
 *
 * `SITE_URL` mirrors app/sitemap.ts and app/robots.ts so all three agree
 * on the origin. The cross-app URLs (docs, UI, demo, repo) are the shared
 * single source from lib/links.ts, the same ones the header/footer use.
 */
const SITE_URL = ((globalThis as any).process?.env?.SITE_URL || 'https://webjs.dev').replace(/\/$/, '');

/** Render a `## <title>` link section, or nothing when it has no items. */
function section(title: string, items: string[]): string[] {
  return items.length ? ['', `## ${title}`, ...items] : [];
}

export async function GET(): Promise<Response> {
  const [comparisons, articles, posts] = await Promise.all([listComparisons(), listArticles(), listPosts()]);

  // Blog is capped so the file stays a concise index rather than a full
  // archive; the "All posts" hub link below covers everything past the cap.
  const BLOG_LIMIT = 20;

  const lines: string[] = [
    '# WebJs',
    '',
    '> An AI-first, web-components-first full-stack web framework with no build step. Pages are server-rendered and progressively enhanced; components are native custom elements that hydrate as islands. Server actions give typed client-to-server RPC. Runs on Node 24+ or Bun.',
    '',
    'WebJs is inspired by Next.js, Lit, and Rails, but ships its own no-build runtime: TypeScript is stripped at load, ES modules are served directly, and the view layer is web components rather than React. It is designed to be read end to end by AI coding agents.',
    '',
    'Key facts:',
    '- No build step: source ES modules are served directly, and TypeScript is stripped at load (Node 24+ `module.stripTypeScriptTypes`, or amaro on Bun). Prod perf comes from HTTP/2 plus modulepreload, not bundling.',
    '- Web components, not React: components are native custom elements with a Lit-compatible reactive API (reactive properties, signals, the Lit lifecycle and directive set), hydrated per element as islands.',
    '- SSR and progressive enhancement by default: pages render on the server and read, navigate, and submit with JavaScript disabled; interactivity is opt-in per behaviour.',
    "- Server actions: a `'use server'` file exposes typed async functions the client imports as RPC stubs; the wire round-trips Date, Map, Set, BigInt, typed arrays, Blob, File, FormData, and cycles.",
    '- File-based routing with layouts, dynamic routes, route handlers, middleware, and streaming SSR (Suspense), all on web standards.',
    '- Runs on Node 24+ or Bun (a native `Bun.serve` listener on Bun); the source is the runtime, with no build artifact.',
  ];

  lines.push(...section('Docs', [
    `- [Getting started](${DOCS_URL}/docs/getting-started): install, scaffold, and run your first app`,
    `- [Documentation](${DOCS_URL}/docs): the full framework reference`,
    `- [AGENTS.md](${GH_URL}/blob/main/AGENTS.md): the agent-facing contract, the conventions and API for building a WebJs app`,
  ]));

  lines.push(...section('Project', [
    `- [GitHub repository](${GH_URL}): source, issues, and the framework monorepo (plain JS with JSDoc, so what you read is what runs)`,
    `- [UI component library](${UI_URL}): the AI-first web-component kit (\`webjs ui add\`)`,
    `- [Live demo](${EXAMPLE_BLOG_URL}): a real WebJs app (the example blog)`,
    `- [Changelog](${SITE_URL}/changelog): the unified per-package release feed`,
  ]));

  lines.push(...section('Articles', articles.map(
    (a) => `- [${a.title}](${SITE_URL}/articles/${a.slug}): ${a.tagline}`,
  )));

  lines.push(...section('Comparisons', comparisons.map(
    (c) => `- [WebJs vs ${c.competitor}](${SITE_URL}/compare/${c.slug}): ${c.tagline}`,
  )));

  lines.push(...section('Blog', [
    `- [All posts](${SITE_URL}/blog): the full index of design notes`,
    ...posts.slice(0, BLOG_LIMIT).map(
      (p) => `- [${p.title}](${SITE_URL}/blog/${p.slug})${p.description ? `: ${p.description}` : ''}`,
    ),
  ]));

  lines.push(...section('Optional', [
    `- [Sitemap](${SITE_URL}/sitemap.xml): every crawlable page, enumerated`,
  ]));

  lines.push('');

  return new Response(lines.join('\n'), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400',
    },
  });
}
