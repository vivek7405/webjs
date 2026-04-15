import { WebComponent, html, css } from 'webjs';

/**
 * `<error-card message="…">` — styled error container used by error boundaries.
 */
export class ErrorCard extends WebComponent {
  static tag = 'error-card';
  static properties = { message: { type: String } };
  static styles = css`
    :host {
      display: block;
      padding: 24px;
      border: 1px solid #b00;
      border-radius: 8px;
      background: #fff5f5;
      font-family: system-ui, sans-serif;
    }
    h1 { margin: 0 0 8px; }
    p.msg { color: #b00; margin: 0 0 12px; }
    a { color: inherit; }
  `;
  constructor() {
    super();
    this.message = '';
  }
  render() {
    return html`
      <h1>Something broke</h1>
      <p class="msg">${this.message}</p>
      <p><a href="/">← Home</a></p>
    `;
  }
}
ErrorCard.register();
