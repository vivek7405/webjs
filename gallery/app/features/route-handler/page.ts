import { html } from '@webjsdev/core';
import type { Metadata } from '@webjsdev/core';
import { pageHeading, lede } from '#lib/utils/ui.ts';
import '#modules/route-handler/components/rich-data.ts';

export const metadata: Metadata = { title: 'Route handlers (route.ts) | features' };

export default function RouteHandlerExample() {
  return html`
    ${pageHeading('Route handlers')}
    ${lede(html`A <code>route.ts</code> is a server-only HTTP endpoint (named <code>GET</code>/<code>POST</code>/... exports), the WebJs equivalent of a Next route handler. It never ships to the client.`)}
    <p>GET <a class="text-primary underline underline-offset-2" href="/features/route-handler/data" data-no-router>/features/route-handler/data</a> returns rich JSON via <code class="font-mono">json()</code>. It carries <code class="font-mono">data-no-router</code> so the client router does not try to soft-navigate to it: a <code>route.ts</code> is not a page, so the browser loads its JSON directly.</p>
    <p class="text-muted-foreground mt-6 mb-2">A client component reading it with <code class="font-mono">richFetch</code>, so <code class="font-mono">at</code> comes back as a real <code class="font-mono">Date</code>:</p>
    <rich-data></rich-data>
  `;
}
