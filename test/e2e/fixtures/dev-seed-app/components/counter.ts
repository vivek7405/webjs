import { WebComponent, html, signal } from '@webjsdev/core';

/**
 * A plain interactive component that touches no action. It ships (the signal and
 * the `@click` are interactivity signals), so `@webjsdev/core` loads and the
 * client router auto-enables, which is what makes a link click a SOFT navigation.
 * Because it never calls an action, `takeSeed` never runs on this page, so the
 * lazy initial scan never fires and the page's seed block is left in the live
 * document. That is the precondition the drain exists for.
 */
const count = signal(0);

class Counter extends WebComponent({}) {
  render() {
    return html`<button id="bump" @click=${() => count.set(count.get() + 1)}>bumped ${count.get()}</button>`;
  }
}
Counter.register('counter-el');
