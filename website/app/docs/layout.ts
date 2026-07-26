import { html } from '@webjsdev/core';
import '#components/doc-search.ts';

/**
 * Docs sub-layout: the page-tree sidebar plus the content column.
 *
 * This is a NON-ROOT layout (invariant 8), so it writes no document shell.
 * The header, footer, theme toggle, fonts, and design tokens all come from
 * `app/layout.ts`, exactly as they do on /what-is-webjs and /blog. The
 * sidebar below is the ONLY docs-specific chrome, which is the whole point
 * of serving the docs from webjs.dev instead of a separate subdomain: one
 * design system, one set of tokens, no parallel shell to drift.
 *
 * Doc page bodies are plain HTML with no component wrapper, so their
 * typography is styled through `.prose-docs` descendant selectors rather than
 * per-element utility classes across 45 pages. Those rules, and the sidebar and
 * mobile-drawer rules, live in `public/input.css`, NOT in a `<style>` here.
 *
 * That placement is load-bearing (#1109). A sub-layout renders inside the
 * client router's swap boundary, so a `<style>` in this template is inserted on
 * entering /docs and removed on leaving. Adding or removing a stylesheet
 * mutates the document CSSOM, which invalidates style for the whole document,
 * including the preserved fixed header, and that is what made crossing in and
 * out of /docs flash. The compiled stylesheet is loaded once by the root layout
 * above every boundary and never swapped.
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
      { href: '/docs/authentication', label: 'Authentication' },
      { href: '/docs/backend-only', label: 'Backend-Only Mode' },
    ],
  },
  {
    title: 'Infrastructure',
    items: [
      { href: '/docs/cache', label: 'Caching' },
      { href: '/docs/file-storage', label: 'File Storage' },
      { href: '/docs/sessions', label: 'Sessions' },
      { href: '/docs/auth', label: 'Auth (Providers)' },
      { href: '/docs/rate-limiting', label: 'Rate Limiting' },
      { href: '/docs/security', label: 'Security' },
      { href: '/docs/metadata-routes', label: 'Metadata Routes' },
    ],
  },
  {
    title: 'Component Library',
    items: [
      { href: '/docs/ui', label: '@webjsdev/ui (AI-first)' },
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

export default function DocsLayout({ children }: { children: unknown }) {
  return html`
    <!-- No inline style block here. A sub-layout renders INSIDE the router's
         swap boundary, so a style element in this template is inserted on
         entering /docs and removed on leaving, churning the document CSSOM on
         every crossing and repainting the preserved header (#1109). The
         .prose-docs scale, the sidebar, and the mobile drawer all live in
         public/input.css, which the root layout loads once above the boundary.
         (Tag name spelled out rather than bracketed: this comment ships in the
         served HTML, and a literal tag here confuses any document scanner.) -->

    <div class="docs-backdrop" onclick="document.body.removeAttribute('data-docs-nav-open')"></div>

    <!-- Same container as the shared header (max-w-[1240px] mx-auto px-6), so
         the sidebar's left edge lines up with the wordmark above it and the
         content column lines up with every other page on the site. A
         full-bleed docs shell was the other tell that this section was pasted
         in from somewhere else. -->
    <div class="max-w-[1240px] mx-auto px-6 grid grid-cols-[248px_1fr] gap-10 min-h-screen max-[860px]:grid-cols-1 max-[860px]:gap-0">
      <aside
        id="docs-sidebar"
        class="docs-sidebar flex flex-col py-10 text-sm max-[860px]:px-5"
        aria-label="Documentation"
        onclick="if (event.target.closest('a')) document.body.removeAttribute('data-docs-nav-open')"
      >
        <doc-search class="shrink-0"></doc-search>
        <!-- min-h-0 is what lets this shrink inside the flex column; without
             it the nav takes its content height and the column scrolls
             instead, taking the search field with it. pr-3 keeps the
             scrollbar off the links; the left inset comes from the px-2 on
             the labels and links themselves. -->
        <nav class="docs-nav flex-1 min-h-0 overflow-y-auto pr-3">
          ${NAV_SECTIONS.map((s) => html`
            <div class="font-mono text-[10px] font-semibold tracking-[0.15em] uppercase text-fg-subtle px-2 mt-6 mb-2 first:mt-0">${s.title}</div>
            ${s.items.map((it) => html`
              <a class="block py-1.5 px-2 my-px rounded-md text-fg-muted no-underline text-sm transition-colors duration-fast hover:text-fg hover:bg-bg-subtle" href=${it.href}>${it.label}</a>
            `)}
          `)}
        </nav>
      </aside>
      <main id="main" tabindex="-1" class="min-w-0 max-w-[820px] pt-10 pb-16 focus:outline-none">
        <button
          class="hidden max-[860px]:inline-flex items-center gap-2 mb-6 px-3 py-2 rounded-lg border border-border bg-bg-elev text-fg-muted text-sm cursor-pointer transition-colors duration-fast hover:text-fg hover:border-border-strong"
          aria-controls="docs-sidebar"
          aria-expanded="false"
          onclick="document.body.toggleAttribute('data-docs-nav-open'); this.setAttribute('aria-expanded', document.body.hasAttribute('data-docs-nav-open'))"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
          Documentation menu
        </button>
        <div class="prose-docs">${children}</div>
      </main>
    </div>
  `;
}
