import { WebComponent, html, prop } from '@webjsdev/core';
import { getThing } from '#actions/things.server.ts';

/**
 * A SHIPPING async component: the `@click` is an interactivity signal, so
 * elision keeps it and its module really does re-run `async render()` on
 * hydration. That re-run is exactly what the seed is there to answer without a
 * network round-trip, so an elided component would prove nothing here.
 */
class ThingCard extends WebComponent({ tid: prop(Number), bump: prop({ state: true }) }) {
  constructor() {
    super();
    this.tid = 1;
    this.bump = 0;
  }

  async render() {
    const t = await getThing(this.tid);
    return html`
      <p class="lbl">${t.label}</p>
      <button id="bump" @click=${() => { this.bump = this.bump + 1; }}>bumped ${this.bump}</button>
    `;
  }
}
ThingCard.register('thing-card');
