// Caching: `export const revalidate = N` opts the page into the server HTML
// response cache, keyed by URL for N seconds. The rendered timestamp below only
// changes once per window: reload inside 10s and it is identical, reload after
// and it refreshes. SAFETY: only cache a page that is identical for every
// visitor (no cookies(), no session, no per-user data), since the key is the URL
// alone. For per-query reads use cache() + tags with revalidateTag; for assets
// use HTTP Cache-Control + ETag (conditional GET).
import { html } from '@webjsdev/core';
import type { Metadata } from '@webjsdev/core';
import { pageHeading, lede } from '#lib/utils/ui.ts';
import '#modules/caching/components/cache-buster.ts';

export const metadata: Metadata = { title: 'Caching (revalidate) | features' };

// Cache this page's SSR HTML for 10 seconds.
export const revalidate = 10;

export default function CachingExample() {
  // Runs at render time, then the whole response is cached for `revalidate`
  // seconds, so this value is frozen until the window elapses.
  const renderedAt = new Date().toLocaleTimeString('en-US', { hour12: false });
  return html`
    ${pageHeading('Caching')}
    ${lede(html`
      This page sets <code>export const revalidate = 10</code>, so its
      server-rendered HTML is cached per URL for ten seconds.
    `)}
    <p class="mb-4">
      Rendered at
      <code class="font-mono text-primary">${renderedAt}</code>.
      Reload within 10s and this is unchanged; after 10s it re-renders.
    </p>
    <p class="text-muted-foreground text-sm">
      Only for pages identical for every visitor. For per-user or per-query data
      use <code>cache()</code> with <code>tags</code> and
      <code>revalidateTag</code>, or a GET action's
      <code>export const cache</code>, which the
      <a class="text-primary underline underline-offset-2" href="/features/server-actions">server actions card</a>
      demonstrates end to end.
    </p>
    <p class="text-muted-foreground text-sm">
      A mutation evicts the cache on demand. Click below (it calls
      <code class="font-mono">revalidatePath('/features/caching')</code>), then refresh:
      the timestamp updates immediately, even inside the 10s window, because the
      cached HTML was dropped. Without clicking, the refresh serves the cached
      copy until the window elapses.
    </p>
    <cache-buster></cache-buster>
  `;
}
