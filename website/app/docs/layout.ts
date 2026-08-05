import { html } from '@webjsdev/core';
import type { LayoutProps } from '@webjsdev/core';
import { docsShell } from '#lib/ui/docs-shell.ts';
import '#components/doc-search.ts';
import '#components/docs-drawer.ts';
import '#components/code-block.ts';

/**
 * Docs sub-layout: the page-tree sidebar plus the content column.
 *
 * This is a NON-ROOT layout (invariant 8), so it writes no document shell.
 * The header, footer, theme toggle, fonts, and design tokens all come from
 * `app/layout.ts`, exactly as they do on /what-is-webjs and /blog. The
 * sidebar is the ONLY docs-specific chrome, which is the whole point of
 * serving the docs from webjs.dev instead of a separate subdomain: one
 * design system, one set of tokens, no parallel shell to drift.
 *
 * The shell itself (sidebar, mobile drawer, .prose-docs typography) lives in
 * lib/ui/docs-shell.ts, shared with the component library at /ui, so the two
 * sections cannot drift apart. This file contributes only the docs nav tree
 * and the docs-scoped metadata.
 *
 * Doc page bodies are plain HTML with no component wrapper, so their
 * typography is styled through the shell's `.prose-docs` rules rather than
 * per-element utility classes across 45 pages.
 */
const NAV_SECTIONS = [
  {
    title: 'Getting Started',
    items: [
      { href: '/docs/getting-started', label: 'Introduction' },
      { href: '/docs/ai-first', label: 'AI-First Development' },
      { href: '/docs/architecture', label: 'Architecture' },
      { href: '/docs/no-build', label: 'No-Build Model' },
      { href: '/docs/runtime', label: 'Runtime (Node & Bun)' },
      { href: '/docs/configuration', label: 'Configuration' },
      { href: '/docs/migrating-from-nextjs', label: 'Migrating from Next.js' },
    ],
  },
  {
    title: 'Core Concepts',
    items: [
      { href: '/docs/routing', label: 'Routing' },
      { href: '/docs/components', label: 'Components' },
      { href: '/docs/lifecycle', label: 'Lifecycle Hooks' },
      { href: '/docs/data-fetching', label: 'Data Fetching' },
      { href: '/docs/directives', label: 'Directives' },
      { href: '/docs/ssr', label: 'Server-Side Rendering' },
      { href: '/docs/progressive-enhancement', label: 'Progressive Enhancement' },
      { href: '/docs/styling', label: 'Styling' },
      { href: '/docs/suspense', label: 'Streaming & Suspense' },
      { href: '/docs/loading-states', label: 'Loading States' },
      { href: '/docs/error-handling', label: 'Error Handling' },
      { href: '/docs/client-router', label: 'Client Router' },
    ],
  },
  {
    title: 'Data & Backend',
    items: [
      { href: '/docs/server-actions', label: 'Server Actions' },
      { href: '/docs/api-routes', label: 'API Routes' },
      { href: '/docs/websockets', label: 'WebSockets' },
      { href: '/docs/database', label: 'Database (Drizzle)' },
      { href: '/docs/authentication', label: 'Build Your Own Authentication' },
      { href: '/docs/backend-only', label: 'Backend-Only Mode' },
    ],
  },
  {
    title: 'Infrastructure',
    items: [
      { href: '/docs/cache', label: 'Caching' },
      { href: '/docs/file-storage', label: 'File Storage' },
      { href: '/docs/sessions', label: 'Sessions' },
      { href: '/docs/auth', label: 'Auth Providers (createAuth)' },
      { href: '/docs/rate-limiting', label: 'Rate Limiting' },
      { href: '/docs/security', label: 'Security' },
      { href: '/docs/metadata-routes', label: 'Metadata Routes' },
    ],
  },
  {
    // The component library is its own section at /ui, with the same shell as
    // these pages (see lib/ui/docs-shell.ts). This entry is a cross-link out of
    // the docs rather than a doc page: /docs/ui used to hold a second,
    // hand-written description of the kit that had drifted badly (it
    // advertised roughly 55 components against an actual 32 and showed a
    // <ui-button> API the kit does not have), so it is gone and its URL
    // permanently redirects to /ui.
    title: 'Component Library',
    items: [
      { href: '/ui', label: '@webjsdev/ui (AI-first)' },
    ],
  },
  {
    title: 'Advanced',
    items: [
      { href: '/docs/controllers', label: 'Reactive Controllers' },
      { href: '/docs/context', label: 'Context Protocol' },
      { href: '/docs/task', label: 'Task (Async Data)' },
      { href: '/docs/lazy-loading', label: 'Lazy Loading' },
      { href: '/docs/typescript', label: 'TypeScript' },
      { href: '/docs/editor-setup', label: 'Editor Setup (Neovim, VS Code)' },
      { href: '/docs/middleware', label: 'Middleware' },
      { href: '/docs/deployment', label: 'Deployment' },
      { href: '/docs/testing', label: 'Testing' },
      { href: '/docs/conventions', label: 'Conventions & AI Workflow' },
      { href: '/docs/troubleshooting', label: 'Troubleshooting' },
    ],
  },
];

/**
 * Docs-scoped metadata, merged over the root layout's for every page under
 * /docs. A doc page's own `metadata` still overrides the title, which is the
 * one field each page sets.
 *
 * Without this the docs inherit the marketing pitch: the deleted docs root
 * layout carried its own title and description, so dropping it left all 45
 * pages advertising "the web framework for AI agents" as their search snippet
 * and social card.
 *
 * The merge is a SHALLOW spread per layer (`meta = { ...meta, ...resolved }`
 * in ssr.js), so `openGraph` and `twitter` REPLACE the root's objects rather
 * than merging into them. That is why every field is restated here, including
 * the ones this layer does not care about: naming only `title` and
 * `description` silently dropped `og:image`, its dimensions, `og:url`, and
 * `twitter:card`, leaving every doc URL to share as a bare text card. Keep
 * these in step with app/layout.ts.
 */
const DOCS_DESCRIPTION =
  'Reference documentation for WebJs: routing, components, server actions, data fetching, styling, streaming, deployment, and the conventions an agent needs to build with it.';
const DOCS_OG_TITLE = 'WebJs documentation';

export function generateMetadata(ctx: { url: string }) {
  const { origin, pathname } = new URL(ctx.url);
  const image = `${origin}/public/og.png`;
  return {
    description: DOCS_DESCRIPTION,
    openGraph: {
      type: 'article',
      title: DOCS_OG_TITLE,
      description: DOCS_DESCRIPTION,
      url: origin + pathname,
      image,
      'image:width': '1200',
      'image:height': '630',
      'image:alt': DOCS_OG_TITLE,
      'site_name': 'WebJs',
    },
    twitter: {
      card: 'summary_large_image',
      title: DOCS_OG_TITLE,
      description: DOCS_DESCRIPTION,
      image,
    },
  };
}

export default function DocsLayout({ children }: LayoutProps) {
  return docsShell({
    nav: NAV_SECTIONS,
    label: 'Documentation',
    menuLabel: 'Documentation menu',
    asideTop: html`<doc-search class="shrink-0"></doc-search>`,
    contentClass: 'prose-docs',
    children,
  });
}
