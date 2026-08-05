// Caching: `export const revalidate = N` opts the page into the server HTML
// response cache, keyed by the request origin plus the URL for N seconds. The
// rendered timestamp below only changes once per window: reload inside 10s and
// it is identical, reload after and it refreshes. SAFETY: only cache a page that
// is identical for every visitor (no cookies(), no session, no per-user data),
// since the key carries no per-user component. For per-query reads use cache() + tags with revalidateTag; for a
// public/ asset use asset(), demonstrated at the bottom of this page.
import { html, asset } from '@webjsdev/core';
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
      server-rendered HTML is cached per origin and URL for ten seconds.
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

    <h2 class="mt-8 mb-2 font-semibold">Caching a public/ asset</h2>
    <p class="mb-2">
      A file in <code>public/</code> sits at a stable url, so after a deploy a
      browser or CDN can keep serving the PREVIOUS bytes until its cache
      expires. Wrap the url in <code>asset()</code> and it gains a content hash,
      which the framework then serves <code>immutable</code> for a year:
    </p>
    <pre class="mb-2 overflow-x-auto rounded-md bg-muted p-3 text-sm"><code>&lt;link rel="stylesheet" href=\${asset('/public/tailwind.css')}&gt;</code></pre>
    <p class="mb-2">
      This app's stylesheet resolves to
      <code class="font-mono text-primary">${asset('/public/tailwind.css')}</code>
      (the hash appears in production only, so dev output stays byte-identical).
      New bytes mean a new url, so a stale copy can never be served.
    </p>
    <p class="text-muted-foreground text-sm">
      Mark the thing that FETCHES, not a hint. Wrapping a
      <code>&lt;link rel="preload"&gt;</code> whose asset is really fetched by an
      <code>@font-face url()</code> in your CSS would version the hint but not
      the request, so the preload could never match and the file would download
      twice.
    </p>
  `;
}
