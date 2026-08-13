import { html, type LayoutProps } from '@webjsdev/core';
import '#components/counter.ts';

/**
 * The layout's own markup (the header and the counter) sits OUTSIDE the
 * children range the SSR emits around `${children}`. That split is the whole
 * fixture: a page-edit morph rewrites only what is inside the range, so the
 * counter's hydrated state survives it, while a layout edit needs the
 * whole-body `shell` swap and therefore re-creates it (#1398).
 *
 * The inline script is the RELOAD detector, and it is written to be immune to
 * re-execution on purpose. A `shell` swap re-runs the scripts it swaps in, so a
 * counter would advance and say nothing about whether the document reloaded.
 * A token that only ever assigns when absent survives a re-run and can only
 * change when the whole global scope is replaced, which is exactly a reload.
 *
 * The stylesheet link sits in the layout's own markup, outside the children
 * range, so a page-edit morph never rewrites it. That placement is what makes
 * the re-request assertion meaningful: nothing but the dev client's explicit
 * stylesheet refresh can cause the browser to ask for it again.
 */
export default function RootLayout({ children }: LayoutProps) {
  return html`
    <script>window.__docToken = window.__docToken || String(Math.random());</script>
    <link rel="stylesheet" href="/public/app.css">
    <header id="layout-marker">LAYOUT_A</header>
    <morph-counter></morph-counter>
    <main>${children}</main>
  `;
}
