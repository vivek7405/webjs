import { WebComponent, html, css } from 'webjs';

/**
 * `<my-counter count="3">` — stateful counter in shadow DOM.
 *
 * Reads state from the `count` property so SSR and CSR agree: the server
 * reads the attribute → property, renders, ships DSD; the browser upgrades
 * with the same property, rendering the same numeric value, then increments
 * on click.
 */
export class Counter extends WebComponent {
  static tag = 'my-counter';
  static properties = { count: { type: Number } };
  static styles = css`
    :host { display: inline-flex; gap: 8px; align-items: center; font: inherit; }
    button {
      font: inherit; cursor: pointer;
      padding: 4px 12px; border: 1px solid #888; border-radius: 6px;
      background: #fff;
    }
    button:hover { background: #f3f3f3; }
    output { font-variant-numeric: tabular-nums; min-width: 2ch; text-align: center; }
  `;

  constructor() {
    super();
    /** @type {number} */
    this.count = 0;
  }

  /** @param {number} delta */
  _bump(delta) {
    this.count = (Number(this.count) || 0) + delta;
    this.requestUpdate();
  }

  render() {
    const v = Number(this.count) || 0;
    return html`
      <button @click=${() => this._bump(-1)}>−</button>
      <output>${v}</output>
      <button @click=${() => this._bump(1)}>+</button>
    `;
  }
}
Counter.register();
