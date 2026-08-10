// error.ts is the error boundary for this segment's subtree. A render-time
// exception in a sibling or deeper page (see crash/page.ts) is caught here and
// rendered scoped to this boundary, so outer layouts stay alive. The default
// export receives { error, ...ctx }; in production only error.message is sent.
import { html } from '@webjsdev/core';
import { pageHeading, lede } from '#lib/utils/ui.ts';

export default function BoundariesError({ error }: { error: Error }) {
  return html`
    ${pageHeading('Something went wrong')}
    ${lede(html`
      This segment's <code class="font-mono">error.ts</code> boundary caught a
      render error: <code class="font-mono">${error?.message ?? 'unknown'}</code>.
    `)}
    <p><a class="text-primary underline underline-offset-2" href="/features/boundaries">Back to boundaries</a></p>
  `;
}
