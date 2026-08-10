// Sessions: a per-segment middleware.ts applies session() (a signed cookie by
// default; store-backed for larger sessions), and a route.ts reads/writes it
// with getSession(req). Session state is per-user, so it lives on the server
// boundary (a route/middleware), never in a page/component that ships to the
// browser. See modules/sessions/session-config.server.ts.
import { html } from '@webjsdev/core';
import type { Metadata } from '@webjsdev/core';
import { pageHeading, lede } from '#lib/utils/ui.ts';

export const metadata: Metadata = { title: 'Sessions (cookie + store) | features' };

export default function SessionsExample() {
  return html`
    ${pageHeading('Sessions')}
    ${lede(html`A per-segment <code>middleware.ts</code> applies <code>session()</code>; a <code>route.ts</code> reads it with <code>getSession(req)</code>.`)}
    <p>GET <a class="text-primary underline underline-offset-2" href="/features/sessions/count" data-no-router>/features/sessions/count</a> increments a per-visitor counter kept in the signed session cookie. Reload it and the count climbs; open it in a private window and it starts over. (<code class="font-mono">data-no-router</code> opts the link out of the client router, since a <code>route.ts</code> returns JSON, not a page.)</p>
    <p class="text-muted-foreground text-sm">Swap the storage from <code class="font-mono">cookieSession()</code> to <code class="font-mono">storeSession()</code> to hold larger sessions in the active store (Redis in production).</p>
  `;
}
