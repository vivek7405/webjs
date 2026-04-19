import { WebComponent, html } from '@webjskit/core';

/** Light DOM child — used in nested DSD e2e tests. */
export class LightInner extends WebComponent {

  render() {
    return html`<span data-testid="light-inner">light-inner OK</span>`;
  }
}
LightInner.register('light-inner');
