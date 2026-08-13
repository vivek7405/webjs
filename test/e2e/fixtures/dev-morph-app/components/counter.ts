import { WebComponent, html, prop } from '@webjsdev/core';

/**
 * A genuinely interactive component, so it ships (the `@click` and the reactive
 * property are interactivity signals) and `@webjsdev/core` loads, which is what
 * auto-enables the client router the in-place refresh runs through.
 *
 * Its count lives on the INSTANCE, so it survives only if the node itself was
 * never re-created. That is the assertion a page-edit refresh has to pass and a
 * reload cannot.
 */
class MorphCounter extends WebComponent({ count: prop(Number) }) {
  constructor() { super(); this.count = 0; }
  render() {
    return html`<button id="bump" @click=${() => { this.count++; }}>count ${this.count}</button>`;
  }
}
MorphCounter.register('morph-counter');
