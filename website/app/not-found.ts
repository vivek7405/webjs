import { html } from '@webjsdev/core';

/**
 * Root 404 boundary. Renders when a page or server action throws
 * notFound() AND when no route matches the requested URL.
 *
 * Keep this file's import graph minimal: same reason as error.ts:
 * if this file fails to load, the framework falls through to its
 * generic 404 page. Only @webjsdev/core, nothing else.
 *
 * (Do not put U+0060 GRAVE ACCENT characters in comments inside the
 * html template body below. See [[feedback-html-template-no-backticks]].)
 */
export default function NotFound() {
  return html`
    <main id="main" tabindex="-1" class="min-h-[60vh] flex flex-col items-start justify-center max-w-2xl mx-auto px-6 py-20 focus:outline-none">
      <div class="text-xs font-mono uppercase tracking-widest text-accent mb-4">404 &middot; not found</div>
      <h1 class="font-serif text-5xl md:text-6xl font-bold tracking-tight text-fg mb-4" style="letter-spacing: -0.03em">Page not found.</h1>
      <p class="text-fg-muted text-lg mb-8 max-w-2xl">The page you were looking for does not exist.</p>
      <a href="/" class="inline-flex items-center gap-1.5 text-accent no-underline font-medium hover:underline">&larr; Back home</a>
    </main>
  `;
}
