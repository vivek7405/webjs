// app/global-not-found.ts is the ROOT-ONLY 404 for a URL that matches nothing
// anywhere, used when no nested not-found.ts applies. Unlike global-error.ts it
// renders only a BODY fragment: the framework wraps it in the document shell
// (head, importmap, boot script), so the client router and components work
// here. Use a nested <segment>/not-found.ts for a section-specific 404 (nearest
// wins); this file is the app-wide fallback.
import { html } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';

export default function GlobalNotFound() {
  return html`
    <main class="mx-auto max-w-[40rem] px-6 py-24 text-center">
      <p class="text-sm font-semibold uppercase tracking-wide text-primary">404</p>
      <h1 class="mt-2 text-3xl font-bold">Page not found</h1>
      <p class="mt-4 text-muted-foreground">We could not find the page you were looking for.</p>
      <a href="/" class="${buttonClass()} mt-8 inline-block no-underline">Back to home</a>
    </main>
  `;
}
