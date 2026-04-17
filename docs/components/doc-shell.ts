import { WebComponent, html, css } from 'webjs';
import './theme-toggle.ts';
import './doc-search.ts';

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
      { href: '/docs/middleware', label: 'Middleware' },
      { href: '/docs/deployment', label: 'Deployment' },
      { href: '/docs/testing', label: 'Testing' },
      { href: '/docs/conventions', label: 'Conventions & AI Workflow' },
    ],
  },
];

export class DocShell extends WebComponent {
  static tag = 'doc-shell';
  static styles = css`
    :host {
      display: grid;
      grid-template-columns: 260px 1fr;
      min-height: 100vh;
    }
    @media (max-width: 860px) {
      :host { grid-template-columns: 1fr; }
      aside { display: none; }
    }

    aside {
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
      padding: var(--sp-6) var(--sp-5);
      border-right: 1px solid var(--border);
      background: var(--bg-subtle);
      font-size: 14px;
      scrollbar-width: thin;
      scrollbar-color: transparent transparent;
      transition: scrollbar-color 0.3s;
    }
    aside:hover {
      scrollbar-color: var(--border-strong) transparent;
    }
    aside::-webkit-scrollbar { width: 6px; }
    aside::-webkit-scrollbar-track { background: transparent; }
    aside::-webkit-scrollbar-thumb {
      background: transparent;
      border-radius: 999px;
    }
    aside:hover::-webkit-scrollbar-thumb {
      background: var(--border-strong);
    }
    aside::-webkit-scrollbar-thumb:hover {
      background: var(--fg-subtle);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: var(--sp-6);
      text-decoration: none;
      color: var(--fg);
      font: 600 16px/1 var(--font-sans);
    }
    .brand-mark {
      width: 22px; height: 22px;
      border-radius: 6px;
      background: linear-gradient(135deg, var(--accent), color-mix(in oklch, var(--accent) 55%, var(--fg)));
    }

    .section-title {
      font: 600 10px/1 var(--font-mono);
      letter-spacing: 0.15em;
      text-transform: uppercase;
      color: var(--fg-subtle);
      margin: var(--sp-5) 0 var(--sp-2);
    }
    .section-title:first-of-type { margin-top: 0; }

    nav a {
      display: block;
      padding: 6px var(--sp-3);
      margin: 1px 0;
      border-radius: var(--rad-sm);
      color: var(--fg-muted);
      text-decoration: none;
      font-size: 14px;
      transition: color var(--t-fast), background var(--t-fast);
    }
    nav a:hover { color: var(--fg); background: var(--bg-elev); }
    nav a.active { color: var(--accent); background: var(--accent-tint); font-weight: 600; }

    main {
      max-width: 800px;
      padding: var(--sp-7) var(--sp-6) var(--sp-8);
    }

    /* Content typography via ::slotted */
    ::slotted(h1) {
      font: 700 var(--fs-h1)/1.1 var(--font-serif);
      letter-spacing: -0.025em;
      margin: 0 0 var(--sp-4);
      color: var(--accent);
    }
    ::slotted(h2) {
      font: 700 var(--fs-h2)/1.2 var(--font-serif);
      letter-spacing: -0.02em;
      margin: var(--sp-7) 0 var(--sp-3);
      padding-top: var(--sp-5);
      border-top: 1px solid var(--border);
    }
    ::slotted(h3) {
      font-size: 1.1rem;
      font-weight: 700;
      margin: var(--sp-5) 0 var(--sp-2);
    }
    ::slotted(p) { margin: 0 0 var(--sp-4); line-height: 1.7; }
    ::slotted(ul), ::slotted(ol) { padding-left: var(--sp-5); margin: 0 0 var(--sp-4); }
    ::slotted(li) { margin: var(--sp-2) 0; line-height: 1.6; }
    ::slotted(a) {
      color: var(--accent);
      text-decoration: underline;
      text-decoration-color: transparent;
      text-underline-offset: 3px;
      transition: text-decoration-color var(--t-fast);
    }
    ::slotted(a:hover) { text-decoration-color: currentColor; }
    ::slotted(hr) {
      margin: var(--sp-7) 0;
      border: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, var(--border-strong), transparent);
    }
    ::slotted(pre) {
      margin: 0 0 var(--sp-4);
      padding: var(--sp-4);
      border-radius: var(--rad);
      background: var(--bg-sunken);
      border: 1px solid var(--border);
      overflow-x: auto;
      font: 14px/1.6 var(--font-mono);
      color: var(--fg);
    }
    ::slotted(code) {
      font-family: var(--font-mono);
      font-size: 0.88em;
      padding: 2px 6px;
      border-radius: var(--rad-sm);
      background: var(--bg-subtle);
      border: 1px solid var(--border);
    }
    ::slotted(strong) { font-weight: 700; color: var(--fg); }
    ::slotted(blockquote) {
      margin: 0 0 var(--sp-4);
      padding: var(--sp-3) var(--sp-5);
      border-left: 3px solid var(--accent);
      background: var(--accent-tint);
      border-radius: 0 var(--rad) var(--rad) 0;
      color: var(--fg);
      font-style: italic;
    }
    ::slotted(table) {
      width: 100%;
      margin: 0 0 var(--sp-4);
      border-collapse: collapse;
      font-size: 14px;
    }
  `;

  render() {
    return html`
      <aside>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-5)">
          <a class="brand" href="/">
            <span class="brand-mark"></span>
            webjs docs
          </a>
          <theme-toggle></theme-toggle>
        </div>
        <doc-search></doc-search>
        <nav>
          ${NAV_SECTIONS.map(s => html`
            <div class="section-title">${s.title}</div>
            ${s.items.map(it => html`<a href=${it.href}>${it.label}</a>`)}
          `)}
        </nav>
      </aside>
      <main>
        <slot></slot>
      </main>
    `;
  }
}
DocShell.register(import.meta.url);
