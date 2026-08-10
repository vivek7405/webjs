// Stream updates: the <webjs-stream> element + renderStream() (#248). It is the
// element-level DOM-update grammar (Turbo Streams parity): a self-applying
// element that clones its <template> and runs ONE native DOM method (append /
// prepend / before / after / replace / update / remove) against a target id, then
// removes itself. See modules/stream/components/stream-demo.ts.
//
// How it differs from the neighbours:
//   - The client router swaps a whole page (a navigation to a different URL).
//   - A <webjs-frame> refreshes one URL-addressable region in place.
//   - <webjs-stream> is finer still: it mutates individual ELEMENTS by id (add a
//     row, remove a row, replace one node), with no region redraw and no
//     component re-render. Reach for it when a signal re-render or a frame swap
//     would be too coarse (a chat append, an optimistic row removal, a toast).
//
// Three delivery paths share this one applier: the client renderStream() below;
// a content-negotiated <form> response the router applies surgically (JS off
// degrades to a normal round-trip); and a live channel (a broadcast() / connectWS
// message applied with renderStream() from a WS handler, see the WebSockets card).
import { html } from '@webjsdev/core';
import type { Metadata } from '@webjsdev/core';
import { pageHeading, lede } from '#lib/utils/ui.ts';
import '#modules/stream/components/stream-demo.ts';

export const metadata: Metadata = { title: 'Stream updates (webjs-stream) | features' };

export default function StreamExample() {
  return html`
    ${pageHeading('Stream updates')}
    ${lede(html`
      <code class="font-mono">renderStream()</code> applies a
      <code class="font-mono">&lt;webjs-stream action="..." target="..."&gt;</code>
      payload: a surgical, element-level DOM update by id. Each button below mutates
      the live list in place, and the component never re-renders (contrast a frame,
      which swaps a whole region, and the client router, which swaps a whole page).
    `)}
    <stream-demo></stream-demo>
    <p class="text-muted-foreground text-sm mt-6">
      The same grammar arrives over HTTP (a content-negotiated
      <code class="font-mono">&lt;form&gt;</code> response the router applies
      surgically, degrading to a full round-trip with JS off) and over a live
      channel (a <code class="font-mono">broadcast()</code> message applied with
      <code class="font-mono">renderStream()</code> from a
      <code class="font-mono">connectWS</code> handler, see the WebSockets card).
    </p>
  `;
}
