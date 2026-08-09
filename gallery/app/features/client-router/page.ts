// Client router: automatic. It auto-enables the moment @webjsdev/core loads in
// the browser (the bundle every component pulls, so any page with a component
// gets it for free). There is nothing to import. An <a href> to another page
// does a soft navigation: the framework fetches only the divergent fragment
// (via the X-Webjs-Have header), swaps it in place, and restores scroll on
// back/forward. Links prefetch on hover by default. It degrades perfectly: with
// JS off, every link is a normal full-page navigation.
import { html } from '@webjsdev/core';
import type { Metadata } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';
import { pageHeading, lede } from '#lib/utils/ui.ts';
import '#modules/client-router/components/router-controls.ts';

export const metadata: Metadata = { title: 'Client router (soft nav) | features' };

export default function ClientRouterExample() {
  return html`
    ${pageHeading('Client router')}
    ${lede(html`
      Navigate to the second page and back. With JS on it is a soft swap (no full
      reload, scroll restored); open the network tab to see only a fragment
      fetched, prefetched on hover. With JS off the same links do full-page
      navigations. Nothing was imported to get this.
    `)}
    <div class="flex gap-3 items-center">
      <a href="/features/client-router/second" class="${buttonClass()} no-underline">Go to page two</a>
      <a href="/" class="text-muted-foreground no-underline font-medium text-sm hover:text-foreground transition-colors">Home</a>
    </div>
    <p class="text-muted-foreground text-sm mt-6">Or drive it from JS with <code class="font-mono">navigate()</code> / <code class="font-mono">revalidate()</code>:</p>
    <router-controls></router-controls>
    <p class="text-muted-foreground text-sm mt-6">
      Opt out app-wide with <code class="font-mono">{ "webjs": { "clientRouter": false } }</code>,
      or per-link with <code class="font-mono">data-no-router</code> (use it for
      auth flows like <code class="font-mono">/logout</code> that must reset
      in-memory state).
    </p>
  `;
}
