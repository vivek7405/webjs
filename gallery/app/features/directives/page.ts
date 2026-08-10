import { html } from '@webjsdev/core';
import type { Metadata } from '@webjsdev/core';
import { pageHeading, lede } from '#lib/utils/ui.ts';
import '#modules/directives/components/directive-demo.ts';

export const metadata: Metadata = { title: 'Directives (repeat + watch) | features' };

export default function DirectivesExample() {
  return html`
    ${pageHeading('Directives')}
    ${lede(html`The lit-html directive set: <code>repeat</code> keys a reordering list so nodes are reused, and <code>watch(signal)</code> swaps one node without a full re-render.`)}
    <directive-demo></directive-demo>
  `;
}
