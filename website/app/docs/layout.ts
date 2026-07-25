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
    <style>
      /* Content typography for doc pages, scoped under .prose-docs so the
         same element tags inside the shared header, footer, and sidebar stay
         unaffected.

         This deliberately tracks the site's OTHER long-form surface, the blog
         post renderer in lib/render-post.ts: serif headings in --fg, no rules
         between sections, code in a --bg-subtle card, an accent-bar
         blockquote with no fill. The docs previously had their own voice here
         (an orange h1, a border-top on every h2, near-black code blocks) and
         that mismatch is what made them read as a different site even after
         they moved onto this one.

         The one deliberate divergence is RHYTHM. A blog post breathes at
         80px between sections; a reference page with forty of them would just
         be scrolling. So the scale is the site's and the spacing is tighter. */
      .prose-docs h1 {
        font: 700 var(--text-doc-h1)/1.12 var(--font-serif);
        letter-spacing: -0.025em;
        margin: 0 0 20px;
        color: var(--fg);
      }
      .prose-docs h2 {
        font: 700 var(--text-doc-h2)/1.18 var(--font-serif);
        letter-spacing: -0.02em;
        color: var(--fg);
        margin: 56px 0 16px;
      }
      .prose-docs h3 {
        font: 700 1.15rem/1.3 var(--font-serif);
        letter-spacing: -0.01em;
        color: var(--fg);
        margin: 36px 0 10px;
      }
      .prose-docs p  { margin: 0 0 18px; font-size: 17px; line-height: 1.75; overflow-wrap: anywhere; }
      .prose-docs ul, .prose-docs ol { padding-left: 24px; margin: 0 0 18px; }
      .prose-docs li { margin: 8px 0; font-size: 17px; line-height: 1.7; overflow-wrap: anywhere; }
      .prose-docs a {
        color: var(--accent);
        text-decoration: underline;
        text-decoration-color: transparent;
        text-underline-offset: 3px;
        transition: text-decoration-color 140ms;
      }
      .prose-docs a:hover { text-decoration-color: currentColor; }
      .prose-docs hr {
        margin: 56px 0;
        border: 0;
        height: 1px;
        background: linear-gradient(90deg, transparent, var(--border-strong), transparent);
      }
      .prose-docs pre {
        margin: 0 0 24px;
        padding: 20px 24px;
        border-radius: 12px;
        background: var(--bg-subtle);
        border: 1px solid var(--border);
        overflow-x: auto;
        font: 13px/1.7 var(--font-mono);
        color: var(--fg);
      }
      .prose-docs code {
        font-family: var(--font-mono);
        font-size: 0.86em;
        padding: 2px 6px;
        border-radius: 4px;
        background: var(--bg-subtle);
        border: 1px solid var(--border);
        overflow-wrap: anywhere;
      }
      .prose-docs pre code { padding: 0; border: 0; background: transparent; font-size: inherit; }
      .prose-docs strong { font-weight: 700; color: var(--fg); }
      .prose-docs blockquote {
        margin: 28px 0;
        padding: 0 0 0 20px;
        border-left: 2px solid var(--accent);
        color: var(--fg-muted);
        font-size: 17px;
        line-height: 1.7;
        font-style: italic;
      }
      .prose-docs table {
        width: 100%;
        margin: 0 0 24px;
        border-collapse: collapse;
        font-size: 15px;
      }
      .prose-docs th, .prose-docs td { padding: 10px 12px; border-bottom: 1px solid var(--border); text-align: left; }
      .prose-docs th { font-weight: 600; color: var(--fg); }

      /* The sidebar sticks BELOW the shared fixed header, so it reads
         --header-h from the root layout rather than assuming a bare viewport.
         Only the offset is docs-specific; the header itself is shared.

         It is deliberately TRANSPARENT on desktop: no panel fill, no divider
         rule. The root layout paints one warm glow across the whole viewport
         behind the content, and an opaque sidebar would mask it on the left
         while the content column kept it, splitting the page into two
         different backgrounds and making the docs read as a separate app
         bolted onto the site. The same reason the marketing pages and the UI
         site's docs shell carry no panel behind their nav. */
      .docs-sidebar {
        position: sticky;
        top: var(--header-h);
        height: calc(100vh - var(--header-h));
      }

      /* The NAV scrolls, not the sidebar: the search field stays put at the
         top of the column rather than scrolling out of reach, and the
         scrollbar spans only the link list instead of running the full height
         of the column and pressing against the field. Hidden until hover,
         matching the .scroll-thin treatment the root layout defines for the
         marketing pages. */
      .docs-nav { scrollbar-width: thin; scrollbar-color: transparent transparent; transition: scrollbar-color 300ms; }
      .docs-nav:hover { scrollbar-color: var(--border-strong) transparent; }
      .docs-nav::-webkit-scrollbar { width: 6px; }
      .docs-nav::-webkit-scrollbar-track { background: transparent; }
      .docs-nav::-webkit-scrollbar-thumb { background: transparent; border-radius: 999px; }
      .docs-nav:hover::-webkit-scrollbar-thumb { background: var(--border-strong); }
      .docs-nav::-webkit-scrollbar-thumb:hover { background: var(--fg-subtle); }

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
      /* 859.98, not 860. Tailwind's max-[860px] variant compiles to
         "not all and (min-width: 860px)", which EXCLUDES exactly 860, while a
         hand-written max-width of 860px includes it. At that one width the
         grid had already collapsed to a single column and the menu button was
         already hidden, while these drawer rules had not taken over, so the
         page had no navigation at all. */
      @media (max-width: 859.98px) {
        .docs-sidebar {
          position: fixed;
          top: var(--header-h); left: 0; bottom: 0;
          width: 280px; max-width: 85vw;
          height: auto;
          z-index: 40;
          transform: translateX(-100%);
          transition: transform 220ms cubic-bezier(0.3, 0, 0.3, 1);
          box-shadow: 4px 0 24px oklch(0 0 0 / 0.25);
          /* The drawer DOES need a fill, unlike the desktop sidebar: it floats
             over the content it is covering, so it has to be opaque. Scoped to
             this breakpoint so the desktop column stays transparent over the
             page glow. */
          background: var(--bg-elev);
          border-right: 1px solid var(--border);
          padding-top: 1.5rem;
        }
        /* Off-screen is not enough: a translated element keeps every link
           in the tab order, so a keyboard user tabbing off the menu button
           walked 45 invisible controls before reaching the page. Hiding it
           removes them, and delaying the visibility change until the slide
           finishes keeps the close animation. */
        .docs-sidebar {
          visibility: hidden;
          transition: transform 220ms cubic-bezier(0.3, 0, 0.3, 1), visibility 0s linear 220ms;
        }
        body[data-docs-nav-open] .docs-sidebar {
          transform: translateX(0);
          visibility: visible;
          transition: transform 220ms cubic-bezier(0.3, 0, 0.3, 1), visibility 0s;
        }
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

        /* A wide table has to scroll inside its own box here, or it pushes the
           DOCUMENT past the viewport and drags the shared fixed header with
           it. A display of block is what makes overflow apply to a table at
           all, and it is scoped to this breakpoint because it also shrinks
           the table to fit its content, which on a wide screen leaves the row
           rules stopping short of the column edge. */
        .prose-docs table {
          display: block;
          max-width: 100%;
          overflow-x: auto;
        }
      }
    </style>

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
             instead, taking the search field with it. pr-4 keeps the
             scrollbar off the links, pl-1 keeps them off the left edge. -->
        <nav class="docs-nav flex-1 min-h-0 overflow-y-auto pr-3">
          ${NAV_SECTIONS.map((s) => html`
            <div class="font-mono text-[10px] font-semibold tracking-[0.15em] uppercase text-fg-subtle mt-6 mb-2 first:mt-0">${s.title}</div>
            ${s.items.map((it) => html`
              <a class="block py-1.5 px-3 my-px rounded-md text-fg-muted no-underline text-sm transition-colors duration-fast hover:text-fg hover:bg-bg-subtle" href=${it.href}>${it.label}</a>
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
