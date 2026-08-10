import { html } from '@webjsdev/core';
import type { Metadata } from '@webjsdev/core';
import { pageHeading, lede } from '#lib/utils/ui.ts';
import '#modules/components/components/counter-card.ts';
import '#modules/components/components/reactive-meter.ts';
import '#modules/components/components/theme-context.ts';
import '#modules/components/components/task-loader.ts';

export const metadata: Metadata = { title: 'Components (signals + slots) | features' };

export default function ComponentsExample() {
  return html`
    ${pageHeading('Components')}
    ${lede(html`The WebComponent factory, a reactive prop, an instance signal, and a slot.`)}
    <counter-card label="Taps"><strong>A slotted title</strong></counter-card>
    <p class="text-muted-foreground mt-6 mb-2">Shadow DOM (scoped <code class="font-mono">css</code>) plus the rest of the signals API (<code class="font-mono">computed</code>, <code class="font-mono">effect</code>, <code class="font-mono">batch</code>):</p>
    <reactive-meter></reactive-meter>
    <p class="text-muted-foreground mt-6 mb-2">The context API (<code class="font-mono">createContext</code> + <code class="font-mono">ContextProvider</code> / <code class="font-mono">ContextConsumer</code>): a value passed to a nested child without attribute drilling.</p>
    <theme-provider>
      <theme-consumer></theme-consumer>
    </theme-provider>
    <p class="text-muted-foreground mt-6 mb-2">A <code class="font-mono">Task</code> for client-only async data, switching on <code class="font-mono">TaskStatus</code>:</p>
    <task-loader></task-loader>
  `;
}
