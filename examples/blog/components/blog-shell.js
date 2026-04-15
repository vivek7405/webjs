import { WebComponent, html, css } from 'webjs';

/**
 * `<blog-shell>` — editorial page chrome.
 * Sticky header with a subtle blur, generous content width, understated
 * footer. All styling inherits tokens from the :root block in layout.js.
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
      z-index: 10;
      display: flex;
      align-items: center;
      gap: var(--sp-5);
      padding: var(--sp-3) var(--sp-5);
      background: color-mix(in srgb, var(--bg) 82%, transparent);
      backdrop-filter: saturate(180%) blur(12px);
      -webkit-backdrop-filter: saturate(180%) blur(12px);
      border-bottom: 1px solid var(--border);
    }
    header a {
      color: var(--fg-muted);
      text-decoration: none;
      font-size: 14px;
      transition: color var(--t-fast);
    }
    header a:hover { color: var(--fg); }
    header a[data-brand] {
      color: var(--fg);
      font-size: 16px;
      font-weight: 700;
      letter-spacing: -0.01em;
      margin-right: auto;
    }
    header .dot {
      display: inline-block;
      width: 8px; height: 8px;
      margin-right: 6px;
      background: var(--accent);
      border-radius: 50%;
      vertical-align: middle;
      transform: translateY(-1px);
    }

    main {
      display: block;
      max-width: 720px;
      margin: 0 auto;
      padding: var(--sp-7) var(--sp-5);
    }

    footer {
      max-width: 720px;
      margin: 0 auto;
      padding: var(--sp-7) var(--sp-5) var(--sp-8);
      border-top: 1px solid var(--border);
      color: var(--fg-subtle);
      font-size: 13px;
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: var(--sp-3);
    }
    footer a { color: inherit; text-decoration: none; }
    footer a:hover { color: var(--fg-muted); }

    /* Global typography for content slotted in from pages */
    ::slotted(h1) {
      font-size: clamp(2rem, 1.3rem + 2vw, 2.6rem);
      line-height: 1.15;
      letter-spacing: -0.02em;
      font-weight: 800;
      margin: 0 0 var(--sp-4);
      color: var(--fg);
    }
    ::slotted(h2) {
      font-size: 1.35rem;
      line-height: 1.3;
      letter-spacing: -0.01em;
      font-weight: 700;
      margin: var(--sp-7) 0 var(--sp-3);
    }
    ::slotted(h3) {
      font-size: 1.1rem;
      font-weight: 700;
      margin: var(--sp-6) 0 var(--sp-2);
    }
    ::slotted(p)   { margin: 0 0 var(--sp-4); }
    ::slotted(ul), ::slotted(ol) { padding-left: var(--sp-5); margin: 0 0 var(--sp-4); }
    ::slotted(li)  { margin: var(--sp-2) 0; }
    ::slotted(a)   {
      color: var(--accent);
      text-decoration: none;
      border-bottom: 1px solid transparent;
      transition: border-color var(--t-fast);
    }
    ::slotted(a:hover) { border-bottom-color: var(--accent); }
    ::slotted(hr) {
      margin: var(--sp-7) 0;
      border: 0;
      border-top: 1px solid var(--border);
    }
    ::slotted(article) { margin: 0; }
    ::slotted(code) {
      font-family: var(--font-mono);
      font-size: 0.92em;
      padding: 2px 6px;
      border-radius: var(--rad-sm);
      background: var(--bg-subtle);
      border: 1px solid var(--border);
    }
    ::slotted(strong) { font-weight: 700; color: var(--fg); }
  `;

  render() {
    return html`
      <header>
        <a href="/" data-brand><span class="dot"></span>webjs blog</a>
        <a href="/">Home</a>
        <a href="/about">About</a>
        <a href="/dashboard">Dashboard</a>
      </header>
      <main>
        <slot></slot>
      </main>
      <footer>
        <span>© webjs · a framework demo</span>
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
