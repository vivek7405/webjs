import { WebComponent, html, css } from 'webjs';

/**
 * `<blog-shell>` — page chrome (header, constrained main, footer).
 *
 * Wraps arbitrary page content via named slots:
 *   - `<slot>` — default slot, rendered inside the constrained `<main>`
 *   - no other slots in v1 — keep it simple
 *
 * All styling lives in the shadow root; pages write semantic HTML with zero
 * inline styles and the shell paints it.
 */
export class BlogShell extends WebComponent {
  static tag = 'blog-shell';
  static styles = css`
    :host {
      display: block;
      font-family: system-ui, -apple-system, sans-serif;
      color: #1b1b1b;
      --muted: #888;
      --accent: #111;
      --rule: 1px solid #ddd;
    }
    header, footer {
      padding: 16px;
    }
    header {
      border-bottom: var(--rule);
      display: flex;
      gap: 16px;
      align-items: center;
    }
    header a {
      color: inherit;
      text-decoration: none;
    }
    header a[data-brand] {
      font-weight: 600;
    }
    main {
      display: block;
      padding: 16px;
      max-width: 720px;
      margin: 0 auto;
    }
    footer {
      border-top: var(--rule);
      text-align: center;
      color: var(--muted);
    }
    ::slotted(hr) {
      margin: 32px 0;
      border: 0;
      border-top: var(--rule);
    }
    ::slotted(h1) { margin-top: 0; }
  `;

  render() {
    return html`
      <header>
        <a href="/" data-brand>webjs blog</a>
        <a href="/api/posts">/api/posts</a>
        <a href="/api/hello">/api/hello</a>
      </header>
      <main>
        <slot></slot>
      </main>
      <footer>powered by webjs</footer>
    `;
  }
}
BlogShell.register();
