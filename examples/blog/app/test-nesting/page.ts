import { html } from 'webjs';
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
    <h1>Nested DSD Combinations</h1>

    <section id="shadow-shadow">
      <h2>Shadow → Shadow</h2>
      <shadow-parent child="shadow"></shadow-parent>
    </section>

    <section id="shadow-light">
      <h2>Shadow → Light</h2>
      <shadow-parent child="light"></shadow-parent>
    </section>

    <section id="light-shadow">
      <h2>Light → Shadow</h2>
      <light-parent child="shadow"></light-parent>
    </section>

    <section id="light-light">
      <h2>Light → Light</h2>
      <light-parent child="light"></light-parent>
    </section>
  `;
}
