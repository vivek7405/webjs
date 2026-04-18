import { WebComponent, html, css } from 'webjs';

/** Shadow DOM child — used in nested DSD e2e tests. */
export class ShadowInner extends WebComponent {
  static tag = 'shadow-inner';
  static shadow = true;
  static styles = css`
    :host { display: inline-flex; align-items: center; gap: 4px; }
    span { font: 600 14px/1 monospace; color: var(--accent, #e66); }
  `;
  render() {
    return html`<span data-testid="shadow-inner">shadow-inner OK</span>`;
  }
}
ShadowInner.register();
