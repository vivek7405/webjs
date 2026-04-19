import { WebComponent, html } from '@webjskit/core';

/**
 * `<my-counter>` — demo counter with the current design system.
 * Tabular monospace output; warm-accent focus ring.
 */
export class Counter extends WebComponent {
  static properties = { count: { type: Number } };
  declare count: number;
  _bump(d: number) { this.count = (Number(this.count) || 0) + d; this.requestUpdate(); }
  render() {
    const v = Number(this.count) || 0;
    return html`
      <button
        class="w-8 h-8 rounded-full border-0 bg-transparent text-fg-muted font-sans font-semibold text-base leading-none cursor-pointer transition-all duration-150 hover:bg-bg-subtle hover:text-fg active:scale-[0.92] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-tint"
        aria-label="Decrement"
        @click=${() => this._bump(-1)}
      >−</button>
      <output class="min-w-[3ch] px-2 text-center font-mono font-semibold text-[15px] leading-none tabular-nums text-accent">${v}</output>
      <button
        class="w-8 h-8 rounded-full border-0 bg-transparent text-fg-muted font-sans font-semibold text-base leading-none cursor-pointer transition-all duration-150 hover:bg-bg-subtle hover:text-fg active:scale-[0.92] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-tint"
        aria-label="Increment"
        @click=${() => this._bump(1)}
      >+</button>
    `;
  }
}
Counter.register('my-counter');
