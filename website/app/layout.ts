import { html } from '@webjskit/core';
import '@webjskit/core/client-router';
import '../components/theme-toggle.ts';

/**
 * Root layout — Tailwind CSS browser runtime + @theme design tokens,
 * matching the blog example's architecture. Light DOM everywhere.
 *
 * Docs / Blog URLs are read from env so the same code works across
 * `webjs dev` and any deployment target. Override via DOCS_URL /
 * BLOG_URL at deploy time (e.g. in Railway's service env vars).
 */
// Guarded against `process` being undefined because this file also
// loads on the client during hydration.
const env = (globalThis as any).process?.env ?? {};
const DOCS_URL = env.DOCS_URL || 'http://localhost:4000';
const BLOG_URL = env.BLOG_URL || 'http://localhost:3456';

// Site-wide Open Graph + Twitter card metadata. `generateMetadata`
// receives the request context so we can derive an absolute og:image
// URL (OG scrapers require absolute http(s) URLs).
const TITLE = 'webjs — AI-first, web-components-first, no-build web framework';
const DESCRIPTION = 'Web components, server actions, streaming SSR — on web standards. Designed for AI agents to read, write, and ship.';

export function generateMetadata(ctx: { url: string }) {
  const origin = new URL(ctx.url).origin;
  const image = `${origin}/public/og.png`;
  return {
    title: TITLE,
    description: DESCRIPTION,
    openGraph: {
      type: 'website',
      title: TITLE,
      description: DESCRIPTION,
      url: origin,
      image,
      'image:width': '1200',
      'image:height': '630',
      'image:alt': 'webjs — AI-first, web-components-first, no-build web framework',
      'site_name': 'webjs',
    },
    twitter: {
      card: 'summary_large_image',
      title: TITLE,
      description: DESCRIPTION,
      image,
    },
  };
}

export default function RootLayout({ children }: { children: unknown }) {
  return html`
    <script>
      (function(){
        try {
          var t = localStorage.getItem('webjs_theme');
          if (t === 'light' || t === 'dark') {
            document.documentElement.dataset.theme = t;
          }
        } catch (_) {}
      })();
    </script>
    <link rel="stylesheet" href="/public/tailwind.css">
    <style>
      :root {
        color-scheme: light dark;

        /* Light theme (default) */
        --fg:            oklch(0.18 0.015 60);
        --fg-muted:      oklch(0.42 0.02 65);
        --fg-subtle:     oklch(0.62 0.015 70);
        --bg:            oklch(0.985 0.008 80);
        --bg-elev:       oklch(1 0 0);
        --bg-subtle:     oklch(0.96 0.008 80);
        --bg-sunken:     oklch(0.94 0.008 80);
        --border:        oklch(0.88 0.01 75 / 0.95);
        --border-strong: oklch(0.78 0.01 75 / 0.95);
        --accent:        oklch(0.58 0.15 55);
        --accent-hover:  oklch(0.5 0.15 55);
        --accent-fg:     oklch(1 0 0);
        --accent-tint:   oklch(0.58 0.15 55 / 0.08);

        --font-sans:  -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        --font-serif: ui-serif, 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, Cambria, serif;
        --font-mono:  ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, monospace;

        /* spacing + radii + shadows — consumed by the home page's <style> block */
        --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px; --sp-4: 16px;
        --sp-5: 24px; --sp-6: 32px; --sp-7: 48px; --sp-8: 72px;
        --rad-sm: 4px; --rad: 8px; --rad-lg: 12px; --rad-xl: 16px;
        --shadow-sm: 0 1px 2px oklch(0 0 0 / 0.05);
        --shadow:    0 4px 24px oklch(0 0 0 / 0.06), 0 1px 2px oklch(0 0 0 / 0.04);

        --fs-display: clamp(2.6rem, 1.6rem + 3vw, 4rem);
        --fs-h1:      clamp(2rem, 1.5rem + 1.6vw, 2.6rem);
        --fs-h2:      clamp(1.3rem, 1.1rem + 0.7vw, 1.6rem);
        --fs-lede:    clamp(1.05rem, 0.95rem + 0.3vw, 1.18rem);

        --t-fast: 140ms;
        --t:      220ms;
      }
      @media (prefers-color-scheme: dark) {
        :root:not([data-theme='light']) {
          --fg:            oklch(0.96 0.015 60);
          --fg-muted:      oklch(0.72 0.02 60);
          --fg-subtle:     oklch(0.55 0.02 60);
          --bg:            oklch(0.14 0.01 55);
          --bg-elev:       oklch(0.18 0.01 55);
          --bg-subtle:     oklch(0.16 0.01 55);
          --bg-sunken:     oklch(0.11 0.008 55);
          --border:        oklch(0.26 0.012 55 / 0.9);
          --border-strong: oklch(0.38 0.012 55 / 0.9);
          --accent:        oklch(0.78 0.14 55);
          --accent-hover:  oklch(0.85 0.14 55);
          --accent-fg:     oklch(0.15 0.01 55);
          --accent-tint:   oklch(0.78 0.14 55 / 0.12);
          --shadow-sm: 0 1px 2px oklch(0 0 0 / 0.3);
          --shadow:    0 4px 24px oklch(0 0 0 / 0.4);
        }
      }
      :root[data-theme='dark'] {
        --fg:            oklch(0.96 0.015 60);
        --fg-muted:      oklch(0.72 0.02 60);
        --fg-subtle:     oklch(0.55 0.02 60);
        --bg:            oklch(0.14 0.01 55);
        --bg-elev:       oklch(0.18 0.01 55);
        --bg-subtle:     oklch(0.16 0.01 55);
        --bg-sunken:     oklch(0.11 0.008 55);
        --border:        oklch(0.26 0.012 55 / 0.9);
        --border-strong: oklch(0.38 0.012 55 / 0.9);
        --accent:        oklch(0.78 0.14 55);
        --accent-hover:  oklch(0.85 0.14 55);
        --accent-fg:     oklch(0.15 0.01 55);
        --accent-tint:   oklch(0.78 0.14 55 / 0.12);
        --shadow-sm: 0 1px 2px oklch(0 0 0 / 0.3);
        --shadow:    0 4px 24px oklch(0 0 0 / 0.4);
      }

      html, body { margin: 0; }
      body {
        background: var(--bg);
        color: var(--fg);
        font: 16px/1.65 var(--font-sans);
        -webkit-font-smoothing: antialiased;
        transition: background var(--t) cubic-bezier(0.3, 0, 0.3, 1),
                    color var(--t) cubic-bezier(0.3, 0, 0.3, 1);
      }
      ::selection { background: var(--accent-tint); color: var(--fg); }
    </style>

    <header class="flex items-center justify-between max-w-[960px] mx-auto px-6 py-4">
      <a class="flex items-center gap-2 no-underline text-fg font-bold text-base leading-none tracking-tight" href="/">
        <span class="w-[22px] h-[22px] rounded-md bg-gradient-to-br from-accent to-[color-mix(in_oklch,var(--accent)_55%,var(--fg))]"></span>
        webjs
      </a>
      <nav class="flex items-center gap-4">
        <a class="text-fg-muted no-underline font-medium text-[13px] leading-none transition-colors duration-fast hover:text-fg" href=${DOCS_URL + '/docs/getting-started'} target="_blank">Docs</a>
        <a class="text-fg-muted no-underline font-medium text-[13px] leading-none transition-colors duration-fast hover:text-fg" href=${BLOG_URL} target="_blank">Blog Demo</a>
        <a class="text-fg-muted no-underline font-medium text-[13px] leading-none transition-colors duration-fast hover:text-fg" href="https://github.com/vivek7405/webjs" target="_blank">GitHub</a>
        <theme-toggle></theme-toggle>
      </nav>
    </header>

    ${children}
  `;
}
