import { WebComponent, html, css } from 'webjs';

/**
 * `<error-card message="…">` — inline error surface, uses the accent tint
 * for a muted alarm.
 */
export class ErrorCard extends WebComponent {
  static tag = 'error-card';
  static shadow = false;
  static properties = { message: { type: String } };
  message = '';
  static styles = css`
    :host {
      display: block;
      padding: var(--sp-5) var(--sp-6);
      border-radius: var(--rad-lg);
      background: color-mix(in oklch, var(--bg-elev) 85%, var(--accent));
      border: 1px solid color-mix(in oklch, var(--border-strong) 50%, var(--accent));
      color: var(--fg);
      box-shadow: var(--shadow);
    }
    .rubric {
      font: 600 11px/1 var(--font-mono);
      letter-spacing: 0.15em;
      text-transform: uppercase;
      color: var(--accent);
      margin-bottom: var(--sp-2);
    }
    h2 {
      font-family: var(--font-serif);
      font-size: 1.4rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin: 0 0 var(--sp-3);
    }
    p  { margin: 0 0 var(--sp-3); color: var(--fg-muted); }
    a {
      color: var(--accent);
      text-decoration: underline;
      text-underline-offset: 3px;
      text-decoration-color: color-mix(in oklch, var(--accent) 40%, transparent);
      transition: text-decoration-color var(--t-fast);
    }
    a:hover { text-decoration-color: currentColor; }
    code {
      font-family: var(--font-mono);
      font-size: 0.9em;
      color: var(--fg);
    }
  `;
  render() {
    return html`
      <div class="rubric">Error</div>
      <h2>Something went wrong</h2>
      <p><code>${this.message}</code></p>
      <p><a href="/">← Back home</a></p>
    `;
  }
}
ErrorCard.register(import.meta.url);
