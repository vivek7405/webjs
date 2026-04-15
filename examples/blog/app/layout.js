import { html } from 'webjs';
import '../components/blog-shell.js';

/**
 * Root layout — globals + chrome.
 *
 * The `<style>` block lives in the light DOM, so its `:root` custom
 * properties inherit into every shadow root across the app. Components
 * reference tokens via `var(--fg)`, `var(--accent)`, etc.
 *
 * @param {{ children: unknown }} props
 */
export default function RootLayout({ children }) {
  return html`
    <style>
      :root {
        color-scheme: light dark;
        --fg:           #1c1917;
        --fg-muted:     #57534e;
        --fg-subtle:    #a8a29e;
        --bg:           #fafaf9;
        --bg-elev:      #ffffff;
        --bg-subtle:    #f5f5f4;
        --border:       rgba(0, 0, 0, 0.08);
        --border-strong:rgba(0, 0, 0, 0.16);
        --accent:       #dc2626;
        --accent-hover: #b91c1c;
        --accent-fg:    #ffffff;
        --accent-tint:  rgba(220, 38, 38, 0.08);
        --danger:       #dc2626;
        --success:      #16a34a;

        --font-sans:    -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        --font-serif:   'New York', Georgia, Cambria, 'Times New Roman', serif;
        --font-mono:    ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, monospace;

        --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px; --sp-4: 16px;
        --sp-5: 24px; --sp-6: 32px; --sp-7: 48px; --sp-8: 64px;

        --rad-sm: 4px; --rad: 8px; --rad-lg: 12px; --rad-xl: 16px;

        --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
        --shadow:    0 2px 8px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.03);
        --shadow-lg: 0 16px 48px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04);

        --t-fast: 120ms ease-out;
        --t:      180ms ease-out;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --fg:            #f5f5f4;
          --fg-muted:      #a8a29e;
          --fg-subtle:     #78716c;
          --bg:            #0c0a09;
          --bg-elev:       #1c1917;
          --bg-subtle:     #171414;
          --border:        rgba(255, 255, 255, 0.08);
          --border-strong: rgba(255, 255, 255, 0.16);
          --accent:        #f87171;
          --accent-hover:  #fca5a5;
          --accent-tint:   rgba(248, 113, 113, 0.12);
          --shadow-sm: 0 1px 2px rgba(0,0,0,0.4);
          --shadow:    0 4px 12px rgba(0,0,0,0.5);
          --shadow-lg: 0 16px 48px rgba(0,0,0,0.6);
        }
      }
      *, *::before, *::after { box-sizing: border-box; }
      html, body { margin: 0; }
      body {
        background: var(--bg);
        color: var(--fg);
        font: 16px/1.65 var(--font-sans);
        -webkit-font-smoothing: antialiased;
        text-rendering: optimizeLegibility;
      }
      ::selection { background: var(--accent-tint); color: var(--fg); }
    </style>
    <blog-shell>${children}</blog-shell>
  `;
}
