import { html } from '@webjs/core';
import '../../components/test/shadow-parent.ts';
import '../../components/test/light-parent.ts';

export const metadata = { title: 'Nested DSD Test' };

/**
 * Test page exercising all four shadow/light DOM nesting combinations.
 * Used by e2e tests — the _test-nesting folder is private (underscore prefix)
 * but still routable for direct access.
 */
export default function NestingTestPage() {
  return html`
    <h1 class="font-serif text-h1 leading-[1.08] tracking-[-0.025em] font-bold m-0 mb-4">Nested DSD Combinations</h1>

    <section id="shadow-shadow">
      <h2 class="font-serif text-h2 leading-[1.2] tracking-[-0.02em] font-bold mt-12 mb-3">Shadow → Shadow</h2>
      <shadow-parent child="shadow"></shadow-parent>
    </section>

    <section id="shadow-light">
      <h2 class="font-serif text-h2 leading-[1.2] tracking-[-0.02em] font-bold mt-12 mb-3">Shadow → Light</h2>
      <shadow-parent child="light"></shadow-parent>
    </section>

    <section id="light-shadow">
      <h2 class="font-serif text-h2 leading-[1.2] tracking-[-0.02em] font-bold mt-12 mb-3">Light → Shadow</h2>
      <light-parent child="shadow"></light-parent>
    </section>

    <section id="light-light">
      <h2 class="font-serif text-h2 leading-[1.2] tracking-[-0.02em] font-bold mt-12 mb-3">Light → Light</h2>
      <light-parent child="light"></light-parent>
    </section>
  `;
}
