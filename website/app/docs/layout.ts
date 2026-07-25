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
 * typography is styled through the `.prose-docs` rules below rather than
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

export default function DocsLayout({ children }: { children: unknown }) {
  return html`
    <style>
      /* Content typography for doc pages, scoped under .prose-docs so the
         same element tags inside the shared header, footer, and sidebar stay
         unaffected. Every value reads a marketing-site token. */
      .prose-docs h1 {
        font: 700 var(--text-doc-h1)/1.1 var(--font-serif);
        letter-spacing: -0.025em;
        margin: 0 0 16px;
        color: var(--accent);
      }
      .prose-docs h2 {
        font: 700 var(--text-doc-h2)/1.2 var(--font-serif);
        letter-spacing: -0.02em;
        margin: 48px 0 12px;
        padding-top: 24px;
        border-top: 1px solid var(--border);
      }
      .prose-docs h3 { font-size: 1.1rem; font-weight: 700; margin: 24px 0 8px; }
      .prose-docs p  { margin: 0 0 16px; line-height: 1.7; overflow-wrap: anywhere; }
      .prose-docs ul, .prose-docs ol { padding-left: 24px; margin: 0 0 16px; }
      .prose-docs li { margin: 8px 0; line-height: 1.6; overflow-wrap: anywhere; }
      .prose-docs a {
        color: var(--accent);
        text-decoration: underline;
        text-decoration-color: transparent;
        text-underline-offset: 3px;
        transition: text-decoration-color 140ms;
      }
      .prose-docs a:hover { text-decoration-color: currentColor; }
      .prose-docs hr {
        margin: 48px 0;
        border: 0;
        height: 1px;
        background: linear-gradient(90deg, transparent, var(--border-strong), transparent);
      }
      .prose-docs pre {
        margin: 0 0 16px;
        padding: 16px;
        border-radius: 8px;
        background: var(--bg-sunken);
        border: 1px solid var(--border);
        overflow-x: auto;
        font: 14px/1.6 var(--font-mono);
        color: var(--fg);
      }
      .prose-docs code {
        font-family: var(--font-mono);
        font-size: 0.88em;
        padding: 2px 6px;
        border-radius: 4px;
        background: var(--bg-subtle);
        border: 1px solid var(--border);
        overflow-wrap: anywhere;
      }
      .prose-docs pre code { padding: 0; border: 0; background: transparent; font-size: inherit; }
      .prose-docs strong { font-weight: 700; color: var(--fg); }
      .prose-docs blockquote {
        margin: 0 0 16px;
        padding: 12px 24px;
        border-left: 3px solid var(--accent);
        background: var(--accent-tint);
        border-radius: 0 8px 8px 0;
        color: var(--fg);
        font-style: italic;
      }
      .prose-docs table { width: 100%; margin: 0 0 16px; border-collapse: collapse; font-size: 14px; }
      .prose-docs th, .prose-docs td { padding: 8px 12px; border-bottom: 1px solid var(--border); text-align: left; }
      .prose-docs th { font-weight: 600; background: var(--bg-subtle); }

      /* The sidebar sticks BELOW the shared fixed header, so it reads
         --header-h from the root layout rather than assuming a bare viewport.
         Only the offset is docs-specific; the header itself is shared. */
      .docs-sidebar {
        position: sticky;
        top: var(--header-h);
        height: calc(100vh - var(--header-h));
      }

      /* Sidebar scrollbar: hidden until hover, matching the .scroll-thin
         treatment the root layout defines for the marketing pages. */
      .docs-sidebar { scrollbar-width: thin; scrollbar-color: transparent transparent; transition: scrollbar-color 300ms; }
      .docs-sidebar:hover { scrollbar-color: var(--border-strong) transparent; }
      .docs-sidebar::-webkit-scrollbar { width: 6px; }
      .docs-sidebar::-webkit-scrollbar-track { background: transparent; }
      .docs-sidebar::-webkit-scrollbar-thumb { background: transparent; border-radius: 999px; }
      .docs-sidebar:hover::-webkit-scrollbar-thumb { background: var(--border-strong); }
      .docs-sidebar::-webkit-scrollbar-thumb:hover { background: var(--fg-subtle); }

      /* Mobile: the sidebar becomes a drawer sliding in from the left,
         toggled by [data-docs-nav-open] on body. The attribute name is
         docs-specific so it cannot collide with the shared header's own
         mobile menu, which is a details element in the root layout.

         The drawer opens BELOW the shared header rather than over it, and
         that is load-bearing, not a taste call. The root layout wraps
         children in a relative z-1 element, which is a stacking context,
         so nothing rendered in here can paint above the z-20 header no
         matter what z-index it claims: a full-height drawer would have its
         top band (which holds the search field) buried under the header,
         with the clicks going to the header instead. Starting at
         --header-h sidesteps the stacking context entirely and leaves the
         header usable while the drawer is open. */
      .docs-backdrop { display: none; }
      @media (max-width: 860px) {
        .docs-sidebar {
          position: fixed;
          top: var(--header-h); left: 0; bottom: 0;
          width: 280px; max-width: 85vw;
          height: auto;
          z-index: 40;
          transform: translateX(-100%);
          transition: transform 220ms cubic-bezier(0.3, 0, 0.3, 1);
          box-shadow: 4px 0 24px oklch(0 0 0 / 0.25);
        }
        body[data-docs-nav-open] .docs-sidebar { transform: translateX(0); }
        .docs-backdrop {
          display: block;
          position: fixed;
          top: var(--header-h); left: 0; right: 0; bottom: 0;
          background: oklch(0 0 0 / 0.5);
          opacity: 0; pointer-events: none;
          transition: opacity 220ms;
          z-index: 30;
        }
        body[data-docs-nav-open] .docs-backdrop { opacity: 1; pointer-events: auto; }
        body[data-docs-nav-open] { overflow: hidden; }
      }
    </style>

    <div class="docs-backdrop" onclick="document.body.removeAttribute('data-docs-nav-open')"></div>

    <div class="min-[1920px]:mx-auto min-[1920px]:max-w-[1280px] grid grid-cols-[260px_1fr] min-h-screen max-[860px]:grid-cols-1">
      <aside
        id="docs-sidebar"
        class="docs-sidebar overflow-y-auto py-8 px-6 border-r border-border bg-bg-subtle text-sm"
        aria-label="Documentation"
        onclick="if (event.target.closest('a')) document.body.removeAttribute('data-docs-nav-open')"
      >
        <doc-search></doc-search>
        <nav>
          ${NAV_SECTIONS.map((s) => html`
            <div class="font-mono text-[10px] font-semibold tracking-[0.15em] uppercase text-fg-subtle mt-6 mb-2 first:mt-0">${s.title}</div>
            ${s.items.map((it) => html`
              <a class="block py-1.5 px-3 my-px rounded-md text-fg-muted no-underline text-sm transition-colors duration-fast hover:text-fg hover:bg-bg-elev" href=${it.href}>${it.label}</a>
            `)}
          `)}
        </nav>
      </aside>
      <main class="min-w-0 max-w-[820px] px-6 pt-10 pb-16">
        <button
          class="hidden max-[860px]:inline-flex items-center gap-2 mb-6 px-3 py-2 rounded-lg border border-border bg-bg-elev text-fg-muted text-sm cursor-pointer transition-colors duration-fast hover:text-fg hover:border-border-strong"
          aria-controls="docs-sidebar"
          onclick="document.body.toggleAttribute('data-docs-nav-open'); this.setAttribute('aria-expanded', document.body.hasAttribute('data-docs-nav-open'))"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
          Documentation menu
        </button>
        <div class="prose-docs">${children}</div>
      </main>
    </div>

    <!-- Progressive-enhancement syntax highlighting for the doc code samples.
         The blocks are server-rendered as plain readable text; this tokenizes
         them into the SAME t-* classes the marketing site's SSR highlighter
         emits, whose palette is declared once in public/input.css. -->
    <script src="/public/code-highlight.js" defer></script>
  `;
}
