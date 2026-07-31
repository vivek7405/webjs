import { html } from '@webjsdev/core';
import type { LayoutProps } from '@webjsdev/core';
import { backLink } from '#lib/utils/ui.ts';

// Shared layout for every gallery example app under /examples/*. It adds the same
// slim "back to the gallery" link the feature demos get, so an example is never a
// dead end. A non-root layout, so it never writes the document shell.
export default function ExamplesLayout({ children }: LayoutProps) {
  // An example app has no sidebar, so center it in a focused reading column
  // (the root centers the whole page; this narrows the example within it).
  return html`
    <div class="max-w-xl mx-auto">
      <div class="mb-6">${backLink('/', html`&larr; Gallery`)}</div>
      ${children}
    </div>
  `;
}
