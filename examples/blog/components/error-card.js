import { WebComponent, html, css } from 'webjs';

/**
 * `<error-card message="…">` — surfaces a render error in a muted card.
 */
export class ErrorCard extends WebComponent {
  static tag = 'error-card';
  static properties = { message: { type: String } };
  static styles = css`
    :host {
      display: block;
      padding: var(--sp-5);
      border-radius: var(--rad-lg);
      background: var(--accent-tint);
      border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
      color: var(--fg);
      font: 15px/1.55 var(--font-sans);
    }
    h2 {
      margin: 0 0 var(--sp-2);
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--accent);
      letter-spacing: -0.01em;
    }
    p  { margin: 0 0 var(--sp-3); color: var(--fg-muted); }
    a {
      color: var(--accent);
      text-decoration: none;
      border-bottom: 1px solid currentColor;
    }
    code {
      font-family: var(--font-mono);
      font-size: 0.9em;
      color: var(--fg);
    }
  `;
  constructor() { super(); this.message = ''; }
  render() {
    return html`
      <h2>Something went wrong</h2>
      <p><code>${this.message}</code></p>
      <p><a href="/">← Home</a></p>
    `;
  }
}
ErrorCard.register(import.meta.url);
