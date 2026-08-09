import { html, Suspense } from '@webjsdev/core';
import type { Metadata } from '@webjsdev/core';
import { pageHeading, lede } from '#lib/utils/ui.ts';
import '#modules/async-render/components/server-clock.ts';

export const metadata: Metadata = { title: 'Async render (server data in first paint) | features' };

// A slow server region. Suspense flushes the fallback on the first byte and
// streams the resolved content in when it settles, so a slow query does not
// block the whole page's first paint. Multiple boundaries stream concurrently.
async function slowRegion() {
  await new Promise((r) => setTimeout(r, 800));
  return html`<p class="text-foreground">Streamed in after the first byte.</p>`;
}

export default function AsyncRenderExample() {
  return html`
    ${pageHeading('Async render')}
    ${lede(html`A component's <code>async render()</code> awaits server data. SSR blocks, so the resolved value is in the first paint (no fallback, readable with JS off).`)}
    <server-clock></server-clock>
    <p class="text-muted-foreground mt-6 mb-2">For a SLOW region where blocking the first byte hurts, wrap it in <code class="font-mono">Suspense</code> to stream it instead:</p>
    ${Suspense({ fallback: html`<p class="text-muted-foreground">loading slow region…</p>`, children: slowRegion() })}
  `;
}
