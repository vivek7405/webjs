import { WebComponent, html } from '@webjsdev/core';
import { getThing } from '#actions/things.server.ts';

/**
 * A genuinely BARE async-render component: no reactive prop (a non-`state` one
 * is itself an interactivity signal), no event handler, no signal, no lifecycle
 * hook. The framework elides it, so its module never ships, nothing on the
 * client ever calls the action, and its seed sits in the page unconsumed.
 *
 * That is the shape that leaves a seed block in the LIVE document, because the
 * initial scan is lazy and fires on the first `takeSeed`, which never happens
 * here. It is what makes the drain on the next navigation matter.
 */
class ElidedCard extends WebComponent({}) {
  async render() {
    const t = await getThing(1);
    return html`<p class="lbl">${t.label}</p>`;
  }
}
ElidedCard.register('elided-card');
