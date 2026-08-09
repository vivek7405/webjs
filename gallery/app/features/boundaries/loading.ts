// loading.ts auto-wraps the sibling page in a Suspense boundary: its default
// export is the fallback shown while an async page (or its streamed regions)
// resolves. The boundaries index is fast, so you rarely see this, but any async
// page in this subtree gets this skeleton for free during navigation.
import { html } from '@webjsdev/core';

export default function BoundariesLoading() {
  return html`
    <div class="animate-pulse">
      <div class="h-7 w-40 rounded bg-muted mb-4"></div>
      <div class="h-4 w-full rounded bg-muted mb-2"></div>
      <div class="h-4 w-3/4 rounded bg-muted"></div>
    </div>
  `;
}
