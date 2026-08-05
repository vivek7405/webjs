import { WebComponent, html, signal } from '@webjsdev/core';

// One interactive component, present on every page, purely so `@webjsdev/core`
// loads in the browser and the client router auto-enables (#620). Without it the
// fixture would navigate with plain full page loads and could not exercise the
// soft-nav half of #1047 at all.
const count = signal(0);

class Counter extends WebComponent({}) {
  render() {
    return html`<button id="bump" @click=${() => count.set(count.get() + 1)}>bumped ${count.get()}</button>`;
  }
}
Counter.register('counter-el');
