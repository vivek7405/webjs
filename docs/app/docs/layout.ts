import { html } from 'webjs';
import '../../components/theme-toggle.ts';
import '../../components/doc-search.ts';

/**
 * Docs sub-layout — sidebar + content shell. Light DOM throughout.
 * Styling via Tailwind utility classes. Content typography for doc
 * pages lives in the .prose-docs rules in the <style> block (doc page
 * bodies are plain HTML — no component wrapper — so we style <h1>,
 * <p>, <pre>, etc. scoped under .prose-docs).
 */
const NAV_SECTIONS = [
  {
    title: 'Getting Started',
    items: [
      { href: '/docs/getting-started', label: 'Introduction' },
      { href: '/docs/ai-first', label: 'AI-First Development' },
      { href: '/docs/architecture', label: 'Architecture' },
      { href: '/docs/configuration', label: 'Configuration' },
    ],
  },
  {
    title: 'Core Concepts',
    items: [
      { href: '/docs/routing', label: 'Routing' },
      { href: '/docs/components', label: 'Components' },
      { href: '/docs/lifecycle', label: 'Lifecycle Hooks' },
      { href: '/docs/directives', label: 'Directives' },
      { href: '/docs/ssr', label: 'Server-Side Rendering' },
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
      { href: '/docs/expose', label: 'expose() — REST Endpoints' },
      { href: '/docs/api-routes', label: 'API Routes' },
      { href: '/docs/websockets', label: 'WebSockets' },
      { href: '/docs/database', label: 'Database (Prisma)' },
      { href: '/docs/authentication', label: 'Authentication' },
      { href: '/docs/backend-only', label: 'Backend-Only Mode' },
    ],
  },
  {
    title: 'Infrastructure',
    items: [
      { href: '/docs/cache', label: 'Caching' },
      { href: '/docs/sessions', label: 'Sessions' },
      { href: '/docs/auth', label: 'Auth (Providers)' },
      { href: '/docs/rate-limiting', label: 'Rate Limiting' },
      { href: '/docs/metadata-routes', label: 'Metadata Routes' },
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
    ],
  },
];

export default function DocsLayout({ children }: { children: unknown }) {
  return html`
    <style>
      /* Content typography for doc pages — scoped under .prose-docs so
         the same element tags inside sidebar / components stay unaffected. */
      .prose-docs h1 {
        font: 700 var(--fs-h1)/1.1 var(--font-serif);
        letter-spacing: -0.025em;
        margin: 0 0 16px;
        color: var(--accent);
      }
      .prose-docs h2 {
        font: 700 var(--fs-h2)/1.2 var(--font-serif);
        letter-spacing: -0.02em;
        margin: 48px 0 12px;
        padding-top: 24px;
        border-top: 1px solid var(--border);
      }
      .prose-docs h3 { font-size: 1.1rem; font-weight: 700; margin: 24px 0 8px; }
      .prose-docs p  { margin: 0 0 16px; line-height: 1.7; }
      .prose-docs ul, .prose-docs ol { padding-left: 24px; margin: 0 0 16px; }
      .prose-docs li { margin: 8px 0; line-height: 1.6; }
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

      /* Sidebar scrollbar — hide until hover */
      .docs-sidebar { scrollbar-width: thin; scrollbar-color: transparent transparent; transition: scrollbar-color 300ms; }
      .docs-sidebar:hover { scrollbar-color: var(--border-strong) transparent; }
      .docs-sidebar::-webkit-scrollbar { width: 6px; }
      .docs-sidebar::-webkit-scrollbar-track { background: transparent; }
      .docs-sidebar::-webkit-scrollbar-thumb { background: transparent; border-radius: 999px; }
      .docs-sidebar:hover::-webkit-scrollbar-thumb { background: var(--border-strong); }
      .docs-sidebar::-webkit-scrollbar-thumb:hover { background: var(--fg-subtle); }
    </style>

    <div class="grid grid-cols-[260px_1fr] min-h-screen max-[860px]:grid-cols-1">
      <aside class="docs-sidebar sticky top-0 h-screen overflow-y-auto py-8 px-6 border-r border-border bg-bg-subtle text-sm max-[860px]:hidden">
        <div class="flex items-center justify-between mb-6">
          <a class="flex items-center gap-2 no-underline text-fg font-semibold text-base leading-none" href="/">
            <span class="w-[22px] h-[22px] rounded-md bg-gradient-to-br from-accent to-[color-mix(in_oklch,var(--accent)_55%,var(--fg))]"></span>
            webjs docs
          </a>
          <theme-toggle></theme-toggle>
        </div>
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
      <main class="max-w-[800px] px-6 pt-12 pb-16">
        <div class="prose-docs">${children}</div>
      </main>
    </div>
  `;
}
