/**
 * Clean fixture for `scripts/eval-design.mjs` (#1116).
 *
 * The same screen as `dirty-app`, written against the tokens and primitives.
 * Every rubric line reads zero here, which is what proves the script is
 * discriminating rather than merely counting matches in any file it is handed.
 */
import { html } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';
import { emptyStateClass, emptyStateTitleClass } from '#components/ui/empty-state.ts';
import {
  descriptionListClass,
  descriptionTermClass,
  descriptionDetailsClass,
} from '#components/ui/description-list.ts';

interface Delivery {
  id: string;
  route: string;
  total: number;
}

const deliveries: Delivery[] = [];

export default function CleanDashboard() {
  return html`
    <section class="bg-card p-4 shadow-e1">
      <h1 class="text-2xl">Deliveries</h1>
      <h2 class="text-muted-foreground text-sm">Today</h2>

      <dl class=${descriptionListClass()}>
        <dt class=${descriptionTermClass()}>Total</dt>
        <dd class=${descriptionDetailsClass()}>${deliveries.length}</dd>
      </dl>

      ${deliveries.length
        ? html`<ul>
            ${deliveries.map((d) => html`<li>${d.route}</li>`)}
          </ul>`
        : html`<div class=${emptyStateClass()}>
            <p class=${emptyStateTitleClass()}>No deliveries yet</p>
          </div>`}

      <button class=${buttonClass()}>Save</button>
      <button class=${buttonClass({ variant: 'outline' })}>Export</button>
    </section>
  `;
}
