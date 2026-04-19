import { WebComponent, html, css } from '@webjs/core';
import './shadow-inner.ts';
import './light-inner.ts';

/**
 * Shadow DOM parent that nests both shadow and light DOM children.
 * Used in nested DSD e2e tests.
 */
export class ShadowParent extends WebComponent {
  static shadow = true;
  static properties = { child: { type: String } };
  child: string = 'shadow';
  static styles = css`
    :host { display: block; padding: 8px; border: 1px solid #ccc; margin: 4px 0; }
  `;
  render() {
    return this.child === 'light'
      ? html`<div data-testid="shadow-parent"><light-inner></light-inner></div>`
      : html`<div data-testid="shadow-parent"><shadow-inner></shadow-inner></div>`;
  }
}
ShadowParent.register('shadow-parent');
