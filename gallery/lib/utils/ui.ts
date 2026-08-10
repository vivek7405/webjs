/**
 * ui.ts: repeated MARKUP-chunk helpers (the `lib/utils/ui.ts` pattern).
 *
 * A design system has two kinds of helper. A repeated PRIMITIVE with variants
 * (button, input, card, badge) is a CLASS helper in `components/ui/` returning a
 * class string. A repeated markup CHUNK (a heading, a lede, a back link) is an
 * `html`-fragment helper here in `lib/utils/ui.ts`: it returns SSR-time markup,
 * so the output is byte-identical to writing the tags inline, with no client
 * runtime. Use these for chunks that repeat across pages; keep genuinely one-off
 * or trivial prose (a lone `<code>`, a single text link) inline for readability.
 *
 * OWN-AND-THEME: these fragments are THIS gallery's shared bits. Change a class
 * here and every page updates at once. Build your own for your app.
 */
import { html } from '@webjsdev/core';

/** A page's `<h1>` heading (the standard demo/page title). */
export function pageHeading(title: unknown) {
  return html`<h1 class="text-h2 font-bold mb-4">${title}</h1>`;
}

/** The muted intro paragraph under a heading. Pass a string OR an `html` fragment
 *  (a lede often wraps an inline `<code>`). */
export function lede(content: unknown) {
  return html`<p class="text-muted-foreground mb-4">${content}</p>`;
}

/** A slim "back" link (used above each gallery demo to return to the index). */
export function backLink(href: string, label: unknown) {
  return html`<a href=${href} class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors no-underline mb-6">${label}</a>`;
}
