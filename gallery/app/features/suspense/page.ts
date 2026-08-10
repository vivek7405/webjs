// Component-level <webjs-suspense> streaming (#471). Page-level Suspense (the
// async-render demo) streams a region of the PAGE; <webjs-suspense> is the
// element that wraps one or more COMPONENTS, flushes its .fallback on the first
// byte, and streams the resolved content in. It is the only way to show a
// first-paint fallback for a SLOW component, and the deliberate choice when
// blocking the first byte on that component's data would hurt. Plain async
// render() blocks SSR so its data is in the first paint with NO fallback (right
// for fast data); reach for <webjs-suspense> when the data is genuinely slow.
import { html } from '@webjsdev/core';
import type { Metadata } from '@webjsdev/core';
import { pageHeading, lede } from '#lib/utils/ui.ts';
import '#modules/suspense/components/slow-fact.ts';

export const metadata: Metadata = { title: 'Suspense boundary (<webjs-suspense>) | features' };

export default function SuspenseExample() {
  return html`
    ${pageHeading('Suspense boundary')}
    ${lede(html`
      The slow component below is wrapped in
      <code class="font-mono">&lt;webjs-suspense&gt;</code>. Its fallback shows on
      the first byte and the resolved content streams in when the slow await
      settles. Reload to see the fallback, then the fact stream in.
    `)}
    <p class="text-muted-foreground mb-6 text-sm">
      <code class="font-mono">.fallback</code> is a property hole (unquoted, per
      invariant 4). Contrast with the
      <a href="/features/async-render" class="text-primary no-underline font-medium">async render</a>
      demo, where SSR blocks so the data is in the first paint with no fallback.
    </p>
    <webjs-suspense .fallback=${html`<p class="rounded-2xl border border-dashed border-border p-5 text-muted-foreground">loading the fact…</p>`}>
      <slow-fact></slow-fact>
    </webjs-suspense>
  `;
}
