// A bare async-render component whose server data is deliberately SLOW. On its
// own, async render() BLOCKS the SSR first byte (the resolved value lands in the
// first paint with no fallback, which is what the async-render demo shows). That
// is the right default for fast data. Here the data is slow, so the page wraps
// it in a <webjs-suspense> boundary that flushes its fallback on the first byte
// and STREAMS this content in when the await settles (progressively on soft
// navigation too). Same component either way; the boundary is what changes the
// SSR behaviour from block to stream.
import { WebComponent, html } from '@webjsdev/core';
import { cardClass } from '#components/ui/card.ts';

export class SlowFact extends WebComponent {
  async render() {
    await new Promise((r) => setTimeout(r, 900));
    return html`<p class="${cardClass()} p-5 text-foreground">
      The answer, after a slow lookup, is <strong>42</strong>.
    </p>`;
  }
}
SlowFact.register('slow-fact');
