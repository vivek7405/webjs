import { html } from '@webjskit/core';
import '@webjskit/core/client-router';
import '../components/theme-toggle.ts';

const navLink = (href: string, label: string) => html`
  <a href=${href} class="text-fg-muted no-underline font-medium text-[13px] leading-none tracking-[0.005em] transition-colors duration-fast hover:text-fg">${label}</a>
`;

const footerLink = (href: string, label: string) => html`
  <a href=${href} class="text-inherit no-underline transition-colors duration-fast hover:text-fg-muted">${label}</a>
`;

const TITLE = 'webjs blog — live demo';
const DESCRIPTION = 'A live, full-stack webjs example: posts, comments, auth, and WebSocket chat.';

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
      'image:alt': 'webjs blog — live demo',
      'site_name': 'webjs · blog',
    },
    twitter: {
      card: 'summary_large_image',
      title: TITLE,
      description: DESCRIPTION,
      image,
    },
  };
}

/**
 * Root layout — globals + chrome.
 *
 * Three concerns, in document order:
 *  1. Inline `<script>` that syncs `<html data-theme>` from localStorage
 *     BEFORE any style applies (no FOUC).
 *  2. Generated Tailwind stylesheet (`public/tailwind.css`) — compiled
 *     once in prod via `npm run start` or on-file-change in dev via
 *     `npm run dev`. The input lives in `public/input.css` and includes
 *     the `@theme` block that maps our design tokens into Tailwind's
 *     palette (so classes like `text-fg`, `bg-bg-elev`, `text-display`,
 *     `font-serif`, `duration-fast` resolve).
 *  3. Shell markup styled with Tailwind utility classes.
 *
 * Non-Tailwind CSS is kept to the minimum that utility classes can't
 * express: `:root` design tokens (consumed by `@theme`), body defaults
 * that can't live on a classable element, and selection/scrollbar
 * pseudo-elements.
 */
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

        /* ---------- dark (default) ---------- */
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
        --accent-tint:   oklch(0.78 0.14 55 / 0.14);
        --danger:        oklch(0.7 0.19 25);
        --success:       oklch(0.72 0.15 145);

        --font-sans:   -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        --font-serif:  ui-serif, 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, Cambria, serif;
        --font-mono:   ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, monospace;
      }

      /* ---------- light — explicit toggle ---------- */
      :root[data-theme='light'] {
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
        --accent-tint:   oklch(0.58 0.15 55 / 0.1);
      }

      /* ---------- light — OS preference ---------- */
      @media (prefers-color-scheme: light) {
        :root:not([data-theme='dark']) {
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
          --accent-tint:   oklch(0.58 0.15 55 / 0.1);
        }
      }

      /* Body defaults — the <body> tag is emitted by the framework and can't
         be reached by utility classes. A tiny decorative overlay, scrollbar
         colours, and selection tint also live here (no utility equivalent). */
      html, body { margin: 0; }
      html { scroll-behavior: smooth; }
      body {
        background: var(--bg);
        color: var(--fg);
        font: 16px/1.65 var(--font-sans);
        -webkit-font-smoothing: antialiased;
        text-rendering: optimizeLegibility;
        font-feature-settings: 'ss01', 'cv02';
        transition: background var(--duration-slow) cubic-bezier(0.3, 0, 0.3, 1),
                    color var(--duration-slow) cubic-bezier(0.3, 0, 0.3, 1);
      }
      body::before {
        content: '';
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: -1;
        background:
          radial-gradient(ellipse 80% 60% at 50% -10%, var(--accent-tint), transparent 60%),
          radial-gradient(ellipse 50% 40% at 100% 100%, var(--accent-tint), transparent 70%);
        opacity: 0.7;
      }
      ::selection { background: var(--accent-tint); color: var(--fg); }
      ::-webkit-scrollbar { width: 10px; height: 10px; }
      ::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 999px; }
      ::-webkit-scrollbar-track { background: transparent; }
    </style>

    <header class="sticky top-0 z-20 flex items-center gap-6 px-4 sm:px-6 py-3 border-b border-border bg-[color-mix(in_oklch,var(--bg)_75%,transparent)] backdrop-blur-[18px] backdrop-saturate-[180%]">
      <a href="/" class="mr-auto inline-flex items-center gap-2 no-underline text-fg font-semibold text-[15px] leading-none tracking-tight">
        <span class="inline-block w-[22px] h-[22px] rounded-md bg-gradient-to-br from-accent to-[color-mix(in_oklch,var(--accent)_55%,var(--fg))] shadow-[inset_0_0_0_1px_oklch(1_0_0/0.15),0_1px_4px_var(--accent-tint)]"></span>
        <span>webjs</span>
        <span class="text-fg-subtle mx-1 font-normal">/</span>
        <span>blog</span>
      </a>
      <nav class="flex gap-4 items-center">
        ${navLink('/', 'Posts')}
        ${navLink('/about', 'About')}
        ${navLink('/dashboard', 'Dashboard')}
        <a href="https://github.com/vivek7405/webjs/tree/main/examples/blog" target="_blank" rel="noopener" class="text-fg-muted no-underline font-medium text-[13px] leading-none tracking-[0.005em] transition-colors duration-fast hover:text-fg">GitHub</a>
        <theme-toggle></theme-toggle>
      </nav>
    </header>

    <div class="max-w-[760px] mx-auto px-4 sm:px-6 pt-4 text-[11px] leading-snug text-fg-subtle font-mono tracking-wide">
      Demo app - data will be wiped between redeploys.
    </div>

    <main class="block max-w-[760px] mx-auto px-4 sm:px-6 pt-4 pb-12 min-h-screen">
      ${children}
    </main>

    <footer class="max-w-[760px] mx-auto px-4 sm:px-6 pt-12 pb-[72px] border-t border-border flex justify-between flex-wrap gap-3 text-fg-subtle font-mono text-[11px] leading-[1.4] tracking-[0.12em] uppercase">
      <span><span class="text-accent">&#9679;</span>&nbsp; webjs / demo</span>
      <span>
        ${footerLink('/api/posts', 'api')}
        &nbsp;&middot;&nbsp;
        ${footerLink('/__webjs/health', 'health')}
      </span>
    </footer>
  `;
}
