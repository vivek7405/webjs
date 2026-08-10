import { WebComponent, html, prop } from '@webjsdev/core';
import { getThing } from '#actions/things.server.ts';

/**
 * The MISS shape, reached the way a real app reaches it. SSR runs the
 * constructor and `render()` but NEVER `connectedCallback`, so the id this
 * component asks for on the client is one the server render never used, and its
 * lookup key was never emitted. The call costs a real round-trip, and before
 * #1309 the page was indistinguishable from a healthy one without opening the
 * network tab.
 */
class UnseededCard extends WebComponent({ tid: prop(Number), bump: prop({ state: true }) }) {
  constructor() {
    super();
    this.tid = 1;
    this.bump = 0;
  }

  connectedCallback() {
    super.connectedCallback();
    // Browser-only, which is exactly why the seed cannot cover it.
    this.tid = this.tid + 1;
  }

  async render() {
    const t = await getThing(this.tid);
    return html`
      <p class="lbl">${t.label}</p>
      <button id="bump2" @click=${() => { this.bump = this.bump + 1; }}>bumped ${this.bump}</button>
    `;
  }
}
UnseededCard.register('unseeded-card');
