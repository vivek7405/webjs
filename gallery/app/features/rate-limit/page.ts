// Rate limiting: rateLimit() from '@webjsdev/server' is a middleware. It lives in
// a middleware.ts scoped to the endpoint it protects (here app/features/
// rate-limit/ping/middleware.ts, so it limits /features/rate-limit/ping WITHOUT
// touching this page). It is backed by the pluggable cache store, in-memory by
// default; point the store at Redis to share the window across instances.
import { html } from '@webjsdev/core';
import type { Metadata } from '@webjsdev/core';
import { pageHeading, lede } from '#lib/utils/ui.ts';
import '#modules/rate-limit/components/rate-probe.ts';

export const metadata: Metadata = { title: 'Rate limiting (rateLimit middleware) | features' };

export default function RateLimitExample() {
  return html`
    ${pageHeading('Rate limiting')}
    ${lede(html`
      The <code class="font-mono">/ping</code> endpoint is limited to five
      requests per ten seconds by a scoped <code class="font-mono">middleware.ts</code>.
      Ping past the limit to get a <code class="font-mono">429</code> with a
      <code class="font-mono">Retry-After</code> header.
    `)}
    <rate-probe></rate-probe>
    <p class="text-muted-foreground text-sm">
      With JavaScript off, hit
      <a class="text-primary underline underline-offset-2" href="/features/rate-limit/ping" data-no-router>/features/rate-limit/ping</a>
      directly (refresh past five times in ten seconds).
    </p>
  `;
}
