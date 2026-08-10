// Streaming server-action results (#489). A `'use server'` action that returns
// an async generator streams its chunks over the one RPC response; the call
// site consumes them with `for await`, rendering each as it arrives. This is
// the token-by-token shape (LLM output, a log tail, a DB cursor) over the
// normal action call site, back-pressured and cancelled on client disconnect.
// Contrast with a route.ts that hands back a raw HTTP ReadableStream: this rides
// the typed action mechanism, no hand-written fetch.
import { html } from '@webjsdev/core';
import type { Metadata } from '@webjsdev/core';
import { pageHeading, lede } from '#lib/utils/ui.ts';
import '#modules/streaming/components/token-stream.ts';

export const metadata: Metadata = { title: 'Streaming actions (for await) | features' };

export default function StreamingExample() {
  return html`
    ${pageHeading('Streaming actions')}
    ${lede(html`
      A <code class="font-mono">'use server'</code> action that returns an
      <code class="font-mono">async function*</code> streams each
      <code class="font-mono">yield</code> over the single RPC response. The call
      site consumes it with <code class="font-mono">for await (const chunk of await streamTokens())</code>,
      so tokens render as they arrive instead of waiting for the whole result.
    `)}
    <p class="text-muted-foreground mb-6 text-sm">
      Detection is on the return value (no config export), and a streamed result
      is never cached, ETagged, or seeded. The source generator is cancelled if
      the client navigates away mid-stream.
    </p>
    <token-stream></token-stream>
  `;
}
