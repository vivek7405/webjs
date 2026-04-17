import { WebComponent, html } from 'webjs';

/** Light DOM child — used in nested DSD e2e tests. */
export class LightInner extends WebComponent {
  static tag = 'light-inner';
  static shadow = false;
  render() {
    return html`<span data-testid="light-inner">light-inner OK</span>`;
  }
}
LightInner.register(import.meta.url);
