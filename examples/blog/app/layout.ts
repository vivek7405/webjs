import { html } from 'webjs';
import 'webjs/client-router';
import '../components/blog-shell.ts';

/**
 * Root layout — globals + chrome.
 *
 * Three concerns, in document order:
 *  1. Inline `<script>` that syncs `<html data-theme>` from localStorage
 *     BEFORE any style applies (no FOUC on the occasional mismatch
 *     between saved theme and OS preference).
 *  2. `<style>` with design tokens (OKLCH palette, fluid type scale,
 *     spacing + motion). Tokens inherit into every shadow root.
 *  3. `<blog-shell>` holds page chrome and slots children.
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
        --color-fg: var(--fg);
        --color-fg-muted: var(--fg-muted);
        --color-fg-subtle: var(--fg-subtle);
        --color-bg: var(--bg);
        --color-bg-elev: var(--bg-elev);
        --color-bg-subtle: var(--bg-subtle);
        --color-border: var(--border);
        --color-border-strong: var(--border-strong);
        --color-accent: var(--accent);
        --color-accent-hover: var(--accent-hover);
        --color-accent-fg: var(--accent-fg);
        --color-accent-tint: var(--accent-tint);
        --font-sans: var(--font-sans);
        --font-serif: var(--font-serif);
        --font-mono: var(--font-mono);
      }
    </style>
    <style>
      :root {
        color-scheme: light dark;

        /* ---------- dark (applied when data-theme="dark") ---------- */
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

      /* ---------- light — applied for explicit toggle + OS-light unless overridden ---------- */
      :root[data-theme='light'],
      @media (prefers-color-scheme: light) { :root:not([data-theme='dark']) {} }

      :root[data-theme='light'],
      @media all {
        /* no-op wrapper so the following rule is actually picked up */
      }
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

      /* Global focus styles for form inputs — plain CSS, no Tailwind dependency */
      input:focus, textarea:focus, select:focus {
        outline: none;
        border-color: var(--accent);
        box-shadow: 0 0 0 3px var(--accent-tint);
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
    </style>
    <blog-shell>${children}</blog-shell>
  `;
}
