// Metadata: how a page declares its <title>, description, and Open Graph tags.
// A static `metadata` export is read as-is. `generateMetadata(ctx)` takes
// precedence and can read the request (params, searchParams, url) to compute
// the tags, and may be async. Both run only on the server, so the tags are in
// the first paint (no JS, crawler-friendly). Whole-page metadata ROUTES
// (sitemap.ts, robots.ts, opengraph-image.ts, ...) live at the app root.
import { html } from '@webjsdev/core';
import type { Metadata } from '@webjsdev/core';
import { pageHeading, lede } from '#lib/utils/ui.ts';

// generateMetadata wins over a static `metadata` export when both exist. Here
// it derives the title from a ?topic= query param to show the dynamic form;
// with no param it falls back to a default. Change the URL to ?topic=webjs and
// view source: the <title> follows.
export function generateMetadata({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}): Metadata {
  const topic = (searchParams.topic || '').trim();
  return {
    title: topic ? topic + ' | metadata' : 'Metadata (generateMetadata) | features',
    description: 'How a webjs page declares title, description, and Open Graph tags.',
    openGraph: { title: topic || 'Metadata', type: 'article' },
  };
}

export default function MetadataExample({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const topic = (searchParams.topic || '').trim();
  return html`
    ${pageHeading('Metadata')}
    ${lede(html`
      <code>generateMetadata(ctx)</code> runs on the server and can read the
      request, so the <code>&lt;title&gt;</code> is computed per URL. View source
      to see the tag this page produced.
    `)}
    <p class="mb-4">
      Current title source:
      <code class="font-mono text-sm">${topic ? '?topic=' + topic : '(default, no ?topic=)'}</code>
    </p>
    <ul class="list-disc pl-5 mb-4">
      <li><a class="text-primary underline underline-offset-2" href="/features/metadata?topic=webjs">?topic=webjs</a></li>
      <li><a class="text-primary underline underline-offset-2" href="/features/metadata?topic=Routing">?topic=Routing</a></li>
      <li><a class="text-primary underline underline-offset-2" href="/features/metadata">clear the param</a></li>
    </ul>
    <p class="text-muted-foreground text-sm">
      Site-wide metadata (sitemap, robots, Open Graph images) lives in metadata
      ROUTES at the app root, e.g. <code class="font-mono">app/sitemap.ts</code>.
    </p>
  `;
}
