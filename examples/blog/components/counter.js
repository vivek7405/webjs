import { WebComponent, html, css } from 'webjs';

/**
 * `<my-counter count="3">` — demo counter with clean styling.
 * Showcases: shadow DOM styles, properties, events, state → re-render.
 */
export class Counter extends WebComponent {
  static tag = 'my-counter';
  static properties = { count: { type: Number } };
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      gap: var(--sp-2);
      padding: var(--sp-2);
      border-radius: var(--rad);
      background: var(--bg-elev);
      border: 1px solid var(--border);
      box-shadow: var(--shadow-sm);
    }
    button {
      width: 36px;
      height: 36px;
      border-radius: var(--rad);
      border: 0;
      background: transparent;
      color: var(--fg-muted);
      font: 600 18px/1 var(--font-sans);
      cursor: pointer;
      transition: background var(--t-fast), color var(--t-fast), transform var(--t-fast);
    }
    button:hover { background: var(--bg-subtle); color: var(--fg); }
    button:active { transform: scale(0.94); }
    button:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    output {
      min-width: 3ch;
      text-align: center;
      font-variant-numeric: tabular-nums;
      font-weight: 600;
      color: var(--fg);
    }
  `;

  constructor() { super(); this.count = 0; }
  _bump(delta) { this.count = (Number(this.count) || 0) + delta; this.requestUpdate(); }
  render() {
    const v = Number(this.count) || 0;
    return html`
      <button aria-label="Decrement" @click=${() => this._bump(-1)}>−</button>
      <output>${v}</output>
      <button aria-label="Increment" @click=${() => this._bump(1)}>+</button>
    `;
  }
}
Counter.register(import.meta.url);
