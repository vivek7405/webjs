import { listComparisons } from '#modules/compare/queries/list-comparisons.server.ts';
import { listArticles } from '#modules/articles/queries/list-articles.server.ts';
import { listPosts } from '#modules/blog/queries/list-posts.server.ts';
import { renderDocsIndexSection } from '#lib/docs-llms.server.ts';
import { loadRegistryIndex } from '#modules/ui/queries/registry.server.ts';
import { splitByTier } from '#modules/ui/utils/tier.ts';
import { UI_PATH, GH_URL } from '#lib/links.ts';
import { siteUrl } from '#lib/env.ts';

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
 * on the origin. The cross-app URLs (UI, demo, repo) are the shared single
 * source from lib/links.ts, the same ones the header/footer use.
 *
 * The documentation now lives on THIS origin under /docs, so it is
 * enumerated inline (every page, with its description) rather than reduced
 * to a single link at another host. This is the one llms.txt for the site.
 */
const SITE_URL = siteUrl();

/** Render a `## <title>` link section, or nothing when it has no items. */
function section(title: string, items: string[]): string[] {
  return items.length ? ['', `## ${title}`, ...items] : [];
}

export async function GET(): Promise<Response> {
  const [comparisons, articles, posts, docLinks, registry] = await Promise.all([
    listComparisons(),
    listArticles(),
    listPosts(),
    renderDocsIndexSection(SITE_URL),
    loadRegistryIndex(),
  ]);

  // Blog is capped so the file stays a concise index rather than a full
  // archive; the "All posts" hub link below covers everything past the cap.
  const BLOG_LIMIT = 20;

  const lines: string[] = [
    '# WebJs',
    '',
    '> An AI-first, web-components-first full-stack web framework with no build step. Pages are server-rendered and progressively enhanced; components are native custom elements that hydrate as islands. Server actions give typed client-to-server RPC. Runs on Node 24+ or Bun.',
    '',
    'WebJs is inspired by Next.js, Lit, and Rails, but ships its own no-build runtime: TypeScript is stripped at load, ES modules are served directly, and the view layer is web components rather than React. Its own source ships uncompiled in node_modules, so a coding agent opens the file it is calling at the version installed, rather than recalling an API from training data. It works with any assistant through one cross-agent contract, and scaffolds a production-shaped app from the first command.',
    '',
    'Key facts:',
    "- Agent-agnostic: a single cross-agent `AGENTS.md` contract drives Claude, Cursor, Copilot, Gemini, and others, not one vendor's assistant.",
    '- Needs no training data: WebJs is no-build and self-contained (no Lit or other view-library dependency), so its own readable source, plain JS with JSDoc under `node_modules/@webjsdev`, is what runs and is the context a model reads directly. The `.agents/skills/webjs` skill and a richly commented scaffold layer on curated context. The API is Lit-like for familiarity, but ships its own implementation and differs in places, which does not matter because the source is the context.',
    '- Production-shaped from the first file: `webjs create` scaffolds a real database (never JSON files or localStorage), a neutral design-system palette with tokens, accessible UI components, an auth and session baseline, SSR with progressive enhancement, and security headers on by default.',
    '- No build step: source ES modules are served directly, and TypeScript is stripped at load (Node 24+ `module.stripTypeScriptTypes`, or amaro on Bun). Prod perf comes from HTTP/2 plus modulepreload, not bundling.',
    '- Web components, not React: components are native custom elements with a Lit-aligned reactive API (reactive properties, signals, the Lit lifecycle and directive set), hydrated per element as islands. WebJs ships its own implementation, not Lit.',
    '- SSR and progressive enhancement by default: pages render on the server and read, navigate, and submit with JavaScript disabled; interactivity is opt-in per behaviour.',
    "- Server actions: a `'use server'` file exposes typed async functions the client imports as RPC stubs; the wire round-trips Date, Map, Set, BigInt, typed arrays, Blob, File, FormData, and cycles.",
    '- File-based routing with layouts, dynamic routes, route handlers, middleware, and streaming SSR (Suspense), all on web standards.',
    '- Runs on Node 24+ or Bun (a native `Bun.serve` listener on Bun); the source is the runtime, with no build artifact.',
  ];

  lines.push(...section('Overview', [
    // Listed first, and deliberately: it is the one page that answers the flat
    // "what is webjs" question, which several unrelated projects sharing the
    // name make genuinely ambiguous for a model resolving the term.
    `- [What is WebJs?](${SITE_URL}/what-is-webjs): the definitional overview, what it is, what it gives you, and how it differs from the unrelated projects that share the name`,
    `- [Why WebJs](${SITE_URL}/why-webjs): the case for the architecture, and who it is not for`,
    `- [AGENTS.md](${GH_URL}/blob/main/AGENTS.md): the agent-facing contract, the conventions and API for building a WebJs app`,
    `- [Full documentation corpus](${SITE_URL}/llms-full.txt): every doc page below, concatenated as markdown in one file`,
  ]));

  // Every doc page, enumerated. Each link is the page's raw-markdown variant
  // (/docs/<topic>/llms.txt), so a model following one gets prose rather than
  // HTML it has to strip.
  lines.push(...section('Documentation', docLinks));

  // Every component, enumerated the same way the doc pages are. Without this
  // an agent entering through llms.txt could not discover a single component
  // page, while the sitemap advertised all of them, and the whole point of an
  // AI-first kit is that an agent can find the piece it needs. Split by tier
  // because the tier decides HOW you use one: a class helper on a native
  // element, or a custom element tag.
  const uiComponents = registry.filter((i) => i.type === 'registry:ui');
  const { tier1, tier2 } = splitByTier(uiComponents);
  const uiLink = (i: { name: string }) => `- [${i.name}](${SITE_URL}${UI_PATH}/${i.name})`;
  lines.push(...section(
    `UI components, Tier 1 (class helpers on native elements)`,
    tier1.map(uiLink),
  ));
  lines.push(...section(
    `UI components, Tier 2 (stateful custom elements)`,
    tier2.map(uiLink),
  ));

  lines.push(...section('Project', [
    `- [GitHub repository](${GH_URL}): source, issues, and the framework monorepo (plain JS with JSDoc, so what you read is what runs)`,
    `- [UI component library](${SITE_URL}${UI_PATH}): the AI-first web-component kit (\`webjs ui add\`)`,
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
