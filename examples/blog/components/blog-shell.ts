import { WebComponent, html, css } from 'webjs';
import './theme-toggle.ts';

/**
 * `<blog-shell>` — editorial 2026 chrome. Warm-lit dark-default aesthetic,
 * serif display type via ::slotted, monospace rubric labels, quiet
 * hairline dividers, no heavy boxes.
 */
export class BlogShell extends WebComponent {
  static tag = 'blog-shell';
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      color: var(--fg);
    }

    header {
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      gap: var(--sp-5);
      padding: var(--sp-3) clamp(var(--sp-4), 4vw, var(--sp-6));
      background: color-mix(in oklch, var(--bg) 75%, transparent);
      -webkit-backdrop-filter: saturate(180%) blur(18px);
      backdrop-filter: saturate(180%) blur(18px);
      border-bottom: 1px solid var(--border);
    }
    .brand {
      margin-right: auto;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--fg);
      text-decoration: none;
      font: 600 15px/1 var(--font-sans);
      letter-spacing: -0.01em;
    }
    .brand-mark {
      display: inline-block;
      width: 22px; height: 22px;
      border-radius: 6px;
      background: linear-gradient(135deg, var(--accent), color-mix(in oklch, var(--accent) 55%, var(--fg)));
      box-shadow: inset 0 0 0 1px oklch(1 0 0 / 0.15), 0 1px 4px var(--accent-tint);
    }
    .brand .slash { color: var(--fg-subtle); margin: 0 4px; font-weight: 400; }

    .nav {
      display: flex;
      gap: var(--sp-4);
      align-items: center;
    }
    .nav a {
      color: var(--fg-muted);
      text-decoration: none;
      font: 500 13px/1 var(--font-sans);
      letter-spacing: 0.005em;
      transition: color var(--t-fast);
    }
    .nav a:hover { color: var(--fg); }

    /* Reserve space for theme-toggle before it upgrades to prevent
       header height shift (CLS). Matches the button size in theme-toggle. */
    .nav theme-toggle {
      display: inline-flex;
      width: 36px;
      height: 36px;
    }

    main {
      display: block;
      max-width: 760px;
      margin: 0 auto;
      padding: var(--sp-8) clamp(var(--sp-4), 5vw, var(--sp-6)) var(--sp-7);
      min-height: 100vh;
    }

    footer {
      max-width: 760px;
      margin: 0 auto;
      padding: var(--sp-7) clamp(var(--sp-4), 5vw, var(--sp-6)) var(--sp-8);
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: var(--sp-3);
      color: var(--fg-subtle);
      font: 11px/1.4 var(--font-mono);
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    footer a { color: inherit; text-decoration: none; transition: color var(--t-fast); }
    footer a:hover { color: var(--fg-muted); }
    footer .dot { color: var(--accent); }

    /* ---------- global typography for slotted content ---------- */
    ::slotted(h1) {
      font-family: var(--font-serif);
      font-weight: 700;
      font-size: var(--fs-h1);
      line-height: 1.08;
      letter-spacing: -0.025em;
      margin: 0 0 var(--sp-4);
      color: var(--fg);
    }
    ::slotted(h2) {
      font-family: var(--font-serif);
      font-weight: 700;
      font-size: var(--fs-h2);
      line-height: 1.2;
      letter-spacing: -0.02em;
      margin: var(--sp-7) 0 var(--sp-3);
    }
    ::slotted(h3) {
      font-size: 1.05rem;
      font-weight: 600;
      letter-spacing: -0.005em;
      margin: var(--sp-5) 0 var(--sp-2);
    }
    ::slotted(p)  { margin: 0 0 var(--sp-4); }
    ::slotted(ul), ::slotted(ol) { padding-left: var(--sp-5); margin: 0 0 var(--sp-4); }
    ::slotted(li) { margin: var(--sp-2) 0; }
    ::slotted(a) {
      color: var(--accent);
      text-decoration: underline;
      text-decoration-color: transparent;
      text-decoration-thickness: 1.5px;
      text-underline-offset: 3px;
      transition: text-decoration-color var(--t-fast), color var(--t-fast);
    }
    ::slotted(a:hover) { text-decoration-color: currentColor; }
    ::slotted(hr) {
      margin: var(--sp-7) 0;
      border: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, var(--border-strong), transparent);
    }
    ::slotted(code) {
      font-family: var(--font-mono);
      font-size: 0.86em;
      padding: 2px 6px;
      border-radius: var(--rad-sm);
      background: var(--bg-subtle);
      border: 1px solid var(--border);
    }
    ::slotted(strong) { font-weight: 700; color: var(--fg); }
    ::slotted(em)     { font-style: italic; color: var(--fg-muted); }
    ::slotted(article) { margin: 0; }
  `;

  render() {
    return html`
      <header>
        <a class="brand" href="/">
          <span class="brand-mark"></span>
          <span>webjs</span>
          <span class="slash">/</span>
          <span>blog</span>
        </a>
        <nav class="nav">
          <a href="/">Posts</a>
          <a href="/about">About</a>
          <a href="/dashboard">Dashboard</a>
          <theme-toggle></theme-toggle>
        </nav>
      </header>
      <main>
        <slot></slot>
      </main>
      <footer>
        <span><span class="dot">●</span>&nbsp; webjs / demo</span>
        <span>
          <a href="/api/posts">api</a>
          &nbsp;·&nbsp;
          <a href="/__webjs/health">health</a>
        </span>
      </footer>
    `;
  }
}
BlogShell.register(import.meta.url);
