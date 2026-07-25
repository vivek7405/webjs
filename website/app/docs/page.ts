import { redirect } from '@webjsdev/core';

/**
 * /docs is the documentation hub URL, but there is no separate landing page
 * to show at it: the introduction IS the first doc page. So it redirects
 * rather than duplicating that content at a second address, which would
 * split ranking signals between two near-identical URLs.
 *
 * Kept as a permanent redirect because the destination is stable and the
 * bare /docs URL is what external links (and the shipped npm packages) point
 * at most often.
 */
export default function DocsIndex() {
  redirect('/docs/getting-started', 308);
}
