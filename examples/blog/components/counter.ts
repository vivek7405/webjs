import { WebComponent, html, css } from 'webjs';

/**
 * `<my-counter>` — demo counter with the current design system.
 * Tabular monospace output; warm-accent focus ring.
 */
export class Counter extends WebComponent {
  static tag = 'my-counter';
  static properties = { count: { type: Number } };
  count = 0;
  connectedCallback() {
    super.connectedCallback();
    console.log('[webjs] counter connected — JS is alive');
  }
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      gap: var(--sp-2);
      padding: 6px;
      border-radius: 999px;
      background: var(--bg-elev);
      border: 1px solid var(--border);
      box-shadow: var(--shadow-sm);
    }
    button {
      width: 32px; height: 32px;
      border-radius: 999px;
      border: 0;
      background: transparent;
      color: var(--fg-muted);
      font: 600 16px/1 var(--font-sans);
      cursor: pointer;
      transition: background var(--t-fast), color var(--t-fast), transform var(--t-fast);
    }
    button:hover { background: var(--bg-subtle); color: var(--fg); }
    button:active { transform: scale(0.92); }
    button:focus-visible {
      outline: 0;
      box-shadow: 0 0 0 3px var(--accent-tint);
    }
    output {
      min-width: 3ch;
      padding: 0 var(--sp-2);
      text-align: center;
      font: 600 15px/1 var(--font-mono);
      font-variant-numeric: tabular-nums;
      color: var(--accent);
    }
  `;
  _bump(d: number) { this.count = (Number(this.count) || 0) + d; this.requestUpdate(); }
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
