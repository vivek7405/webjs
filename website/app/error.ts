import { html } from '@webjsdev/core';

/**
 * Root error boundary. Any uncaught error thrown while rendering a page
 * (or layout, or async hole) that is NOT a notFound() / redirect()
 * sentinel lands here. Receives the thrown value as ctx.error.
 *
 * Keep this file's import graph minimal: it MUST stay importable when
 * the rest of the app is broken, otherwise the framework falls through
 * to its built-in generic 500 ("Server error / Something went wrong").
 * Only @webjsdev/core; no helpers, no custom elements, no shared
 * components.
 *
 * (Do not put U+0060 GRAVE ACCENT characters in comments inside the
 * html template body below: they close the tagged template literal
 * at JS-parse time and re-introduce the very 500 this file exists to
 * catch. See [[feedback-html-template-no-backticks]].)
 */
export default function ErrorBoundary({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return html`
    <main id="main" tabindex="-1" class="min-h-[60vh] flex flex-col items-start justify-center max-w-2xl mx-auto px-6 py-20 focus:outline-none">
      <div class="text-xs font-mono uppercase tracking-widest text-accent mb-4">500 &middot; server error</div>
      <h1 class="font-serif text-5xl md:text-6xl font-bold tracking-tight text-fg mb-4" style="letter-spacing: -0.03em">Something went wrong.</h1>
      <p class="text-fg-muted text-lg mb-6 max-w-2xl">We hit an unexpected error while rendering this page. The full stack is logged on the server; only the short message is shown here.</p>
      <pre class="w-full mb-8 text-sm overflow-x-auto" style="background: var(--bg-sunken); border: 1px solid var(--border); border-radius: 8px; padding: 16px"><code>${message}</code></pre>
      <a href="/" class="inline-flex items-center gap-1.5 text-accent no-underline font-medium hover:underline">&larr; Back home</a>
    </main>
  `;
}
