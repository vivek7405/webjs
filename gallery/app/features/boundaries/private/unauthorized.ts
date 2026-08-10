// The nearest 401 boundary for a thrown unauthorized(). An unauthorized.ts
// default-exports a function returning a TemplateResult, rendered at status 401
// in place of the page that threw. Nearest wins: this one (inside private/) beats
// any unauthorized.ts higher up the tree. A real one usually links to sign-in.
import { html } from '@webjsdev/core';
import { pageHeading, lede } from '#lib/utils/ui.ts';

export default function Unauthorized() {
  return html`
    ${pageHeading('401 Unauthorized')}
    ${lede(html`
      You need to sign in to view this page. This is the nearest
      <code class="font-mono">unauthorized.ts</code> boundary, rendered because the
      page threw <code class="font-mono">unauthorized()</code>.
    `)}
    <p><a class="text-primary underline underline-offset-2" href="/features/boundaries">Back to boundaries</a></p>
  `;
}
