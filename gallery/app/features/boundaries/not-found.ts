// not-found.ts is the nearest 404 boundary for this subtree. It renders both
// for a thrown notFound() in a page below here AND for an unmatched URL under
// /features/boundaries/ (try /features/boundaries/does-not-exist). Nearest wins,
// so this beats the root not-found for anything in this segment.
import { html } from '@webjsdev/core';
import { pageHeading, lede } from '#lib/utils/ui.ts';

export default function BoundariesNotFound() {
  return html`
    ${pageHeading('404: Not here')}
    ${lede(html`
      This segment's <code class="font-mono">not-found.ts</code> boundary rendered,
      because a page threw <code class="font-mono">notFound()</code> or the URL
      matched nothing under this segment.
    `)}
    <p><a class="text-primary underline underline-offset-2" href="/features/boundaries">Back to boundaries</a></p>
  `;
}
