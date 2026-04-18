import { WebComponent, html } from 'webjs';

/**
 * `<my-counter>` — demo counter with Tailwind utilities.
 * Light DOM so Tailwind classes apply directly.
 */
export class Counter extends WebComponent {
  static tag = 'my-counter';
  static shadow = false;
  static properties = { count: { type: Number } };
  count = 0;

  _bump(d: number) { this.count = (Number(this.count) || 0) + d; this.requestUpdate(); }

  render() {
    const v = Number(this.count) || 0;
    return html`
      <div class="inline-flex items-center gap-2 p-1.5 rounded-full bg-bg-elev border border-border shadow-sm">
        <button
          aria-label="Decrement"
          @click=${() => this._bump(-1)}
          class="w-8 h-8 rounded-full border-0 bg-transparent text-fg-muted font-semibold text-base cursor-pointer transition-all duration-150 hover:bg-bg-subtle hover:text-fg active:scale-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint"
        >−</button>
        <output class="min-w-[3ch] px-2 text-center font-mono font-semibold text-[15px] tabular-nums text-accent">${v}</output>
        <button
          aria-label="Increment"
          @click=${() => this._bump(1)}
          class="w-8 h-8 rounded-full border-0 bg-transparent text-fg-muted font-semibold text-base cursor-pointer transition-all duration-150 hover:bg-bg-subtle hover:text-fg active:scale-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint"
        >+</button>
      </div>
    `;
  }
}
Counter.register(import.meta.url);
