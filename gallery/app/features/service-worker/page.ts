// Service worker: opt-in progressive enhancement. webjs does NOT register one by
// default (an active SW caches aggressively and would confuse dev). You opt in
// by adding public/sw.js and registering it from a component's connectedCallback
// (browser-only). This page is a guided reference, not an active registration,
// so the scaffold stays predictable until you deliberately turn it on. See
// agent-docs/service-worker.md for the full recipe.
import { html } from '@webjsdev/core';
import type { Metadata } from '@webjsdev/core';
import { pageHeading, lede } from '#lib/utils/ui.ts';

export const metadata: Metadata = { title: 'Service worker (opt-in) | features' };

export default function ServiceWorkerExample() {
  return html`
    ${pageHeading('Service worker')}
    ${lede(html`
      Opt-in offline/caching enhancement. Nothing is registered until you add
      <code class="font-mono">public/sw.js</code> and register it from a
      browser-only lifecycle hook.
    `)}
    <p class="mb-2 text-sm font-medium">Register inside a component (never in a page or layout):</p>
    <pre class="bg-card border border-border rounded-xl p-4 overflow-x-auto text-sm font-mono mb-4"><code>connectedCallback() {
  super.connectedCallback();
  if ('serviceWorker' in navigator) {
    // The framework serves your public/sw.js at the site root /sw.js (with a
    // Service-Worker-Allowed: / header), so the worker's scope is the whole origin.
    navigator.serviceWorker.register('/sw.js');
  }
}</code></pre>
    <p class="text-muted-foreground text-sm">
      Registration lives in a component because it is browser-only work.
      A page or layout never hydrates, so it is the wrong home for it. Full
      recipe: <code class="font-mono">agent-docs/service-worker.md</code>.
    </p>
  `;
}
