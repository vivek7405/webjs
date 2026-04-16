import { html } from 'webjs';
import 'webjs/client-router';
import '../components/theme-toggle.ts';

export default function RootLayout({ children }: { children: unknown }) {
  return html`
    <script>
      (function(){
        try {
          var t = localStorage.getItem('webjs_theme');
          document.documentElement.dataset.theme = (t === 'dark') ? 'dark' : 'light';
        } catch (_) {
          document.documentElement.dataset.theme = 'light';
        }
      })();
    </script>
    <style>
      :root {
        color-scheme: light dark;

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

        --fs-display: clamp(2.6rem, 1.6rem + 3vw, 4rem);
        --fs-h1:      clamp(2rem, 1.5rem + 1.6vw, 2.6rem);
        --fs-h2:      clamp(1.3rem, 1.1rem + 0.7vw, 1.6rem);
        --fs-lede:    clamp(1.05rem, 0.95rem + 0.3vw, 1.18rem);

        --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px; --sp-4: 16px;
        --sp-5: 24px; --sp-6: 32px; --sp-7: 48px; --sp-8: 72px;

        --rad-sm: 4px; --rad: 8px; --rad-lg: 12px; --rad-xl: 16px;

        --shadow-sm: 0 1px 2px oklch(0 0 0 / 0.05);
        --shadow:    0 4px 24px oklch(0 0 0 / 0.06), 0 1px 2px oklch(0 0 0 / 0.04);

        --t-fast: 140ms cubic-bezier(0.3, 0, 0.3, 1);
        --t:      220ms cubic-bezier(0.3, 0, 0.3, 1);
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

      *, *::before, *::after { box-sizing: border-box; }
      html, body { margin: 0; }
      body {
        background: var(--bg);
        color: var(--fg);
        font: 16px/1.65 var(--font-sans);
        -webkit-font-smoothing: antialiased;
        transition: background var(--t), color var(--t);
      }
      ::selection { background: var(--accent-tint); color: var(--fg); }

      .site-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        max-width: 960px;
        margin: 0 auto;
        padding: var(--sp-4) var(--sp-5);
      }
      .site-header .brand {
        display: flex;
        align-items: center;
        gap: 8px;
        text-decoration: none;
        font: 700 16px/1 var(--font-sans);
        color: var(--fg);
        letter-spacing: -0.01em;
      }
      .site-header .brand-mark {
        width: 22px; height: 22px;
        border-radius: 6px;
        background: linear-gradient(135deg, var(--accent), color-mix(in oklch, var(--accent) 55%, var(--fg)));
      }
      .site-header nav {
        display: flex;
        align-items: center;
        gap: var(--sp-4);
      }
      .site-header nav a {
        color: var(--fg-muted);
        text-decoration: none;
        font: 500 13px/1 var(--font-sans);
        transition: color var(--t-fast);
      }
      .site-header nav a:hover { color: var(--fg); }
    </style>

    <header class="site-header">
      <a class="brand" href="/">
        <span class="brand-mark"></span>
        webjs
      </a>
      <nav>
        <a href="http://localhost:4000/docs/getting-started" target="_blank">Docs</a>
        <a href="http://localhost:3456" target="_blank">Blog Demo</a>
        <a href="https://github.com/vivek7405/webjs" target="_blank">GitHub</a>
        <theme-toggle></theme-toggle>
      </nav>
    </header>

    ${children}
  `;
}
