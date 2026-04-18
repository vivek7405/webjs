import { html } from 'webjs';
import 'webjs/client-router';
import '../components/theme-toggle.ts';

/**
 * Root layout — globals + chrome.
 *
 * Three concerns, in document order:
 *  1. Inline `<script>` that syncs `<html data-theme>` from localStorage
 *     BEFORE any style applies (no FOUC).
 *  2. Tailwind browser CDN + `<style>` with design tokens (OKLCH palette,
 *     fluid type scale, spacing + motion). @theme maps CSS vars into the
 *     Tailwind palette so classes like `text-fg`, `bg-bg-elev` work.
 *  3. Shell markup rendered directly (no shadow DOM component). Sticky
 *     header, nav, main content area, footer — all Tailwind-styled.
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
    <script src="/public/tailwind-browser.js"></script>
    <style type="text/tailwindcss">
      @theme {
        --color-fg:            var(--fg);
        --color-fg-muted:      var(--fg-muted);
        --color-fg-subtle:     var(--fg-subtle);

        --color-bg:            var(--bg);
        --color-bg-elev:       var(--bg-elev);
        --color-bg-subtle:     var(--bg-subtle);
        --color-bg-sunken:     var(--bg-sunken);

        --color-border:        var(--border);
        --color-border-strong: var(--border-strong);

        --color-accent:        var(--accent);
        --color-accent-hover:  var(--accent-hover);
        --color-accent-fg:     var(--accent-fg);
        --color-accent-tint:   var(--accent-tint);

        --color-success:       var(--success);
        --color-danger:        var(--danger);

        --font-sans:  var(--font-sans);
        --font-serif: var(--font-serif);
        --font-mono:  var(--font-mono);
      }
    </style>
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
        --grain:         oklch(1 0 0 / 0.015);

        --font-sans:   -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        --font-serif:  ui-serif, 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, Cambria, serif;
        --font-mono:   ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, monospace;

        --fs-display: clamp(2.6rem, 1.6rem + 3.2vw, 4.25rem);
        --fs-h1:      clamp(2rem, 1.5rem + 1.6vw, 2.85rem);
        --fs-h2:      clamp(1.35rem, 1.15rem + 0.7vw, 1.7rem);
        --fs-lede:    clamp(1.05rem, 0.95rem + 0.3vw, 1.2rem);

        --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px; --sp-4: 16px;
        --sp-5: 24px; --sp-6: 32px; --sp-7: 48px; --sp-8: 72px;

        --rad-sm: 6px; --rad: 10px; --rad-lg: 14px; --rad-xl: 20px;

        --shadow-sm: 0 1px 2px oklch(0 0 0 / 0.25);
        --shadow:    0 4px 24px oklch(0 0 0 / 0.35), 0 1px 2px oklch(0 0 0 / 0.2);
        --shadow-lg: 0 24px 64px oklch(0 0 0 / 0.45), 0 4px 12px oklch(0 0 0 / 0.3);

        --t-fast: 140ms cubic-bezier(0.3, 0, 0.3, 1);
        --t:      220ms cubic-bezier(0.3, 0, 0.3, 1);
        --t-slow: 380ms cubic-bezier(0.3, 0, 0.3, 1);
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
        --grain:         oklch(0 0 0 / 0.02);
        --shadow-sm: 0 1px 2px oklch(0 0 0 / 0.05);
        --shadow:    0 4px 24px oklch(0 0 0 / 0.06), 0 1px 2px oklch(0 0 0 / 0.04);
        --shadow-lg: 0 24px 64px oklch(0 0 0 / 0.1), 0 4px 12px oklch(0 0 0 / 0.05);
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
          --grain:         oklch(0 0 0 / 0.02);
          --shadow-sm: 0 1px 2px oklch(0 0 0 / 0.05);
          --shadow:    0 4px 24px oklch(0 0 0 / 0.06), 0 1px 2px oklch(0 0 0 / 0.04);
          --shadow-lg: 0 24px 64px oklch(0 0 0 / 0.1), 0 4px 12px oklch(0 0 0 / 0.05);
        }
      }

      *, *::before, *::after { box-sizing: border-box; }
      html, body { margin: 0; }
      html { scroll-behavior: smooth; }
      body {
        background: var(--bg);
        color: var(--fg);
        font: 16px/1.65 var(--font-sans);
        -webkit-font-smoothing: antialiased;
        text-rendering: optimizeLegibility;
        font-feature-settings: 'ss01', 'cv02';
        transition: background var(--t-slow), color var(--t-slow);
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

      /* ---------- content typography (replaces ::slotted rules) ---------- */
      main h1 {
        font-family: var(--font-serif);
        font-weight: 700;
        font-size: var(--fs-h1);
        line-height: 1.08;
        letter-spacing: -0.025em;
        margin: 0 0 var(--sp-4);
        color: var(--fg);
      }
      main h2 {
        font-family: var(--font-serif);
        font-weight: 700;
        font-size: var(--fs-h2);
        line-height: 1.2;
        letter-spacing: -0.02em;
        margin: var(--sp-7) 0 var(--sp-3);
      }
      main h3 {
        font-size: 1.05rem;
        font-weight: 600;
        letter-spacing: -0.005em;
        margin: var(--sp-5) 0 var(--sp-2);
      }
      main p  { margin: 0 0 var(--sp-4); }
      main ul, main ol { padding-left: var(--sp-5); margin: 0 0 var(--sp-4); }
      main li { margin: var(--sp-2) 0; }
      main a {
        color: var(--accent);
        text-decoration: underline;
        text-decoration-color: transparent;
        text-decoration-thickness: 1.5px;
        text-underline-offset: 3px;
        transition: text-decoration-color var(--t-fast), color var(--t-fast);
      }
      main a:hover { text-decoration-color: currentColor; }
      main hr {
        margin: var(--sp-7) 0;
        border: 0;
        height: 1px;
        background: linear-gradient(90deg, transparent, var(--border-strong), transparent);
      }
      main code {
        font-family: var(--font-mono);
        font-size: 0.86em;
        padding: 2px 6px;
        border-radius: var(--rad-sm);
        background: var(--bg-subtle);
        border: 1px solid var(--border);
      }
      main strong { font-weight: 700; color: var(--fg); }
      main em     { font-style: italic; color: var(--fg-muted); }
      main article { margin: 0; }
    </style>

    <!-- Shell: header -->
    <header class="sticky top-0 z-20 flex items-center gap-6 px-[clamp(var(--sp-4),4vw,var(--sp-6))] py-3 border-b border-border bg-[color-mix(in_oklch,var(--bg)_75%,transparent)] backdrop-blur-[18px] backdrop-saturate-[180%]">
      <a href="/" class="mr-auto inline-flex items-center gap-2 no-underline text-fg font-semibold text-[15px] leading-none tracking-tight">
        <span class="inline-block w-[22px] h-[22px] rounded-[6px] bg-gradient-to-br from-accent to-[color-mix(in_oklch,var(--accent)_55%,var(--fg))] shadow-[inset_0_0_0_1px_oklch(1_0_0/0.15),0_1px_4px_var(--accent-tint)]"></span>
        <span>webjs</span>
        <span class="text-fg-subtle mx-1 font-normal">/</span>
        <span>blog</span>
      </a>
      <nav class="flex gap-4 items-center">
        <a href="/" class="text-fg-muted no-underline font-medium text-[13px] leading-none tracking-[0.005em] transition-colors duration-[140ms] hover:text-fg">Posts</a>
        <a href="/about" class="text-fg-muted no-underline font-medium text-[13px] leading-none tracking-[0.005em] transition-colors duration-[140ms] hover:text-fg">About</a>
        <a href="/dashboard" class="text-fg-muted no-underline font-medium text-[13px] leading-none tracking-[0.005em] transition-colors duration-[140ms] hover:text-fg">Dashboard</a>
        <theme-toggle></theme-toggle>
      </nav>
    </header>

    <!-- Shell: main content -->
    <main class="block max-w-[760px] mx-auto px-[clamp(var(--sp-4),5vw,var(--sp-6))] pt-[72px] pb-[48px] min-h-screen">
      ${children}
    </main>

    <!-- Shell: footer -->
    <footer class="max-w-[760px] mx-auto px-[clamp(var(--sp-4),5vw,var(--sp-6))] pt-[48px] pb-[72px] border-t border-border flex justify-between flex-wrap gap-3 text-fg-subtle font-mono text-[11px] leading-[1.4] tracking-[0.12em] uppercase">
      <span><span class="text-accent">&#9679;</span>&nbsp; webjs / demo</span>
      <span>
        <a href="/api/posts" class="text-inherit no-underline transition-colors duration-[140ms] hover:text-fg-muted">api</a>
        &nbsp;&middot;&nbsp;
        <a href="/__webjs/health" class="text-inherit no-underline transition-colors duration-[140ms] hover:text-fg-muted">health</a>
      </span>
    </footer>
  `;
}
