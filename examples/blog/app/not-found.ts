import { html } from '@webjskit/core';
import { displayH1 } from './_utils/ui.ts';

export default function NotFound() {
  return html`
    ${displayH1('404')}
    <p class="text-lede text-fg-muted m-0 mb-4">Page not found.</p>
    <p class="m-0"><a href="/" class="text-accent underline underline-offset-[3px] decoration-transparent hover:decoration-current transition-colors duration-fast">← Home</a></p>
  `;
}
