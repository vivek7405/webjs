// Demonstrates the WebComponent essentials: the declare-free reactive-prop
// factory, an instance signal for local state, a lifecycle hook, and a <slot>
// for content projection (works in light DOM, the default). This is the core
// component authoring shape. Styling is crafted Tailwind on the app's design
// tokens so it stays visually coherent with the rest of the app.
import { WebComponent, prop, signal, html } from '@webjsdev/core';
import { cardClass } from '#components/ui/card.ts';
import { buttonClass } from '#components/ui/button.ts';

export class CounterCard extends WebComponent({
  // A reactive prop rides an HTML attribute / SSR hydration. Declared ONLY here
  // (no `static properties`, no class-field `label = ''` which would clobber the
  // accessor). Set defaults in the constructor.
  label: prop(String),
}) {
  private count = signal(0); // instance signal: component-local state

  constructor() {
    super();
    this.label = this.label || 'Clicks';
  }

  render() {
    return html`
      <div class="${cardClass()} grid gap-4 p-5 max-w-[320px]">
        <slot></slot>
        <div class="flex items-baseline gap-2">
          <span class="text-[2.5rem] font-bold tabular-nums leading-none text-foreground">${this.count.get()}</span>
          <span class="text-sm text-muted-foreground">${this.label}</span>
        </div>
        <button @click=${() => this.count.set(this.count.get() + 1)}
          class="${buttonClass()} w-fit">Increment</button>
      </div>
    `;
  }
}
CounterCard.register('counter-card');
