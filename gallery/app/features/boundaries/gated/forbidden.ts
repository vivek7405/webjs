// The nearest 403 boundary for a thrown forbidden(). A forbidden.ts default-
// exports a function returning a TemplateResult, rendered at status 403 in place
// of the page that threw. Nearest wins: this one (inside gated/) beats any
// forbidden.ts higher up the tree. Keep the message actionable for an
// authenticated user who lacks permission.
import { html } from '@webjsdev/core';
import { pageHeading, lede } from '#lib/utils/ui.ts';

export default function Forbidden() {
  return html`
    ${pageHeading('403 Forbidden')}
    ${lede(html`
      You are signed in but do not have permission to view this page. This is the
      nearest <code class="font-mono">forbidden.ts</code> boundary, rendered
      because the page threw <code class="font-mono">forbidden()</code>.
    `)}
    <p><a class="text-primary underline underline-offset-2" href="/features/boundaries">Back to boundaries</a></p>
  `;
}
